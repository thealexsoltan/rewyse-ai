/**
 * @file Turn raw WHOOP v2 records into the canonical `SleepNight[]` contract.
 *
 * @typedef {import('./types.js').SleepNight} SleepNight
 * @typedef {import('./types.js').Nap} Nap
 * @typedef {import('./types.js').NightRecovery} NightRecovery
 */

import { parseTzOffset, toLocalMinutes, localDateString, minutesBetween } from '../time.js';

/** `score_state` values that carry a usable `score` object. */
export const SCORED_STATE = 'SCORED';

/**
 * Convert a millisecond duration to whole minutes.
 *
 * @param {number|null|undefined} milli
 * @returns {number}
 */
export function milliToMin(milli) {
  const n = Number(milli);
  return Number.isFinite(n) ? Math.round(n / 60000) : 0;
}

/**
 * True when a WHOOP record has been scored and carries a `score` object.
 * Unscored (`PENDING_SCORE`) and unscorable records are skipped by the model.
 *
 * @param {{score_state?: string, score?: unknown}|null|undefined} record
 * @returns {boolean}
 */
export function isScored(record) {
  if (!record) return false;
  if (!record.score || typeof record.score !== 'object') return false;
  if (record.score_state && record.score_state !== SCORED_STATE) return false;
  return true;
}

/**
 * Index recovery records by the sleep they were computed from.
 *
 * @param {any[]} recovery
 * @returns {Map<string, any>}
 */
export function indexRecoveryBySleepId(recovery) {
  const map = new Map();
  for (const r of recovery ?? []) {
    if (!isScored(r)) continue;
    const key = r.sleep_id ?? r.sleepId;
    if (key === undefined || key === null) continue;
    map.set(String(key), r);
  }
  return map;
}

/**
 * Find the physiological cycle whose `[start, end]` interval contains an
 * instant. `end` is `null` for the currently open cycle, which is treated as
 * running to `+Infinity`. When several cycles match, the latest-starting one wins.
 *
 * @param {any[]} cycles
 * @param {string|number|Date} instant
 * @returns {any|null}
 */
export function findCycleForInstant(cycles, instant) {
  const t = instant instanceof Date ? instant.getTime() : Date.parse(String(instant));
  if (!Number.isFinite(t)) return null;
  let best = null;
  let bestStart = -Infinity;
  for (const c of cycles ?? []) {
    const s = Date.parse(c?.start ?? '');
    if (!Number.isFinite(s) || s > t) continue;
    const e = c?.end == null ? Infinity : Date.parse(c.end);
    if (Number.isFinite(e) && t > e) continue;
    if (s > bestStart) {
      bestStart = s;
      best = c;
    }
  }
  return best;
}

/**
 * Project a scored recovery record onto the `NightRecovery` contract.
 *
 * @param {any|null|undefined} record
 * @returns {NightRecovery|null}
 */
export function toNightRecovery(record) {
  if (!isScored(record)) return null;
  const s = record.score ?? {};
  return {
    score: numOrNull(s.recovery_score),
    hrvMs: numOrNull(s.hrv_rmssd_milli),
    rhr: numOrNull(s.resting_heart_rate),
    spo2: numOrNull(s.spo2_percentage),
    skinTempC: numOrNull(s.skin_temp_celsius),
    calibrating: Boolean(s.user_calibrating),
  };
}

/** @param {unknown} v @returns {number|null} */
function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Project a scored sleep record onto the parts of `SleepNight` that come from
 * the sleep record alone (no recovery / strain / naps yet).
 *
 * @param {any} record a scored WHOOP v2 sleep record
 * @param {{ tzOffsetMin?: number }} [opts] override the record's own offset
 * @returns {SleepNight}
 */
