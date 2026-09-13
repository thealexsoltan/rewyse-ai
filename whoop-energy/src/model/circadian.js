/**
 * @file Two-process circadian model: phase anchors, process C, process S,
 * sleep inertia and the 24-hour energy curve (PLAN.md §5).
 *
 * Time convention: every "minute" here is a **local** minute. Values inside the
 * 24-hour curve are kept *monotonic from wake*, so they may exceed 1440
 * (`1515` = 01:15 the next morning). Only `anchors`, `wakeMin`,
 * `targetBedtimeMin` and `targetWakeMin` are wrapped into `[0,1440)`.
 *
 * @typedef {import('./types.js').SleepNight} SleepNight
 * @typedef {import('./types.js').EnergyPoint} EnergyPoint
 * @typedef {import('./types.js').EnergyAnchors} EnergyAnchors
 * @typedef {import('./types.js').EnergyDay} EnergyDay
 */

import { addMinutes, circularMeanMinutes, localToIso } from '../time.js';
import { computeSleepDebt, computeSleepNeed } from './sleepDebt.js';
import { buildDayPlan, detectZones } from './zones.js';

// ---------------------------------------------------------------------------
// Constants (all tunables live here; the README quotes these names)
// ---------------------------------------------------------------------------

/** Minutes in a day. */
export const MINUTES_PER_DAY = 1440;

/** Rise time-constant of homeostatic pressure while awake, in hours. */
export const TAU_WAKE_H = 18.2;
/** Decay time-constant of homeostatic pressure while asleep, in hours. */
export const TAU_SLEEP_H = 4.2;
/** Starting pressure at the beginning of a simulation; irrelevant after ~3 days. */
export const S_INITIAL = 0.5;

/** Peak sleep-inertia penalty, applied at the moment of waking. */
export const INERTIA_AMPLITUDE = 0.35;
/** Exponential decay constant of sleep inertia, in minutes. */
export const INERTIA_TAU_MIN = 30;
/** Sleep inertia is forced to zero beyond this many minutes after wake. */
export const INERTIA_MAX_MIN = 120;

/** Weight of process C in the raw energy signal. */
export const C_WEIGHT = 0.6;
/** Weight of process S in the raw energy signal. */
export const S_WEIGHT = 0.8;
/** Extra homeostatic drag per hour of sleep debt. */
export const DEBT_S_GAIN = 0.15;

/** Amplitude of the 12-hour harmonic of process C. */
export const C_HARMONIC_AMPLITUDE = 0.5;
/** Phase of the 12-hour harmonic of process C, in radians. */
export const C_HARMONIC_PHASE = (-5 * Math.PI) / 8;

/** Core body temperature minimum, relative to habitual wake (minutes). */
export const CBT_OFFSET_MIN = -120;
/** Dim-light melatonin onset, relative to the CBT minimum (minutes). */
export const DLMO_OFFSET_MIN = -420;

/** Bedtime is pulled this many minutes earlier per hour of sleep debt. */
export const PAYBACK_PER_DEBT_HOUR_MIN = 15;
/** Hard cap on the bedtime shift, however large the debt. */
export const MAX_PAYBACK_MIN = 45;
/** Target bedtime is never advanced earlier than DLMO + this many minutes. */
export const MIN_BEDTIME_AFTER_DLMO_MIN = 90;

/** Target bed/wake times are rounded to this grid. */
export const ROUND_TO_MIN = 5;
/** Shortest sleep span the target window may describe. */
export const MIN_SLEEP_SPAN_MIN = 240;

/** Nights used for the circular-mean phase anchors. */
export const ANCHOR_WINDOW_NIGHTS = 7;
/** Samples in the 24-hour curve. */
export const CURVE_POINTS = 96;
/** Spacing between curve samples, in minutes. */
export const CURVE_STEP_MIN = 15;

