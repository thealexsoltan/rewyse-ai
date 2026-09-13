/**
 * Hand-built `EnergyDay`, `Insights` and `SleepNight[]` fixtures for the report
 * tests and the HTML preview script.
 *
 * These are written against the contracts in PLAN.md section 4 only — the
 * report layer must never depend on the model layer to produce them. Values are
 * deterministic (a seeded PRNG) so screenshots and snapshots are stable.
 *
 * @module test/helpers/reportFixtures
 */

/** Local wake time used across the fixtures (07:00). */
export const WAKE_MIN = 7 * 60;

/** Target bedtime (22:45) and target wake (07:00) for the fixture day. */
export const TARGET_BEDTIME_MIN = 22 * 60 + 45;
export const TARGET_WAKE_MIN = 7 * 60;

/** Debt carried by the fixture day, in hours. */
export const DEBT_HOURS = 2.25;

/** Deterministic PRNG (mulberry32) so fixtures never wobble between runs. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** `2025-09-13` minus n days, computed on a UTC Date so no local zone leaks in. */
function dateMinus(dateStr, days) {
  const [y, m, d] = dateStr.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) - days * 86400000;
  const dt = new Date(ms);
  const pad = (v) => String(v).padStart(2, '0');
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/**
 * Control points for the fixture energy curve: `[minutes after wake, energy]`.
 *
 * The report layer must render whatever the model hands it, so the fixture
 * curve is shaped by hand into the classic Rise silhouette — grogginess, a
 * mid-morning peak, an early-afternoon dip, an evening peak and the overnight
 * trough — rather than re-implementing the two-process model (that is Agent B's
 * job, and the renderers must not depend on it). `S`, `C` and `inertia` are
 * still filled with the plausible two-process values that accompany each point,
 * so consumers of `EnergyPoint` see a complete record.
 */
const CURVE_CONTROL_POINTS = [
  [0, 8],
  [45, 26],
  [90, 55],
  [150, 78],
  [210, 90],
  [285, 84],
  [345, 70],
  [420, 46],
  [480, 52],
  [555, 68],
  [660, 86],
  [750, 74],
  [825, 56],
  [900, 36],
  [945, 24],
  [1035, 11],
  [1200, 5],
  [1320, 7],
  [1425, 14],
];

/** Smooth (cosine) interpolation through the control points. */
function interpolateCurve(elapsed) {
  const pts = CURVE_CONTROL_POINTS;
  if (elapsed <= pts[0][0]) return pts[0][1];
  if (elapsed >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    if (elapsed >= x0 && elapsed <= x1) {
      const u = (elapsed - x0) / (x1 - x0);
      const smooth = (1 - Math.cos(u * Math.PI)) / 2;
      return y0 + (y1 - y0) * smooth;
    }
  }
  return pts[pts.length - 1][1];
}

/**
 * Energy curve for the fixture day: 96 points, 15 min apart, starting at wake.
 *
 * @param {{wakeMin?: number, bedtimeMin?: number, date?: string,
 *   tzOffsetMin?: number}} [opts]
 * @returns {{t:number, iso:string, energy:number, S:number, C:number, inertia:number}[]}
 */
export function makeCurve({
  wakeMin = WAKE_MIN,
  bedtimeMin = TARGET_BEDTIME_MIN,
  date = '2025-09-13',
  tzOffsetMin = 120,
} = {}) {
  const asleepAfter = bedtimeMin - wakeMin; // minutes after wake that sleep starts
  const dayStartMs = Date.parse(`${date}T00:00:00Z`) - tzOffsetMin * 60000;
  let sAtBed = 0;

  const out = [];
  for (let i = 0; i < 96; i += 1) {
    const elapsed = i * 15;
    const t = (wakeMin + elapsed) % 1440;
    const theta = (2 * Math.PI * (elapsed - 600)) / 1440;
    const C = Math.cos(theta) + 0.25 * Math.cos(2 * theta + Math.PI / 2);
    const inertia = elapsed < 120 ? 0.35 * Math.exp(-elapsed / 30) : 0;
    let S;
    if (elapsed <= asleepAfter) {
      S = 1 - (1 - 0.16) * Math.exp(-elapsed / 1092);
      sAtBed = S;
    } else {
      S = sAtBed * Math.exp(-(elapsed - asleepAfter) / 252);
    }
    out.push({
      t,
      iso: new Date(dayStartMs + (wakeMin + elapsed) * 60000).toISOString(),
      energy: Math.round(Math.max(0, Math.min(100, interpolateCurve(elapsed)))),
      S: Number(S.toFixed(4)),
      C: Number(C.toFixed(4)),
      inertia: Number(inertia.toFixed(4)),
    });
  }
  return out;
}

