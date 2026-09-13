/**
 * @file Canonical data contracts shared by every whoop-energy module.
 *
 * This file exports no runtime values other than the small enum-ish frozen
 * lists below; its purpose is to be the single source of truth for the JSDoc
 * typedefs that `model/*`, `report/*` and `bin/whoop-energy.js` program against.
 * Import it for the side effect of type resolution:
 *
 * ```js
 * /** @typedef {import('./types.js').SleepNight} SleepNight *\/
 * ```
 */

/**
 * A nap merged into a night.
 * @typedef {Object} Nap
 * @property {string} start ISO instant
 * @property {string} end ISO instant
 * @property {number} asleepMin minutes actually asleep (light + SWS + REM)
 */

/**
 * Recovery scores joined onto a night via `recovery.sleep_id`.
 * @typedef {Object} NightRecovery
 * @property {number|null} score WHOOP recovery score, 0–100
 * @property {number|null} hrvMs HRV (RMSSD) in milliseconds
 * @property {number|null} rhr resting heart rate, bpm
 * @property {number|null} spo2 blood oxygen, percent
 * @property {number|null} skinTempC skin temperature, Celsius
 * @property {boolean} calibrating true while WHOOP is still calibrating the user
 */

/**
 * One wake-date's sleep: the main sleep plus any naps that happened during the
 * following waking day. Times are ISO strings; all durations are whole minutes.
 *
 * @typedef {Object} SleepNight
 * @property {string} date local date of the WAKE (`YYYY-MM-DD`) — the day this sleep powers
 * @property {string} start ISO start of the main sleep
 * @property {string} end ISO end of the main sleep
 * @property {number} tzOffsetMin local offset in minutes east of UTC (e.g. 120)
 * @property {number} bedtimeMin local minutes-of-day of sleep onset, normalised to `[0,1440)`
 * @property {boolean} bedtimeAfterMidnight true when the main sleep started on the wake date itself
 * @property {number} wakeMin local minutes-of-day of wake, in `[0,1440)`
 * @property {number} inBedMin
 * @property {number} asleepMin light + SWS + REM
 * @property {number} awakeMin
 * @property {number} lightMin
 * @property {number} swsMin slow-wave (deep) sleep
 * @property {number} remMin
 * @property {number|null} efficiencyPct
 * @property {number|null} performancePct
 * @property {number|null} consistencyPct
 * @property {number|null} respiratoryRate
 * @property {number|null} disturbances
 * @property {number} needBaselineMin
 * @property {number} needFromDebtMin
 * @property {number} needFromStrainMin
 * @property {number} needFromNapMin
 * @property {number} needTotalMin sum of the four `need*` parts
 * @property {Nap[]} naps
 * @property {number} napMin sum of `naps[].asleepMin`
 * @property {NightRecovery|null} recovery
 * @property {number|null} strain cycle strain of the day that PRECEDED this sleep
 * @property {string} sleepId WHOOP sleep record id
 * @property {number} sleepCycleCount
 */

/**
 * One sample of the modelled 24-hour energy curve.
 * @typedef {Object} EnergyPoint
 * @property {number} t minutes-of-day
 * @property {string} iso absolute instant for this sample
 * @property {number} energy 0–100 (normalised over the waking span)
 * @property {number} S homeostatic sleep pressure, 0–1
 * @property {number} C circadian process, roughly -1.25..1.25
 * @property {number} inertia sleep inertia penalty, 0–0.35
 */

/**
 * @typedef {'grogginess'|'morning_peak'|'afternoon_dip'|'evening_peak'|'wind_down'|'melatonin_window'|'sleep'} ZoneKind
 */

/**
 * @typedef {Object} Zone
 * @property {ZoneKind} kind
 * @property {number} startMin
 * @property {number} endMin
 * @property {string} label
 * @property {string} advice
 */

/**
 * @typedef {'deep_work'|'workout'|'admin'|'nap'|'wind_down'|'bed'} PlanActivity
 */

/**
 * @typedef {Object} PlanItem
 * @property {number} startMin
 * @property {number} endMin
 * @property {PlanActivity} activity
 * @property {string} reason
 */

