/**
 * @file Turn the energy curve into Rise-style zones and a concrete day plan
 * (PLAN.md §5, "Zones" and "Day plan rules").
 *
 * All minutes here live in **curve space**: monotonically increasing from
 * today's wake, so an evening/overnight boundary is expressed as e.g. `1500`
 * (01:00 the next morning) rather than wrapping back to `60`. Renderers wrap
 * with `fmtHHMM` when printing.
 *
 * @typedef {import('./types.js').EnergyPoint} EnergyPoint
 * @typedef {import('./types.js').Zone} Zone
 * @typedef {import('./types.js').PlanItem} PlanItem
 * @typedef {import('./types.js').NightRecovery} NightRecovery
 */

import { fmtHHMM } from '../time.js';

/** Minutes in a day. */
export const MINUTES_PER_DAY = 1440;

// --- zone detection --------------------------------------------------------

/** Grogginess ends once normalised energy reaches this. */
export const GROGGINESS_ENERGY = 40;
/** …and sleep inertia has decayed below this. */
export const GROGGINESS_INERTIA = 0.05;
/** Clock fallback for the end of grogginess: wake + this. */
export const GROGGINESS_FALLBACK_MIN = 90;
/** Grogginess is never reported as longer than this. */
export const GROGGINESS_MAX_MIN = 180;

/** Falling through this energy ends the morning peak. */
export const MORNING_PEAK_EXIT_ENERGY = 65;
/** Absolute energy that marks the afternoon dip. */
export const DIP_ENERGY = 55;
/** Dip search window, relative to wake. */
export const DIP_SEARCH_START_MIN = 300;
export const DIP_SEARCH_END_MIN = 600;
/** Clock fallback for the dip, relative to wake. */
export const DIP_FALLBACK_START_MIN = 360;
export const DIP_FALLBACK_END_MIN = 480;
/** When the curve never crosses {@link DIP_ENERGY}, the dip is the band this far above its local minimum. */
export const DIP_RELATIVE_BAND = 5;
/** The dip may not be widened beyond this distance either side of the search window. */
export const DIP_WIDEN_MARGIN_MIN = 60;
/** A "dip" wider than this means the curve is flat there, so the clock fallback is used instead. */
export const DIP_MAX_WIDTH_MIN = 300;

/** Falling through this energy ends the evening peak early. */
export const EVENING_PEAK_EXIT_ENERGY = 55;
/** Wind-down normally starts this long before target bedtime. */
export const WIND_DOWN_LEAD_MIN = 120;
/** …and never earlier than this. */
export const WIND_DOWN_MAX_LEAD_MIN = 180;
/** Melatonin window: bedtime − this … */
export const MELATONIN_LEAD_MIN = 60;
/** … bedtime + this. */
export const MELATONIN_TAIL_MIN = 30;

// --- day plan --------------------------------------------------------------

/** WHOOP recovery at or above this is "green". */
export const RECOVERY_GREEN_MIN = 67;
/** WHOOP recovery below this is "red". */
export const RECOVERY_YELLOW_MIN = 34;
/** Length of a hard session. */
export const WORKOUT_HARD_MIN = 60;
/** Length of a light session. */
export const WORKOUT_LIGHT_MIN = 45;
/** Nap length. */
export const NAP_MIN = 20;
/** A nap is only suggested from this much debt. */
export const NAP_DEBT_MIN_HOURS = 1;
/** …and only if it ends at least this long before target bedtime. */
export const NAP_CUTOFF_BEFORE_BED_MIN = 480;
/** Local clock window kept free for dinner; an evening peak spanning it is split. */
export const DINNER_START_MIN = 19 * 60;
export const DINNER_END_MIN = 20 * 60;
/** Shortest block worth calling deep work. */
export const MIN_DEEP_WORK_MIN = 30;
/** Shortest block worth calling admin. */
export const MIN_ADMIN_MIN = 20;