/**
 * A realistic `SleepNight` for a given wake date.
 *
 * @param {string} date - `YYYY-MM-DD` of the wake
 * @param {number} seed
 * @returns {object} SleepNight
 */
export function makeNight(date, seed) {
  const rnd = mulberry32(seed);
  const bedtimeMin = 1350 + Math.round(rnd() * 70) - 20; // ~22:10 to 23:20
  const wakeMin = 400 + Math.round(rnd() * 50); // ~06:40 to 07:30
  const inBedMin = 1440 - bedtimeMin + wakeMin;
  const efficiencyPct = 86 + Math.round(rnd() * 10);
  const asleepMin = Math.round((inBedMin * efficiencyPct) / 100);
  const awakeMin = inBedMin - asleepMin;
  const remMin = Math.round(asleepMin * (0.2 + rnd() * 0.06));
  const swsMin = Math.round(asleepMin * (0.17 + rnd() * 0.06));
  const lightMin = asleepMin - remMin - swsMin;
  const needBaselineMin = 470;
  const needFromDebtMin = 20 + Math.round(rnd() * 30);
  const needFromStrainMin = Math.round(rnd() * 25);
  const napMin = rnd() > 0.8 ? 20 : 0;
  return {
    date,
    start: `${dateMinus(date, 1)}T${String(Math.floor(bedtimeMin / 60)).padStart(2, '0')}:${String(
      bedtimeMin % 60,
    ).padStart(2, '0')}:00+02:00`,
    end: `${date}T${String(Math.floor(wakeMin / 60)).padStart(2, '0')}:${String(wakeMin % 60).padStart(
      2,
      '0',
    )}:00+02:00`,
    tzOffsetMin: 120,
    bedtimeMin,
    wakeMin,
    bedtimeAfterMidnight: false,
    inBedMin,
    asleepMin,
    awakeMin,
    lightMin,
    swsMin,
    remMin,
    efficiencyPct,
    performancePct: Math.round((asleepMin / (needBaselineMin + needFromDebtMin)) * 100),
    consistencyPct: 66 + Math.round(rnd() * 22),
    respiratoryRate: Number((14.2 + rnd() * 1.4).toFixed(1)),
    disturbances: 6 + Math.round(rnd() * 10),
    needBaselineMin,
    needFromDebtMin,
    needFromStrainMin,
    needFromNapMin: napMin ? -napMin : 0,
    needTotalMin: needBaselineMin + needFromDebtMin + needFromStrainMin - napMin,
    naps: napMin ? [{ start: `${date}T13:10:00+02:00`, end: `${date}T13:30:00+02:00`, asleepMin: napMin }] : [],
    napMin,
    recovery: {
      score: 40 + Math.round(rnd() * 45),
      hrvMs: 52 + Math.round(rnd() * 30),
      rhr: 50 + Math.round(rnd() * 8),
      spo2: Number((95 + rnd() * 2.5).toFixed(1)),
      skinTempC: Number((33.2 + rnd()).toFixed(1)),
      calibrating: false,
    },
    strain: Number((7 + rnd() * 9).toFixed(1)),
  };
}

