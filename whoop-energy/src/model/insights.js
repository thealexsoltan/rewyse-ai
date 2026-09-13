/**
 * @file 14-day statistics, correlations and the ranked "what to optimise" list
 * (PLAN.md §4 `Insights`, §5 "Insights & recommendations").
 *
 * @typedef {import('./types.js').SleepNight} SleepNight
 * @typedef {import('./types.js').Correlation} Correlation
 * @typedef {import('./types.js').Recommendation} Recommendation
 * @typedef {import('./types.js').Insights} Insights
 */

import { circularMeanMinutes, circularSdMinutes, fmtHHMM } from '../time.js';
import { computeSleepDebt, computeSleepNeed, totalSleepMin } from './sleepDebt.js';

/** Default analysis window. */
export const DEFAULT_WINDOW_DAYS = 14;
/** Short (recent) sub-window used for every `*7d` figure. */
export const RECENT_WINDOW_DAYS = 7;

/** A correlation is only reported at or above this |r|. */
export const CORR_MIN_R = 0.3;
/** …and this many paired samples. */
export const CORR_MIN_N = 7;

/** Debt at or above this (hours) triggers the payback recommendation. */
export const REC_DEBT_HOURS = 3;
/** Debt paid back per night, in hours, when computing "for N nights". */
export const PAYBACK_NIGHTLY_HOURS = 0.75;
/** Bed/wake standard deviation (minutes) that triggers the anchoring advice. */
export const REC_SD_MIN = 45;
/** Sleep efficiency below this percent triggers the efficiency advice. */
export const REC_EFFICIENCY_PCT = 85;
/** HRV this many percent below the window baseline triggers the strain advice. */
export const REC_HRV_DELTA_PCT = -10;
/** Recent RHR this many bpm above baseline triggers the illness/alcohol check. */
export const REC_RHR_DELTA_BPM = 3;
/** Average disturbances at or above this triggers the environment advice. */
export const REC_DISTURBANCES = 12;
/** WHOOP sleep consistency below this triggers the regularity advice. */
export const REC_CONSISTENCY_PCT = 70;
/** Never return more than this many recommendations. */
export const MAX_RECOMMENDATIONS = 6;

/** Sort order for the `impact` field. */
const IMPACT_ORDER = { high: 0, medium: 1, low: 2 };

/**
 * @param {number[]} values
 * @param {number} [dp=1]
 * @returns {number|null}
 */
function avg(values, dp = 1) {
  const nums = (values ?? []).map(Number).filter(Number.isFinite);
  if (nums.length === 0) return null;
  const f = 10 ** dp;
  return Math.round((nums.reduce((a, b) => a + b, 0) / nums.length) * f) / f;
}

/** @param {number} n @param {number} [dp=1] @returns {number} */
function round(n, dp = 1) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * Minutes past 18:00 that a bedtime falls — a monotone "lateness" scale that
 * keeps 23:30 (330) and 00:30 (390) in the right order across midnight.
 *
 * @param {number} bedtimeMin
 * @returns {number}
 */
export function bedtimeLateness(bedtimeMin) {
  const n = Number(bedtimeMin);
  if (!Number.isFinite(n)) return NaN;
  return ((n - 18 * 60) % 1440 + 1440) % 1440;
}

/**
 * Pearson product-moment correlation.
 *
 * @param {number[]} xs
 * @param {number[]} ys paired with `xs`; pairs with a non-finite member are dropped
 * @returns {{r: number, n: number}|null} `null` when fewer than 2 pairs or either side is constant
 */
export function pearson(xs, ys) {
  const px = [];
  const py = [];
  const len = Math.min(xs?.length ?? 0, ys?.length ?? 0);
  for (let i = 0; i < len; i += 1) {
    const a = Number(xs[i]);
    const b = Number(ys[i]);
    if (Number.isFinite(a) && Number.isFinite(b)) {
      px.push(a);
      py.push(b);
    }
  }
  const n = px.length;
  if (n < 2) return null;
  const mx = px.reduce((a, b) => a + b, 0) / n;
  const my = py.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i += 1) {
    const dx = px[i] - mx;
    const dy = py[i] - my;
    sxy += dx * dy;
    sxx += dx * dx;
    syy += dy * dy;
  }
  if (sxx <= 1e-12 || syy <= 1e-12) return null;
  return { r: Math.round((sxy / Math.sqrt(sxx * syy)) * 1000) / 1000, n };
}