/** Human labels per zone kind. */
export const ZONE_LABELS = Object.freeze({
  grogginess: 'Grogginess',
  morning_peak: 'Morning peak',
  afternoon_dip: 'Afternoon dip',
  evening_peak: 'Evening peak',
  wind_down: 'Wind-down',
  melatonin_window: 'Melatonin window',
  sleep: 'Sleep',
});

/** @param {number} m @returns {number} */
function mod1440(m) {
  const n = Number(m) || 0;
  return ((n % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Curve samples with strictly increasing `t`, unwrapping any that wrapped past
 * midnight back to `[0,1440)`.
 *
 * @param {EnergyPoint[]} curve
 * @returns {Array<{t: number, energy: number, inertia: number}>}
 */
export function unwrapCurve(curve) {
  const out = [];
  let carry = 0;
  let prev = -Infinity;
  for (const p of curve ?? []) {
    let t = Number(p?.t);
    if (!Number.isFinite(t)) continue;
    t += carry;
    if (t < prev) {
      carry += MINUTES_PER_DAY;
      t += MINUTES_PER_DAY;
    }
    prev = t;
    out.push({ t, energy: Number(p?.energy) || 0, inertia: Number(p?.inertia) || 0 });
  }
  return out;
}

/**
 * Segment the energy curve into the seven Rise-style zones.
 *
 * Zones are contiguous from wake through the melatonin window — each zone ends
 * exactly where the next begins — and every duration is non-negative. The
 * `sleep` zone starts at target bedtime, which is 30 minutes *inside* the
 * melatonin window by construction.
 *
 * @param {EnergyPoint[]} curve 96 samples from {@link import('./circadian.js').buildEnergyDay}
 * @param {{wakeMin: number, targetBedtimeMin: number, targetWakeMin: number}} opts
 * @returns {Zone[]}
 */
export function detectZones(curve, { wakeMin, targetBedtimeMin, targetWakeMin } = {}) {
  const pts = unwrapCurve(curve);
  const wakeAbs = pts.length ? pts[0].t : Number(wakeMin) || 0;
  const step = pts.length > 1 ? pts[1].t - pts[0].t : 15;

  const bedAbs = wakeAbs + mod1440(Number(targetBedtimeMin) - wakeAbs);
  let sleepSpan = mod1440(Number(targetWakeMin) - Number(targetBedtimeMin));
  if (sleepSpan < 60) sleepSpan += MINUTES_PER_DAY;
  const wakeTargetAbs = bedAbs + sleepSpan;

  const at = (i) => pts[Math.min(pts.length - 1, Math.max(0, i))];
  const inRange = (t, a, b) => t >= a && t <= b;

  // --- grogginess ---------------------------------------------------------
  // A curve with no inertia signal at all is degenerate (flat/synthetic): the
  // clock fallback is the honest answer there.
  const hasInertia = pts.some((p) => p.inertia >= GROGGINESS_INERTIA);
  let grogEnd = wakeAbs + GROGGINESS_FALLBACK_MIN;
  for (const p of hasInertia ? pts : []) {
    if (p.t <= wakeAbs) continue;
    if (p.t > wakeAbs + GROGGINESS_MAX_MIN) break;
    if (p.energy >= GROGGINESS_ENERGY && p.inertia < GROGGINESS_INERTIA) {
      grogEnd = p.t;
      break;
    }
  }
  grogEnd = Math.min(wakeAbs + GROGGINESS_MAX_MIN, Math.max(wakeAbs + step, grogEnd));

  // --- afternoon dip ------------------------------------------------------
  const searchLo = wakeAbs + DIP_SEARCH_START_MIN;
  const searchHi = wakeAbs + DIP_SEARCH_END_MIN;
  const idx = pts.map((p, i) => i).filter((i) => inRange(pts[i].t, searchLo, searchHi));

  let dipStart = wakeAbs + DIP_FALLBACK_START_MIN;
  let dipEnd = wakeAbs + DIP_FALLBACK_END_MIN;

  if (idx.length) {
    let minI = idx[0];
    for (const i of idx) if (pts[i].energy < pts[minI].energy) minI = i;

    const crossesThreshold = idx.some((i) => pts[i].energy < DIP_ENERGY);
    const ceiling = crossesThreshold ? DIP_ENERGY : pts[minI].energy + DIP_RELATIVE_BAND;
    const widenLo = searchLo - DIP_WIDEN_MARGIN_MIN;
    const widenHi = searchHi + DIP_WIDEN_MARGIN_MIN;

    let lo = minI;
    while (lo - 1 >= 0 && pts[lo - 1].t >= widenLo && pts[lo - 1].energy < ceiling) lo -= 1;
    let hi = minI;
    while (hi + 1 < pts.length && pts[hi + 1].t <= widenHi && pts[hi + 1].energy < ceiling) hi += 1;

    dipStart = pts[lo].t;
    dipEnd = Math.min(at(hi + 1).t, pts[hi].t + step);

    if (dipEnd - dipStart > DIP_MAX_WIDTH_MIN) {
      // The curve is flat across the whole search window — no real dip to find.
      dipStart = wakeAbs + DIP_FALLBACK_START_MIN;
      dipEnd = wakeAbs + DIP_FALLBACK_END_MIN;
    }
  }

  // PLAN: the morning peak ends where energy falls below 65 heading down; that
  // slide *is* the start of the dip, so pull `dipStart` back to meet it.
  for (let i = 1; i < pts.length; i += 1) {
    const p = pts[i];
    if (p.t <= grogEnd || p.t >= dipStart) continue;
    if (p.energy < MORNING_PEAK_EXIT_ENERGY && p.energy < pts[i - 1].energy) {
      dipStart = p.t;
      break;
    }
  }

  // --- evening peak / wind-down ------------------------------------------
  let windDownStart = bedAbs - WIND_DOWN_LEAD_MIN;
  for (const p of pts) {
    if (p.t <= dipEnd + 60 || p.t >= windDownStart) continue;
    if (p.energy < EVENING_PEAK_EXIT_ENERGY) {
      windDownStart = Math.max(p.t, bedAbs - WIND_DOWN_MAX_LEAD_MIN);
      break;
    }
  }

  const melStart = bedAbs - MELATONIN_LEAD_MIN;
  const melEnd = bedAbs + MELATONIN_TAIL_MIN;

  // --- force a monotone, gap-free boundary chain --------------------------
  const bounds = [wakeAbs, grogEnd, dipStart, dipEnd, windDownStart, melStart];
  for (let i = 1; i < bounds.length; i += 1) bounds[i] = Math.max(bounds[i], bounds[i - 1]);
  for (let i = bounds.length - 2; i >= 1; i -= 1) bounds[i] = Math.min(bounds[i], bounds[i + 1]);

  const [b0, b1, b2, b3, b4, b5] = bounds;

  return [
    zone('grogginess', b0, b1, `Sleep inertia is still clearing — light, water and movement before anything demanding.`),
    zone('morning_peak', b1, b2, `Your sharpest analytical window — spend it on the hardest thing on your list.`),
    zone('afternoon_dip', b2, b3, `Alertness bottoms out here — batch admin, get outside, or take a short nap.`),
    zone('evening_peak', b3, b4, `A second, softer peak — good for creative work, training or people.`),
    zone('wind_down', b4, b5, `Dim the lights, stop eating and drop screens so melatonin can rise.`),
    zone('melatonin_window', melStart, melEnd, `Your body is primed for sleep onset — be in bed by ${fmtHHMM(bedAbs)}.`),
    zone('sleep', bedAbs, wakeTargetAbs, `Target sleep window: ${fmtHHMM(bedAbs)} → ${fmtHHMM(wakeTargetAbs)}.`),
  ];
}

/**
 * @param {import('./types.js').ZoneKind} kind
 * @param {number} startMin
 * @param {number} endMin
 * @param {string} advice
 * @returns {Zone}
 */
function zone(kind, startMin, endMin, advice) {
  return {
    kind,
    startMin: Math.round(startMin),
    endMin: Math.round(endMin),
    label: ZONE_LABELS[kind] ?? kind,
    advice,
  };
}

/**
 * @param {PlanItem[]} out
 * @param {number} startMin
 * @param {number} endMin
 * @param {import('./types.js').PlanActivity} activity
 * @param {string} reason
 * @param {number} minLength
 */
function push(out, startMin, endMin, activity, reason, minLength = 1) {
  if (!(endMin - startMin >= minLength)) return;
  out.push({ startMin: Math.round(startMin), endMin: Math.round(endMin), activity, reason });
}

/**
 * Turn zones into a concrete plan for the day.
 *
 * Rules (PLAN.md §5): deep work fills the two peaks (the evening peak is split
 * around dinner); the workout is gated on WHOOP recovery — green trains hard in
 * the peak whose side the HRV trend favours, yellow gets a light evening
 * session, red gets none; admin fills the afternoon dip; a 20-minute nap is
 * offered at the top of the dip when debt is real and bedtime is still far off.
 *
 * @param {Object} opts
 * @param {Zone[]} opts.zones
 * @param {NightRecovery|null} [opts.recovery]
 * @param {number} [opts.debtHours]
 * @param {number|null} [opts.targetBedtimeMin]
 * @param {number|null} [opts.hrvMs] last night's HRV
 * @param {number|null} [opts.hrvAvg7d] 7-day average HRV
 * @returns {PlanItem[]} sorted by start time
 */
export function buildDayPlan({
  zones = [],
  recovery = null,
  debtHours = 0,
  targetBedtimeMin = null,
  hrvMs = null,
  hrvAvg7d = null,
} = {}) {
  const find = (kind) => zones.find((z) => z.kind === kind) ?? null;
  const morning = find('morning_peak');
  const dip = find('afternoon_dip');
  const evening = find('evening_peak');
  const windDown = find('wind_down');
  const sleep = find('sleep');

  const anchor = zones.length ? zones[0].startMin : 0;
  const bedAbs = sleep
    ? sleep.startMin
    : Number.isFinite(Number(targetBedtimeMin))
      ? anchor + mod1440(Number(targetBedtimeMin) - anchor)
      : null;

  /** @type {PlanItem[]} */
  const out = [];

  // --- workout (claims part of a peak before deep work is laid out) -------
  const score = Number(recovery?.score);
  const hasScore = Number.isFinite(score);
  let morningWorkout = null;
  let eveningWorkout = null;

  if (!hasScore && evening) {
    eveningWorkout = { dur: WORKOUT_LIGHT_MIN, reason: 'No recovery score available — keep tonight’s session moderate and see how it feels.' };
  } else if (hasScore && score >= RECOVERY_GREEN_MIN) {
    const hrvUp = Number.isFinite(Number(hrvMs)) && Number.isFinite(Number(hrvAvg7d)) && Number(hrvMs) >= Number(hrvAvg7d);
    const reason = `Recovery ${Math.round(score)}% is green${hrvUp ? ' and HRV is at or above your 7-day average' : ''} — this is the day to train hard.`;
    if (hrvUp && morning) morningWorkout = { dur: WORKOUT_HARD_MIN, reason };
    else if (evening) eveningWorkout = { dur: WORKOUT_HARD_MIN, reason };
    else if (morning) morningWorkout = { dur: WORKOUT_HARD_MIN, reason };
  } else if (hasScore && score >= RECOVERY_YELLOW_MIN && evening) {
    eveningWorkout = {
      dur: WORKOUT_LIGHT_MIN,
      reason: `Recovery ${Math.round(score)}% is yellow — a ${WORKOUT_LIGHT_MIN}-minute light session inside the evening peak, nothing maximal.`,
    };
  }
  // red (< RECOVERY_YELLOW_MIN): no workout entry at all — recovery day.

  // --- morning peak -------------------------------------------------------
  if (morning) {
    let start = morning.startMin;
    if (morningWorkout) {
      const end = Math.min(morning.endMin, start + morningWorkout.dur);
      push(out, start, end, 'workout', morningWorkout.reason, 1);
      start = end;
    }
    push(
      out,
      start,
      morning.endMin,
      'deep_work',
      `Energy peaks ${fmtHHMM(start)}–${fmtHHMM(morning.endMin)} — protect it for your hardest cognitive work.`,
      MIN_DEEP_WORK_MIN,
    );
  }

  // --- afternoon dip ------------------------------------------------------
  if (dip) {
    let adminStart = dip.startMin;
    const napFits =
      Number(debtHours) >= NAP_DEBT_MIN_HOURS &&
      bedAbs != null &&
      dip.startMin + NAP_MIN <= bedAbs - NAP_CUTOFF_BEFORE_BED_MIN;
    if (napFits) {
      const napEnd = Math.min(dip.endMin, dip.startMin + NAP_MIN);
      push(
        out,
        dip.startMin,
        napEnd,
        'nap',
        `${Number(debtHours).toFixed(1)}h of sleep debt and bedtime is still ${Math.round((bedAbs - napEnd) / 60)}h away — a ${NAP_MIN}-minute nap here costs you nothing tonight.`,
        1,
      );
      adminStart = napEnd;
    }
    push(
      out,
      adminStart,
      dip.endMin,
      'admin',
      `Lowest alertness of the day — email, errands and a walk outside beat trying to think hard.`,
      MIN_ADMIN_MIN,
    );
  }

  // --- evening peak -------------------------------------------------------
  if (evening) {
    let end = evening.endMin;
    if (eveningWorkout) {
      const start = Math.max(evening.startMin, end - eveningWorkout.dur);
      push(out, start, end, 'workout', eveningWorkout.reason, 1);
      end = start;
    }
    for (const [a, b] of splitAroundDinner(evening.startMin, end)) {
      push(
        out,
        a,
        b,
        'deep_work',
        `Second wind ${fmtHHMM(a)}–${fmtHHMM(b)} — good for creative or generative work.`,
        MIN_DEEP_WORK_MIN,
      );
    }
  }

  // --- evening rails ------------------------------------------------------
  if (windDown) {
    push(
      out,
      windDown.startMin,
      windDown.endMin,
      'wind_down',
      `Lights down and screens off from ${fmtHHMM(windDown.startMin)} so you fall asleep at ${bedAbs == null ? 'your target' : fmtHHMM(bedAbs)}.`,
      1,
    );
  }
  if (sleep) {
    push(
      out,
      sleep.startMin,
      sleep.endMin,
      'bed',
      `Lights out at ${fmtHHMM(sleep.startMin)}; anchor tomorrow’s wake at ${fmtHHMM(sleep.endMin)}.`,
      1,
    );
  }

  return out.sort((a, b) => a.startMin - b.startMin || a.endMin - b.endMin);
}

/**
 * Split a block around the local dinner hour, dropping fragments that are too
 * short to be worth scheduling.
 *
 * @param {number} startMin curve-space
 * @param {number} endMin curve-space
 * @returns {Array<[number, number]>}
 */
export function splitAroundDinner(startMin, endMin) {
  const base = Math.floor(startMin / MINUTES_PER_DAY) * MINUTES_PER_DAY;
  for (const day of [base, base + MINUTES_PER_DAY]) {
    const dStart = day + DINNER_START_MIN;
    const dEnd = day + DINNER_END_MIN;
    if (dStart > startMin && dEnd < endMin) {
      const parts = [];
      if (dStart - startMin >= MIN_DEEP_WORK_MIN) parts.push([startMin, dStart]);
      if (endMin - dEnd >= MIN_DEEP_WORK_MIN) parts.push([dEnd, endMin]);
      if (parts.length) return /** @type {Array<[number, number]>} */ (parts);
    }
  }
  return [[startMin, endMin]];
}

export default { detectZones, buildDayPlan };