/**
 * 14 nights ending the night before `date`, oldest first.
 *
 * @param {string} [date]
 * @param {number} [count]
 * @returns {object[]} SleepNight[]
 */
export function makeNights(date = '2025-09-13', count = 14) {
  const nights = [];
  for (let i = count; i >= 1; i -= 1) {
    nights.push(makeNight(dateMinus(date, i), 1000 + i * 7));
  }
  return nights;
}

/**
 * A complete `EnergyDay` with every zone kind, a five-entry plan, a recovery
 * block and last night's sleep.
 *
 * @param {{date?: string, now?: number|null}} [overrides]
 * @returns {object} EnergyDay
 */
export function makeEnergyDay({ date = '2025-09-13', now = 14 * 60 + 20 } = {}) {
  const nights = makeNights(date);
  const lastNight = nights[nights.length - 1];

  return {
    date,
    tzOffsetMin: 120,
    now,
    wakeMin: WAKE_MIN,
    targetBedtimeMin: TARGET_BEDTIME_MIN,
    targetWakeMin: TARGET_WAKE_MIN,
    anchors: {
      cbtMin: WAKE_MIN - 120,
      dlmo: WAKE_MIN - 120 - 420 + 1440,
      habitualWakeMin: 425,
      habitualBedtimeMin: 1370,
      midsleepMin: 178,
    },
    need: { baselineMin: 470, todayMin: 505 },
    debt: { hours: DEBT_HOURS, trend7d: 'rising', level: 'moderate' },
    curve: makeCurve({ date }),
    zones: [
      {
        kind: 'grogginess',
        startMin: 420,
        endMin: 510,
        label: 'Grogginess',
        advice: 'Daylight and water first; hold caffeine for 60-90 minutes.',
      },
      {
        kind: 'morning_peak',
        startMin: 510,
        endMin: 750,
        label: 'Morning peak',
        advice: 'Your sharpest block: hardest thinking, no meetings if you can help it.',
      },
      {
        kind: 'afternoon_dip',
        startMin: 750,
        endMin: 900,
        label: 'Afternoon dip',
        advice: 'Admin, email and walking calls. A 20-minute nap here is cheap energy.',
      },
      {
        kind: 'evening_peak',
        startMin: 900,
        endMin: 1245,
        label: 'Evening peak',
        advice: 'Second wind: training, or creative work that needs less precision.',
      },
      {
        kind: 'wind_down',
        startMin: 1245,
        endMin: 1305,
        label: 'Wind-down',
        advice: 'Lights down, screens dim, nothing that needs a decision.',
      },
      {
        kind: 'melatonin_window',
        startMin: 1305,
        endMin: 1395,
        label: 'Melatonin window',
        advice: 'Melatonin is rising: this is when falling asleep is easiest.',
      },
      {
        kind: 'sleep',
        startMin: TARGET_BEDTIME_MIN,
        endMin: TARGET_WAKE_MIN,
        label: 'Sleep',
        advice: 'Aim for 8h05 in bed to clear tonight’s need plus some debt.',
      },
    ],
    plan: [
      {
        startMin: 510,
        endMin: 750,
        activity: 'deep_work',
        reason: 'Morning peak with inertia gone; highest sustained focus of the day.',
      },
      {
        startMin: 765,
        endMin: 785,
        activity: 'nap',
        reason: 'Debt is 2h15 and this ends more than 8 hours before target bedtime.',
      },
      {
        startMin: 785,
        endMin: 900,
        activity: 'admin',
        reason: 'Circadian dip: shallow work costs the least here.',
      },
      {
        startMin: 1020,
        endMin: 1080,
        activity: 'workout',
        reason: 'Recovery 62% supports a moderate session inside the evening peak.',
      },
      {
        startMin: 1245,
        endMin: TARGET_BEDTIME_MIN,
        activity: 'wind_down',
        reason: 'Two hours of dimming before the melatonin window opens.',
      },
    ],
    recovery: { ...lastNight.recovery, score: 62, hrvMs: 68, rhr: 54 },
    lastNight: {
      ...lastNight,
      asleepMin: 410,
      inBedMin: 451,
      efficiencyPct: 91,
      needTotalMin: 505,
      recovery: { ...lastNight.recovery, score: 62, hrvMs: 68, rhr: 54 },
    },
  };
}