/**
 * @param {SleepNight[]} nights
 * @returns {SleepNight[]}
 */
function chronological(nights) {
  return [...(nights ?? [])]
    .filter((n) => n && typeof n === 'object')
    .sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0));
}

/**
 * Build the correlation list. Only |r| >= {@link CORR_MIN_R} with at least
 * {@link CORR_MIN_N} pairs is reported (PLAN.md §5).
 *
 * Pairing note: in the canonical `SleepNight`, `recovery` is the score WHOOP
 * computed *from* that sleep and `strain` is the strain of the day that
 * *preceded* it — so both of PLAN's "next / following night" pairings are
 * same-row joins here.
 *
 * @param {SleepNight[]} window
 * @returns {Correlation[]}
 */
export function computeCorrelations(window) {
  /** @type {Array<{x: string, y: string, xs: number[], ys: number[], up: string, down: string}>} */
  const specs = [
    {
      x: 'asleepMin',
      y: 'recoveryScore',
      xs: window.map((n) => Number(n.asleepMin)),
      ys: window.map((n) => Number(n.recovery?.score)),
      up: 'Longer sleep tracks with better recovery',
      down: 'Longer sleep tracks with worse recovery — worth a second look',
    },
    {
      x: 'bedtimeLateness',
      y: 'recoveryScore',
      xs: window.map((n) => bedtimeLateness(n.bedtimeMin)),
      ys: window.map((n) => Number(n.recovery?.score)),
      up: 'Later bedtimes track with better recovery — unusual, check your data',
      down: 'Later bedtimes cost you recovery',
    },
    {
      x: 'strain',
      y: 'efficiencyPct',
      xs: window.map((n) => Number(n.strain)),
      ys: window.map((n) => Number(n.efficiencyPct)),
      up: 'Harder days are followed by more efficient sleep',
      down: 'Harder days are followed by more broken sleep',
    },
    {
      x: 'napMin',
      y: 'asleepMin',
      xs: window.map((n) => Number(n.napMin)),
      ys: window.map((n) => Number(n.asleepMin)),
      up: 'Napping goes with longer nights too',
      down: 'Napping eats into your night sleep',
    },
  ];

  /** @type {Correlation[]} */
  const out = [];
  for (const spec of specs) {
    const result = pearson(spec.xs, spec.ys);
    if (!result) continue;
    if (result.n < CORR_MIN_N || Math.abs(result.r) < CORR_MIN_R) continue;
    out.push({
      x: spec.x,
      y: spec.y,
      r: result.r,
      n: result.n,
      reading: `${result.r > 0 ? spec.up : spec.down} (r = ${result.r.toFixed(2)}, n = ${result.n}).`,
    });
  }
  return out.sort((a, b) => Math.abs(b.r) - Math.abs(a.r));
}

/**
 * Rule engine over the computed statistics.
 *
 * @param {Object} ctx
 * @param {Insights['debt']} ctx.debt
 * @param {Insights['consistency']} ctx.consistency
 * @param {Insights['quality']} ctx.quality
 * @param {Insights['recovery']} ctx.recovery
 * @param {Correlation[]} ctx.correlations
 * @param {number|null} ctx.habitualWakeMin
 * @param {number} ctx.needMin
 * @returns {Recommendation[]} at most {@link MAX_RECOMMENDATIONS}, ranked
 */