/**
 * @typedef {Object} EnergyAnchors
 * @property {number} cbtMin core-body-temperature minimum, minutes-of-day
 * @property {number} dlmo dim-light melatonin onset, minutes-of-day
 * @property {number} habitualWakeMin
 * @property {number} habitualBedtimeMin
 * @property {number} midsleepMin
 */

/**
 * @typedef {Object} DebtSummary
 * @property {number} hours weighted sleep debt in hours
 * @property {'rising'|'falling'|'flat'} trend7d
 * @property {'low'|'moderate'|'high'|'severe'} level
 */

/**
 * The full "today" payload every renderer consumes.
 * @typedef {Object} EnergyDay
 * @property {string} date
 * @property {number} tzOffsetMin
 * @property {number|null} now minutes-of-day, or null when not "today"
 * @property {number} wakeMin today's actual wake
 * @property {number} targetBedtimeMin tonight's target bedtime
 * @property {number} targetWakeMin tomorrow's target wake
 * @property {EnergyAnchors} anchors
 * @property {{ baselineMin: number, todayMin: number }} need
 * @property {DebtSummary} debt
 * @property {EnergyPoint[]} curve 96 points at 15-minute steps, wake → wake+24h
 * @property {Zone[]} zones
 * @property {PlanItem[]} plan
 * @property {NightRecovery|null} recovery
 * @property {SleepNight|null} lastNight
 */

/**
 * @typedef {Object} Correlation
 * @property {string} x
 * @property {string} y
 * @property {number} r Pearson coefficient
 * @property {number} n sample size
 * @property {string} reading plain-English interpretation
 */

/**
 * @typedef {Object} Recommendation
 * @property {number} rank 1 = most important
 * @property {string} title
 * @property {string} why
 * @property {string} action
 * @property {'high'|'medium'|'low'} impact
 */

/**
 * @typedef {Object} Insights
 * @property {number} windowDays
 * @property {number} nights
 * @property {{ hours: number, level: string, trend7d: string, byDay: Array<{date: string, needMin: number, asleepMin: number, deltaMin: number, cumulativeDebtHours: number}> }} debt
 * @property {{ bedtimeSdMin: number|null, wakeSdMin: number|null, whoopConsistencyAvg: number|null }} consistency
 * @property {{ efficiencyAvg: number|null, disturbancesAvg: number|null, swsPctAvg: number|null, remPctAvg: number|null, performanceAvg: number|null }} quality
 * @property {{ avg: number|null, avg7d: number|null, hrvAvg: number|null, hrvAvg7d: number|null, hrvDeltaPct: number|null, rhrAvg: number|null, rhrAvg7d: number|null, calibrating: boolean }} recovery
 * @property {Correlation[]} correlations
 * @property {Recommendation[]} recommendations
 */

/**
 * Raw WHOOP payloads as cached by `whoop/sync.js`.
 * @typedef {Object} WhoopCache
 * @property {string} fetchedAt ISO instant
 * @property {number} days window size requested
 * @property {Object[]} sleep
 * @property {Object[]} recovery
 * @property {Object[]} cycle
 */

/** Zone kinds, in the order they occur across a day. */
export const ZONE_KINDS = Object.freeze([
  'grogginess',
  'morning_peak',
  'afternoon_dip',
  'evening_peak',
  'wind_down',
  'melatonin_window',
  'sleep',
]);

/** Day-plan activity kinds. */
export const PLAN_ACTIVITIES = Object.freeze([
  'deep_work',
  'workout',
  'admin',
  'nap',
  'wind_down',
  'bed',
]);

/** Sleep-debt levels, ascending. */
export const DEBT_LEVELS = Object.freeze(['low', 'moderate', 'high', 'severe']);

/** WHOOP `score_state` values that carry a usable `score` object. */
export const SCORED_STATES = Object.freeze(['SCORED']);

export default { ZONE_KINDS, PLAN_ACTIVITIES, DEBT_LEVELS, SCORED_STATES };