/**
 * A complete `Insights` object: 14 debt rows, 2 correlations, 3 ranked
 * recommendations (one title deliberately contains `<` and `&`).
 *
 * @param {{date?: string}} [overrides]
 * @returns {object} Insights
 */
export function makeInsights({ date = '2025-09-13' } = {}) {
  const nights = makeNights(date);
  let cumulative = 0;
  const byDay = nights.map((n) => {
    // Same sign convention as computeSleepDebt(): need − asleep, so a positive
    // deltaMin is a shortfall.
    const deltaMin = n.needTotalMin - (n.asleepMin + n.napMin);
    cumulative = Math.max(0, cumulative + deltaMin / 60);
    return {
      date: n.date,
      needMin: n.needTotalMin,
      asleepMin: n.asleepMin + n.napMin,
      deltaMin,
      cumulativeDebtHours: Number(cumulative.toFixed(2)),
    };
  });

  return {
    windowDays: 14,
    nights: nights.length,
    debt: {
      hours: DEBT_HOURS,
      level: 'moderate',
      trend7d: 'rising',
      byDay,
    },
    consistency: { bedtimeSdMin: 47, wakeSdMin: 26, whoopConsistencyAvg: 71 },
    quality: {
      efficiencyAvg: 90.4,
      disturbancesAvg: 10.8,
      swsPctAvg: 19.6,
      remPctAvg: 22.8,
      performanceAvg: 83.2,
    },
    recovery: {
      avg: 61.4,
      avg7d: 57.1,
      hrvAvg: 67.8,
      hrvAvg7d: 61.2,
      hrvDeltaPct: -9.7,
      rhrAvg: 53.6,
      rhrAvg7d: 55.9,
      calibrating: false,
    },
    correlations: [
      {
        x: 'time asleep',
        y: 'next-day recovery',
        r: 0.52,
        n: 14,
        reading: 'Every extra hour asleep is worth roughly 6 recovery points the next morning.',
      },
      {
        x: 'bedtime lateness',
        y: 'recovery',
        r: -0.41,
        n: 14,
        reading: 'Late nights cost you recovery even when total sleep holds up.',
      },
    ],
    recommendations: [
      {
        rank: 1,
        title: 'Pay down 2h15 of debt over the next three nights',
        why: 'Debt has been rising for a week and your 7-day recovery average is down 4 points.',
        action: 'Go to bed 45 minutes earlier than habit tonight, tomorrow and Monday.',
        impact: 'high',
      },
      {
        rank: 2,
        title: 'Screens & light: keep evening exposure < 50 lux',
        why: 'Bedtime varies by 47 minutes, and the late nights track with lower recovery.',
        action: 'Dim the flat at 20:45 and put the phone on the charger outside the bedroom.',
        impact: 'medium',
      },
      {
        rank: 3,
        title: 'Anchor your wake time at 07:00',
        why: 'Wake time drifts by 26 minutes, which keeps your circadian phase unsettled.',
        action: 'Same alarm every day, weekends included, for two weeks.',
        impact: 'medium',
      },
    ],
  };
}

/**
 * Everything a report needs, in one call.
 *
 * @param {{date?: string, now?: number|null}} [overrides]
 * @returns {{energyDay: object, insights: object, nights: object[], generatedAt: string}}
 */
export function makeReportInput(overrides = {}) {
  const date = overrides.date || '2025-09-13';
  return {
    energyDay: makeEnergyDay({ date, ...overrides }),
    insights: makeInsights({ date }),
    nights: makeNights(date),
    generatedAt: '2025-09-13T12:20:00.000Z',
  };
}

export default { makeEnergyDay, makeInsights, makeNights, makeCurve, makeReportInput };