export function buildRecommendations({ debt, consistency, quality, recovery, correlations, habitualWakeMin, needMin }) {
  /** @type {Array<Omit<Recommendation, 'rank'>>} */
  const raw = [];

  if (debt.hours >= REC_DEBT_HOURS) {
    const nights = Math.ceil(debt.hours / PAYBACK_NIGHTLY_HOURS);
    const extraMin = Math.round(PAYBACK_NIGHTLY_HOURS * 60);
    raw.push({
      title: 'Pay down your sleep debt',
      why: `You are carrying ${debt.hours.toFixed(1)}h of sleep debt (${debt.level}, trend ${debt.trend7d}).`,
      action: `Go to bed ${extraMin} minutes earlier than usual for the next ${nights} nights — keep your wake time fixed.`,
      impact: 'high',
    });
  }

  const bedSd = consistency.bedtimeSdMin;
  const wakeSd = consistency.wakeSdMin;
  if ((Number.isFinite(bedSd) && bedSd >= REC_SD_MIN) || (Number.isFinite(wakeSd) && wakeSd >= REC_SD_MIN)) {
    const anchor = Number.isFinite(habitualWakeMin) ? fmtHHMM(habitualWakeMin) : 'the same time';
    raw.push({
      title: 'Anchor your wake time',
      why: `Your bed/wake times swing by ±${Math.round(Math.max(bedSd ?? 0, wakeSd ?? 0))} minutes, which keeps your body clock guessing.`,
      action: `Get up at ${anchor} every day, weekends included, and get daylight within 30 minutes.`,
      impact: 'high',
    });
  }

  if (Number.isFinite(recovery.hrvDeltaPct) && recovery.hrvDeltaPct <= REC_HRV_DELTA_PCT) {
    raw.push({
      title: 'HRV is below your baseline',
      why: `7-day HRV is ${Math.abs(recovery.hrvDeltaPct).toFixed(0)}% under your ${DEFAULT_WINDOW_DAYS}-day average.`,
      action: 'Drop training intensity for 2–3 days, keep sessions aerobic, and protect sleep before adding load back.',
      impact: 'high',
    });
  }

  if (Number.isFinite(quality.efficiencyAvg) && quality.efficiencyAvg < REC_EFFICIENCY_PCT) {
    raw.push({
      title: 'Improve sleep efficiency',
      why: `You are only asleep for ${quality.efficiencyAvg}% of the time you spend in bed (target ${REC_EFFICIENCY_PCT}%+).`,
      action: `Only get into bed when sleepy, get out if you are awake past 20 minutes, and cut time in bed towards ${Math.round(needMin / 60 * 10) / 10}h.`,
      impact: 'medium',
    });
  }

  if (
    Number.isFinite(recovery.rhrAvg7d) &&
    Number.isFinite(recovery.rhrAvg) &&
    recovery.rhrAvg7d - recovery.rhrAvg >= REC_RHR_DELTA_BPM
  ) {
    raw.push({
      title: 'Resting heart rate is elevated',
      why: `Recent RHR is ${round(recovery.rhrAvg7d - recovery.rhrAvg)} bpm above your ${DEFAULT_WINDOW_DAYS}-day average.`,
      action: 'Check for illness, alcohol, or eating late; hold off on hard sessions until it settles.',
      impact: 'medium',
    });
  }

  if (Number.isFinite(quality.disturbancesAvg) && quality.disturbancesAvg >= REC_DISTURBANCES) {
    raw.push({
      title: 'Reduce night-time disturbances',
      why: `You average ${quality.disturbancesAvg} disturbances a night.`,
      action: 'Cool the room to 17–19°C, black it out, and move phone/pets out of the bedroom.',
      impact: 'medium',
    });
  }

  if (Number.isFinite(consistency.whoopConsistencyAvg) && consistency.whoopConsistencyAvg < REC_CONSISTENCY_PCT) {
    raw.push({
      title: 'Regularise your schedule',
      why: `WHOOP scores your sleep consistency at ${consistency.whoopConsistencyAvg}%.`,
      action: 'Pick one bedtime and one wake time and hold both within 30 minutes for two weeks.',
      impact: 'medium',
    });
  }

  const lateness = correlations.find((c) => c.x === 'bedtimeLateness' && c.r <= -CORR_MIN_R);
  if (lateness) {
    raw.push({
      title: 'Late nights cost you recovery',
      why: lateness.reading,
      action: 'Treat your target bedtime as a hard stop on work and screens for the next week and compare recovery.',
      impact: 'low',
    });
  }

  const strain = correlations.find((c) => c.x === 'strain' && c.r <= -CORR_MIN_R);
  if (strain) {
    raw.push({
      title: 'High-strain days break up your sleep',
      why: strain.reading,
      action: 'Finish hard sessions at least 4 hours before bed and add a longer cool-down on your biggest days.',
      impact: 'low',
    });
  }

  return raw
    .map((rec, i) => ({ rec, i }))
    .sort((a, b) => IMPACT_ORDER[a.rec.impact] - IMPACT_ORDER[b.rec.impact] || a.i - b.i)
    .slice(0, MAX_RECOMMENDATIONS)
    .map(({ rec }, i) => ({ rank: i + 1, ...rec }));
}