export function normalizeSleepRecord(record, opts = {}) {
  const tzOffsetMin = opts.tzOffsetMin ?? parseTzOffset(record.timezone_offset, 0);
  const stages = record.score?.stage_summary ?? {};
  const needed = record.score?.sleep_needed ?? {};

  const lightMin = milliToMin(stages.total_light_sleep_time_milli);
  const swsMin = milliToMin(stages.total_slow_wave_sleep_time_milli);
  const remMin = milliToMin(stages.total_rem_sleep_time_milli);
  const inBedMin = milliToMin(stages.total_in_bed_time_milli) || Math.max(0, minutesBetween(record.start, record.end));
  const awakeMin = milliToMin(stages.total_awake_time_milli);

  const needBaselineMin = milliToMin(needed.baseline_milli);
  const needFromDebtMin = milliToMin(needed.need_from_sleep_debt_milli);
  const needFromStrainMin = milliToMin(needed.need_from_recent_strain_milli);
  const needFromNapMin = milliToMin(needed.need_from_recent_nap_milli);

  const date = localDateString(record.end, tzOffsetMin);
  const bedtimeMin = toLocalMinutes(record.start, tzOffsetMin);
  const wakeMin = toLocalMinutes(record.end, tzOffsetMin);
  // "After midnight" means the sleep onset already fell on the wake date.
  const bedtimeAfterMidnight = localDateString(record.start, tzOffsetMin) === date;

  return {
    date,
    start: record.start,
    end: record.end,
    tzOffsetMin,
    bedtimeMin,
    bedtimeAfterMidnight,
    wakeMin,
    inBedMin,
    asleepMin: lightMin + swsMin + remMin,
    awakeMin,
    lightMin,
    swsMin,
    remMin,
    efficiencyPct: numOrNull(record.score?.sleep_efficiency_percentage),
    performancePct: numOrNull(record.score?.sleep_performance_percentage),
    consistencyPct: numOrNull(record.score?.sleep_consistency_percentage),
    respiratoryRate: numOrNull(record.score?.respiratory_rate),
    disturbances: numOrNull(stages.disturbance_count),
    needBaselineMin,
    needFromDebtMin,
    needFromStrainMin,
    needFromNapMin,
    needTotalMin: needBaselineMin + needFromDebtMin + needFromStrainMin + needFromNapMin,
    naps: [],
    napMin: 0,
    recovery: null,
    strain: null,
    sleepId: String(record.id ?? ''),
    sleepCycleCount: Number(stages.sleep_cycle_count) || 0,
  };
}

/**
 * Normalise raw WHOOP payloads into `SleepNight[]`, sorted by date ascending.
 *
 * Joins performed here:
 * - **naps** (`nap: true`) attach to the night whose local wake date equals the
 *   nap's own local date (a nap on Tuesday belongs to Tuesday's night entry,
 *   i.e. the sleep the user woke from that Tuesday morning);
 * - **recovery** joins on `recovery.sleep_id === sleep.id`;
 * - **strain** comes from the cycle whose `[start, end]` contains the main
 *   sleep's start — i.e. the waking day that preceded the sleep. `end` is
 *   `null` for the open cycle.
 *
 * Unscored records (`PENDING_SCORE` / `UNSCORABLE`, or a missing `score`) are skipped.
 *
 * @param {{ sleep?: any[], recovery?: any[], cycle?: any[] }} raw
 * @param {{ tzOffsetMin?: number }} [opts] force a timezone offset for every record
 * @returns {SleepNight[]}
 */
export function normalizeNights(raw, opts = {}) {
  const sleepRecords = (raw?.sleep ?? []).filter(isScored);
  const recoveryById = indexRecoveryBySleepId(raw?.recovery ?? []);
  const cycles = raw?.cycle ?? [];

  const mains = sleepRecords.filter((r) => !r.nap);
  const napRecords = sleepRecords.filter((r) => Boolean(r.nap));

  /** @type {Map<string, SleepNight>} */
  const byDate = new Map();
  /** @type {any[]} */
  const demotedToNaps = [];

  for (const record of mains) {
    const night = normalizeSleepRecord(record, opts);
    const existing = byDate.get(night.date);
    if (!existing) {
      byDate.set(night.date, night);
      continue;
    }
    // Two main sleeps ending on the same local date: the longer one is the
    // night, the shorter is folded in as a nap.
    if (night.asleepMin > existing.asleepMin) {
      byDate.set(night.date, night);
      demotedToNaps.push({ date: existing.date, start: existing.start, end: existing.end, asleepMin: existing.asleepMin });
    } else {
      demotedToNaps.push({ date: night.date, start: night.start, end: night.end, asleepMin: night.asleepMin });
    }
  }

  const nights = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // --- naps -----------------------------------------------------------------
  for (const record of napRecords) {
    const tzOffsetMin = opts.tzOffsetMin ?? parseTzOffset(record.timezone_offset, 0);
    const napDate = localDateString(record.start, tzOffsetMin);
    const host = byDate.get(napDate);
    if (!host) continue;
    const stages = record.score?.stage_summary ?? {};
    const asleepMin =
      milliToMin(stages.total_light_sleep_time_milli) +
      milliToMin(stages.total_slow_wave_sleep_time_milli) +
      milliToMin(stages.total_rem_sleep_time_milli);
    host.naps.push({ start: record.start, end: record.end, asleepMin });
  }
  for (const nap of demotedToNaps) {
    const host = byDate.get(nap.date);
    if (host) host.naps.push({ start: nap.start, end: nap.end, asleepMin: nap.asleepMin });
  }
  for (const night of nights) {
    night.naps.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
    night.napMin = night.naps.reduce((sum, n) => sum + (Number(n.asleepMin) || 0), 0);
  }

  // --- recovery + strain ----------------------------------------------------
  for (const night of nights) {
    night.recovery = toNightRecovery(recoveryById.get(night.sleepId));
    const cycle = findCycleForInstant(cycles, night.start);
    night.strain = isScored(cycle) ? numOrNull(cycle.score.strain) : null;
  }

  return nights;
}

export default normalizeNights;