/** Wake time assumed when there is no sleep history at all. */
export const DEFAULT_WAKE_MIN = 7 * 60;
/** Bedtime assumed when there is no sleep history at all. */
export const DEFAULT_BEDTIME_MIN = 23 * 60;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** @param {number} m @returns {number} `m` wrapped into `[0,1440)` */
function wrap(m) {
  const n = Math.round(Number(m) || 0);
  return ((n % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** @param {number} m @returns {number} `m` reduced into `[0,1440)` without rounding away from zero */
function mod1440(m) {
  const n = Number(m) || 0;
  return ((n % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/** @param {number} v @param {number} lo @param {number} hi @returns {number} */
function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

/** @param {number} v @param {number} step @returns {number} */
function roundTo(v, step) {
  return Math.round(v / step) * step;
}

/** @param {number} n @param {number} [dp=4] @returns {number} */
function round(n, dp = 4) {
  const f = 10 ** dp;
  return Math.round(n * f) / f;
}

/**
 * @param {SleepNight[]} nights
 * @returns {SleepNight[]} copy sorted oldest → newest
 */
function chronological(nights) {
  return [...(nights ?? [])]
    .filter((n) => n && typeof n === 'object')
    .sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0));
}

/** Homeostatic pressure after `dt` minutes awake. @param {number} s @param {number} dt @returns {number} */
export function wakeStep(s, dt) {
  if (!(dt > 0)) return s;
  return 1 - (1 - s) * Math.exp(-dt / (TAU_WAKE_H * 60));
}

/** Homeostatic pressure after `dt` minutes asleep. @param {number} s @param {number} dt @returns {number} */
export function sleepStep(s, dt) {
  if (!(dt > 0)) return s;
  return s * Math.exp(-dt / (TAU_SLEEP_H * 60));
}

/**
 * ISO instant for a local minute-of-day offset from midnight of `date`.
 * Minutes may exceed 1440 or be negative; the date rolls accordingly.
 *
 * @param {string} date `YYYY-MM-DD`
 * @param {number} tzOffsetMin
 * @param {number} minutes
 * @returns {string} ISO 8601
 */
export function isoAtMinute(date, tzOffsetMin, minutes) {
  const midnight = localToIso(date, 0, tzOffsetMin);
  const shifted = addMinutes(midnight, minutes);
  return typeof shifted === 'string' ? shifted : localToIso(date, minutes, tzOffsetMin);
}

// ---------------------------------------------------------------------------
// Anchors
// ---------------------------------------------------------------------------

/**
 * Circadian phase anchors from the last {@link ANCHOR_WINDOW_NIGHTS} nights.
 * Circular means are used so schedules that cross midnight (bedtime 00:30)
 * average correctly instead of collapsing towards noon.
 *
 * @param {SleepNight[]} nights
 * @returns {EnergyAnchors}
 */
export function computeAnchors(nights) {
  const window = chronological(nights).slice(-ANCHOR_WINDOW_NIGHTS);

  const wakes = window.map((n) => Number(n.wakeMin)).filter(Number.isFinite);
  const bedtimes = window.map((n) => Number(n.bedtimeMin)).filter(Number.isFinite);
  const midsleeps = window
    .filter((n) => Number.isFinite(n.bedtimeMin) && Number.isFinite(n.wakeMin))
    .map((n) => wrap(n.bedtimeMin + mod1440(n.wakeMin - n.bedtimeMin) / 2));

  const habitualWakeMin = circularMeanMinutes(wakes) ?? DEFAULT_WAKE_MIN;
  const habitualBedtimeMin = circularMeanMinutes(bedtimes) ?? DEFAULT_BEDTIME_MIN;
  const midsleepMin =
    circularMeanMinutes(midsleeps) ??
    wrap(habitualBedtimeMin + mod1440(habitualWakeMin - habitualBedtimeMin) / 2);

  const cbtMin = wrap(habitualWakeMin + CBT_OFFSET_MIN);
  const dlmo = wrap(cbtMin + DLMO_OFFSET_MIN);

  return { cbtMin, dlmo, habitualWakeMin, habitualBedtimeMin, midsleepMin };
}

// ---------------------------------------------------------------------------
// Process C
// ---------------------------------------------------------------------------

/**
 * Process C — the circadian drive for alertness.
 *
 * `C(t) = cos(θ) + A·cos(2θ + φ)` with
 * `θ = 2π·(t − (cbtMin + 12h)) / 24h`, `A =` {@link C_HARMONIC_AMPLITUDE},
 * `φ =` {@link C_HARMONIC_PHASE}. The fundamental puts the trough at the core
 * body temperature minimum; the 12-hour harmonic carves the post-lunch dip out
 * of the broad late-afternoon/evening peak.
 *
 * @param {number} tMin local minutes (may exceed 1440 — C is 24h-periodic)
 * @param {EnergyAnchors|{cbtMin: number}} anchors
 * @returns {number} roughly -1.4 … 1.4
 */
export function processC(tMin, anchors) {
  const cbt = Number(anchors?.cbtMin) || 0;
  const theta = (2 * Math.PI * (Number(tMin) - (cbt + MINUTES_PER_DAY / 2))) / MINUTES_PER_DAY;
  return Math.cos(theta) + C_HARMONIC_AMPLITUDE * Math.cos(2 * theta + C_HARMONIC_PHASE);
}

// ---------------------------------------------------------------------------
// Process S
// ---------------------------------------------------------------------------

/**
 * Merge every sleep episode (main sleeps + naps) into sorted, non-overlapping
 * absolute-minute intervals.
 *
 * @param {SleepNight[]} nights
 * @returns {Array<[number, number]>}
 */
export function sleepIntervals(nights) {
  /** @type {Array<[number, number]>} */
  const raw = [];
  const push = (start, end) => {
    const a = Date.parse(String(start));
    const b = Date.parse(String(end));
    if (Number.isFinite(a) && Number.isFinite(b) && b > a) raw.push([a / 60000, b / 60000]);
  };
  for (const night of nights ?? []) {
    push(night?.start, night?.end);
    for (const nap of night?.naps ?? []) push(nap?.start, nap?.end);
  }
  raw.sort((x, y) => x[0] - y[0]);

  /** @type {Array<[number, number]>} */
  const merged = [];
  for (const iv of raw) {
    const last = merged[merged.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else merged.push([iv[0], iv[1]]);
  }
  return merged;
}

/**
 * Homeostatic sleep pressure at an instant, simulated over the actual
 * sleep/wake record. Starts at {@link S_INITIAL} at the first recorded sleep
 * onset; after ~3 days that starting value no longer matters.
 *
 * @param {SleepNight[]} nights
 * @param {{upToIso?: string|null}} [opts] instant to evaluate at (default: the last recorded wake)
 * @returns {number} S in `[0,1]`
 */
export function simulateS(nights, { upToIso = null } = {}) {
  const intervals = sleepIntervals(nights);
  if (intervals.length === 0) return S_INITIAL;

  const parsed = upToIso == null ? NaN : Date.parse(String(upToIso)) / 60000;
  const target = Number.isFinite(parsed) ? parsed : intervals[intervals.length - 1][1];

  let s = S_INITIAL;
  let cursor = intervals[0][0];
  if (target <= cursor) return s;

  for (const [a, b] of intervals) {
    if (cursor < a) {
      const to = Math.min(a, target);
      s = wakeStep(s, to - cursor);
      cursor = to;
      if (cursor >= target) return s;
    }
    if (target <= a) return s;
    const to = Math.min(b, target);
    s = sleepStep(s, to - Math.max(cursor, a));
    cursor = to;
    if (cursor >= target) return s;
  }
  return wakeStep(s, target - cursor);
}

/**
 * Steady-state pressure at wake for a perfectly regular schedule — the fallback
 * when there is no usable sleep record to simulate.
 *
 * @param {number} bedtimeMin
 * @param {number} wakeMin
 * @returns {number}
 */
export function steadyStateSAtWake(bedtimeMin, wakeMin) {
  const asleep = mod1440(wakeMin - bedtimeMin) || 480;
  const awake = MINUTES_PER_DAY - asleep;
  let s = S_INITIAL;
  for (let i = 0; i < 14; i += 1) {
    s = wakeStep(s, awake);
    s = sleepStep(s, asleep);
  }
  return s;
}

// ---------------------------------------------------------------------------
// Sleep inertia
// ---------------------------------------------------------------------------

/**
 * Sleep inertia penalty: `I(t) = 0.35·e^(−(t − wake)/30min)` for the first two
 * hours after waking, zero elsewhere.
 *
 * @param {number} tMin
 * @param {number} wakeMin same time base as `tMin`
 * @returns {number} 0 … {@link INERTIA_AMPLITUDE}
 */
export function sleepInertia(tMin, wakeMin) {
  const dt = Number(tMin) - Number(wakeMin);
  if (!(dt >= 0) || dt > INERTIA_MAX_MIN) return 0;
  return INERTIA_AMPLITUDE * Math.exp(-dt / INERTIA_TAU_MIN);
}

// ---------------------------------------------------------------------------
// The day
// ---------------------------------------------------------------------------

/**
 * Build the full `EnergyDay` payload for one date.
 *
 * @param {Object} opts
 * @param {SleepNight[]} opts.nights normalised nights, any order
 * @param {number} [opts.needMin] sleep need; derived from the nights when omitted
 * @param {number|null} [opts.nowMin] "now" as local minutes-of-day, or null
 * @param {number} [opts.tzOffsetMin] local offset east of UTC, in minutes
 * @param {string} [opts.date] the day to build (`YYYY-MM-DD`); defaults to the last night's date
 * @returns {EnergyDay}
 */
export function buildEnergyDay({ nights = [], needMin, nowMin = null, tzOffsetMin = 0, date } = {}) {
  const list = chronological(nights);
  const anchors = computeAnchors(list);

  const need = Number.isFinite(Number(needMin)) && Number(needMin) > 0
    ? Math.round(Number(needMin))
    : computeSleepNeed(list);
  const debt = computeSleepDebt(list, need);

  const mostRecent = list[list.length - 1] ?? null;
  const day = date ?? mostRecent?.date ?? '1970-01-01';
  const todayNight = list.find((n) => n.date === day) ?? null;
  const lastNight = todayNight ?? mostRecent;
  const offset = Number.isFinite(Number(tzOffsetMin))
    ? Number(tzOffsetMin)
    : Number(lastNight?.tzOffsetMin) || 0;

  // Today's wake: last night's actual wake, else the habitual anchor.
  const wakeMin = todayNight && Number.isFinite(todayNight.wakeMin)
    ? wrap(todayNight.wakeMin)
    : anchors.habitualWakeMin;

  // --- targets ------------------------------------------------------------
  const payback = clamp(debt.hours * PAYBACK_PER_DEBT_HOUR_MIN, 0, MAX_PAYBACK_MIN);
  const habitualBedAbs = wakeMin + mod1440(anchors.habitualBedtimeMin - wakeMin);
  const dlmoAbs = wakeMin + mod1440(anchors.dlmo - wakeMin);
  // Never advance bedtime past DLMO + 90 min (PLAN §5 guard) — but the DLMO
  // estimate is derived from habitual *wake* alone, so for anyone whose sleep
  // opportunity is longer than ~7.5 h it lands at or after their habitual
  // bedtime. Taking it as the floor there would silently cancel the whole debt
  // payback (the tool would print "severe debt, go to bed earlier" next to a
  // target bedtime identical to the habitual one). When that happens the
  // sleeper's own schedule is the better evidence of their phase, so the floor
  // falls back to the largest advance the payback cap allows.
  const dlmoFloorAbs = dlmoAbs + MIN_BEDTIME_AFTER_DLMO_MIN;
  const floorAbs = dlmoFloorAbs < habitualBedAbs ? dlmoFloorAbs : habitualBedAbs - MAX_PAYBACK_MIN;
  const targetBedAbs = roundTo(clamp(habitualBedAbs - payback, floorAbs, habitualBedAbs), ROUND_TO_MIN);
  let sleepSpan = mod1440(roundTo(anchors.habitualWakeMin, ROUND_TO_MIN) - targetBedAbs);
  if (sleepSpan < MIN_SLEEP_SPAN_MIN) sleepSpan += MINUTES_PER_DAY;
  const targetWakeAbs = targetBedAbs + sleepSpan;

  const targetBedtimeMin = wrap(targetBedAbs);
  const targetWakeMin = wrap(targetWakeAbs);

  // --- curve --------------------------------------------------------------
  const sAtWake = todayNight
    ? simulateS(list, { upToIso: todayNight.end })
    : steadyStateSAtWake(anchors.habitualBedtimeMin, anchors.habitualWakeMin);

  const sAtBed = wakeStep(sAtWake, targetBedAbs - wakeMin);
  const sAtTargetWake = sleepStep(sAtBed, targetWakeAbs - targetBedAbs);
  const debtGain = 1 + DEBT_S_GAIN * debt.hours;

  const samples = [];
  for (let i = 0; i < CURVE_POINTS; i += 1) {
    const t = wakeMin + i * CURVE_STEP_MIN;
    let S;
    if (t <= targetBedAbs) S = wakeStep(sAtWake, t - wakeMin);
    else if (t < targetWakeAbs) S = sleepStep(sAtBed, t - targetBedAbs);
    else S = wakeStep(sAtTargetWake, t - targetWakeAbs);

    const C = processC(t, anchors);
    const inertia = t >= targetWakeAbs ? sleepInertia(t, targetWakeAbs) : sleepInertia(t, wakeMin);
    const raw = C_WEIGHT * C - S_WEIGHT * S * debtGain - inertia;
    const awake = t <= targetBedAbs || t >= targetWakeAbs;
    samples.push({ t, S, C, inertia, raw, awake });
  }

  const waking = samples.filter((p) => p.awake);
  const pool = waking.length > 1 ? waking : samples;
  const lo = Math.min(...pool.map((p) => p.raw));
  const hi = Math.max(...pool.map((p) => p.raw));
  const span = hi - lo;

  /** @type {EnergyPoint[]} */
  const curve = samples.map((p) => ({
    t: p.t,
    iso: isoAtMinute(day, offset, p.t),
    energy: span > 1e-9 ? round(clamp(((p.raw - lo) / span) * 100, 0, 100), 1) : 50,
    S: round(p.S),
    C: round(p.C),
    inertia: round(p.inertia),
  }));

  // --- zones + plan -------------------------------------------------------
  const zones = detectZones(curve, { wakeMin, targetBedtimeMin, targetWakeMin });

  const hrvSeries = list
    .slice(-ANCHOR_WINDOW_NIGHTS)
    .map((n) => Number(n.recovery?.hrvMs))
    .filter(Number.isFinite);
  const hrvAvg7d = hrvSeries.length ? hrvSeries.reduce((a, b) => a + b, 0) / hrvSeries.length : null;

  const plan = buildDayPlan({
    zones,
    recovery: lastNight?.recovery ?? null,
    debtHours: debt.hours,
    targetBedtimeMin,
    hrvMs: lastNight?.recovery?.hrvMs ?? null,
    hrvAvg7d,
  });

  return {
    date: day,
    tzOffsetMin: offset,
    now: Number.isFinite(Number(nowMin)) ? wrap(nowMin) : null,
    wakeMin,
    targetBedtimeMin,
    targetWakeMin,
    anchors,
    need: { baselineMin: need, todayMin: Math.round(need + payback) },
    debt: { hours: debt.hours, trend7d: debt.trend7d, level: debt.level },
    curve,
    zones,
    plan,
    recovery: lastNight?.recovery ?? null,
    lastNight: lastNight ?? null,
  };
}

export default { computeAnchors, processC, simulateS, sleepInertia, buildEnergyDay };