/**
 * Full insights report over the trailing `windowDays` nights.
 *
 * @param {SleepNight[]} nights
 * @param {{windowDays?: number, needMin?: number}} [opts]
 * @returns {Insights}
 */
export function computeInsights(nights, { windowDays = DEFAULT_WINDOW_DAYS, needMin } = {}) {
  const all = chronological(nights);
  const window = all.slice(-Math.max(1, Math.round(windowDays)));
  const recent = window.slice(-RECENT_WINDOW_DAYS);

  const need = Number.isFinite(Number(needMin)) && Number(needMin) > 0
    ? Math.round(Number(needMin))
    : computeSleepNeed(window);

  const debt = computeSleepDebt(window, need);

  const bedtimes = window.map((n) => Number(n.bedtimeMin)).filter(Number.isFinite);
  const wakes = window.map((n) => Number(n.wakeMin)).filter(Number.isFinite);

  const consistency = {
    bedtimeSdMin: circularSdMinutes(bedtimes),
    wakeSdMin: circularSdMinutes(wakes),
    whoopConsistencyAvg: avg(window.map((n) => n.consistencyPct)),
  };

  const quality = {
    efficiencyAvg: avg(window.map((n) => n.efficiencyPct)),
    disturbancesAvg: avg(window.map((n) => n.disturbances)),
    swsPctAvg: avg(window.filter((n) => n.asleepMin > 0).map((n) => (n.swsMin / n.asleepMin) * 100)),
    remPctAvg: avg(window.filter((n) => n.asleepMin > 0).map((n) => (n.remMin / n.asleepMin) * 100)),
    performanceAvg: avg(window.map((n) => n.performancePct)),
  };

  const hrvAvg = avg(window.map((n) => n.recovery?.hrvMs));
  const hrvAvg7d = avg(recent.map((n) => n.recovery?.hrvMs));
  const recoveryStats = {
    avg: avg(window.map((n) => n.recovery?.score)),
    avg7d: avg(recent.map((n) => n.recovery?.score)),
    hrvAvg,
    hrvAvg7d,
    hrvDeltaPct:
      Number.isFinite(hrvAvg) && Number.isFinite(hrvAvg7d) && hrvAvg > 0
        ? round(((hrvAvg7d - hrvAvg) / hrvAvg) * 100)
        : null,
    rhrAvg: avg(window.map((n) => n.recovery?.rhr)),
    rhrAvg7d: avg(recent.map((n) => n.recovery?.rhr)),
    calibrating: window.some((n) => Boolean(n.recovery?.calibrating)),
  };

  const correlations = computeCorrelations(window);

  const recommendations = buildRecommendations({
    debt,
    consistency,
    quality,
    recovery: recoveryStats,
    correlations,
    habitualWakeMin: circularMeanMinutes(wakes.slice(-RECENT_WINDOW_DAYS)),
    needMin: need,
  });

  return {
    windowDays: Math.round(windowDays),
    nights: window.length,
    debt,
    consistency,
    quality,
    recovery: recoveryStats,
    correlations,
    recommendations,
  };
}

export default { computeInsights, pearson };
