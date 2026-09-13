/**
 * @file Sleep need and Rise-style weighted sleep debt.
 *
 * Every tunable is exported so the CLI, the reports and the README can quote
 * the same numbers. See PLAN.md §5 ("Sleep need" / "Sleep debt").
 *
 * @typedef {import('./types.js').SleepNight} SleepNight
 */

/** Per-night decay applied to older nights: `w_i = DEBT_DECAY^(i-1)`, i=1 is last night. */
export const DEBT_DECAY = 0.9;

/** How many trailing nights contribute to the debt figure. */
export const DEBT_WINDOW = 14;

/** Fallback sleep need when WHOOP reports none (or is still calibrating). */
export const DEFAULT_NEED_MIN = 480;

/** Debt is capped at `DEBT_CAP_MULTIPLIER × need` hours so one bad week cannot run away. */
export const DEBT_CAP_MULTIPLIER = 2;

/**
 * Upper bound (exclusive) of each debt level, in hours. `>= high` is `severe`.
 * PLAN.md §5: `<1 low, 1–3 moderate, 3–5 high, >5 severe`.
 */
export const DEBT_LEVEL_THRESHOLDS = Object.freeze({ low: 1, moderate: 3, high: 5 });

/** Debt levels, ascending. */
export const DEBT_LEVELS = Object.freeze(['low', 'moderate', 'high', 'severe']);

/** Nights per half-window when computing the 7-day trend. */
export const TREND_WINDOW = 7;

/** Difference (hours) between the two 7-night windows below which the trend reads `flat`. */
export const TREND_EPSILON_HOURS = 0.5;

/**
 * Round to two decimal places (debt is always reported in hours).
 *
 * @param {number} n
 * @returns {number}
 */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Nights sorted oldest → newest, defensively copied.
 *
 * @param {SleepNight[]} nights
 * @returns {SleepNight[]}
 */
function chronological(nights) {
  return [...(nights ?? [])]
    .filter((n) => n && typeof n === 'object')
    .sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0));
}

/**
 * Total sleep obtained on a night: main sleep plus any naps.
 *
 * @param {SleepNight} night
 * @returns {number} minutes
 */
export function totalSleepMin(night) {
  return (Number(night?.asleepMin) || 0) + (Number(night?.napMin) || 0);
}

/**
 * Sleep need in minutes: the mean of WHOOP's `needBaselineMin` across the
 * scored nights in the window, ignoring nights recorded while WHOOP was still
 * calibrating. Falls back to {@link DEFAULT_NEED_MIN}.
 *
 * @param {SleepNight[]} nights
 * @param {{overrideMin?: number|null}} [opts] `overrideMin` wins outright (`--need 7.5h`)
 * @returns {number} minutes, rounded
 */
export function computeSleepNeed(nights, { overrideMin } = {}) {
  const override = Number(overrideMin);
  if (Number.isFinite(override) && override > 0) return Math.round(override);

  const window = chronological(nights).slice(-DEBT_WINDOW);
  const usable = window
    .filter((n) => !(n.recovery && n.recovery.calibrating))
    .map((n) => Number(n.needBaselineMin))
    .filter((v) => Number.isFinite(v) && v > 0);

  if (usable.length === 0) return DEFAULT_NEED_MIN;
  return Math.round(usable.reduce((a, b) => a + b, 0) / usable.length);
}

/**
 * Bucket a debt figure into a level.
 *
 * @param {number} hours
 * @returns {'low'|'moderate'|'high'|'severe'}
 */
export function debtLevel(hours) {
  const h = Number(hours) || 0;
  if (h < DEBT_LEVEL_THRESHOLDS.low) return 'low';
  if (h <= DEBT_LEVEL_THRESHOLDS.moderate) return 'moderate';
  if (h <= DEBT_LEVEL_THRESHOLDS.high) return 'high';
  return 'severe';
}

/**
 * Weighted debt over an already-windowed, chronological list of nights.
 * `debtHours = max(0, Σ_i w_i · (need − slept_i) / 60)`, `w_i = DEBT_DECAY^(i−1)`
 * with `i = 1` for the most recent night, capped at `2 × need` hours.
 *
 * @param {SleepNight[]} window chronological (oldest first)
 * @param {number} needMin
 * @returns {number} hours
 */
export function weightedDebtHours(window, needMin) {
  const need = Number(needMin) || DEFAULT_NEED_MIN;
  let sum = 0;
  for (let k = window.length - 1, i = 1; k >= 0; k -= 1, i += 1) {
    const weight = DEBT_DECAY ** (i - 1);
    sum += weight * (need - totalSleepMin(window[k]));
  }
  const cap = (DEBT_CAP_MULTIPLIER * need) / 60;
  return round2(Math.min(cap, Math.max(0, sum / 60)));
}

/**
 * Rise-style sleep debt over the trailing {@link DEBT_WINDOW} nights.
 *
 * @param {SleepNight[]} nights any order; only the last {@link DEBT_WINDOW} are used
 * @param {number} needMin sleep need in minutes (see {@link computeSleepNeed})
 * @returns {{hours: number, level: 'low'|'moderate'|'high'|'severe',
 *   trend7d: 'rising'|'falling'|'flat',
 *   byDay: Array<{date: string, needMin: number, asleepMin: number, deltaMin: number, cumulativeDebtHours: number}>}}
 */
export function computeSleepDebt(nights, needMin) {
  const need = Number(needMin) || DEFAULT_NEED_MIN;
  const window = chronological(nights).slice(-DEBT_WINDOW);

  const hours = weightedDebtHours(window, need);
  const cap = (DEBT_CAP_MULTIPLIER * need) / 60;

  // Running (unweighted) debt, floored at zero and capped, for the report bars.
  let running = 0;
  const byDay = window.map((night) => {
    const slept = totalSleepMin(night);
    const deltaMin = Math.round(need - slept);
    running = Math.min(cap, Math.max(0, running + deltaMin / 60));
    return {
      date: String(night.date),
      needMin: Math.round(need),
      asleepMin: Math.round(slept),
      deltaMin,
      cumulativeDebtHours: round2(running),
    };
  });

  const recent = window.slice(-TREND_WINDOW);
  const prior = window.slice(-2 * TREND_WINDOW, -TREND_WINDOW);
  let trend7d = /** @type {'rising'|'falling'|'flat'} */ ('flat');
  if (recent.length > 0 && prior.length > 0) {
    const delta = weightedDebtHours(recent, need) - weightedDebtHours(prior, need);
    if (delta > TREND_EPSILON_HOURS) trend7d = 'rising';
    else if (delta < -TREND_EPSILON_HOURS) trend7d = 'falling';
  }

  return { hours, level: debtLevel(hours), trend7d, byDay };
}

export default { computeSleepNeed, computeSleepDebt };
