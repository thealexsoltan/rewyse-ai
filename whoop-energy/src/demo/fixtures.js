/**
 * @file Deterministic synthetic WHOOP v2 records for `--demo` and for hermetic tests.
 *
 * Every value is produced by a seeded mulberry32 PRNG, so the same `seed`
 * always yields byte-identical records. The shapes match the WHOOP v2 REST
 * payloads documented in `PLAN.md` §3 exactly, including `score_state`,
 * `timezone_offset` and the `*_milli` duration fields.
 */

import { parseTzOffset, localDateString, localToIso, addDays, minutesBetween } from '../time.js';

/** Synthetic WHOOP user id used across all demo records. */
export const DEMO_USER_ID = 10_001_337;

/** Tunable demo constants (documented in README). */
export const DEMO_CONSTANTS = Object.freeze({
  /** Habitual bedtime, local minutes-of-day (23:30). */
  BEDTIME_BASE_MIN: 1410,
  /** Bedtime jitter, ± minutes. */
  BEDTIME_JITTER_MIN: 40,
  /** Habitual wake, local minutes-of-day (07:15). */
  WAKE_BASE_MIN: 435,
  /** Wake jitter, ± minutes. */
  WAKE_JITTER_MIN: 25,
  /** Extra minutes of lateness on Friday/Saturday nights. */
  WEEKEND_BEDTIME_SHIFT_MIN: 45,
  /** Extra minutes of lie-in on Saturday/Sunday mornings. */
  WEEKEND_WAKE_SHIFT_MIN: 55,
  /** Sleep-need baseline, minutes (7h50m). */
  NEED_BASELINE_MIN: 470,
  /** Minimum / maximum time actually asleep on a normal night, minutes. */
  ASLEEP_MIN_MIN: 372,
  ASLEEP_MAX_MIN: 468,
  /** Sleep efficiency range. */
  EFFICIENCY_MIN: 0.86,
  EFFICIENCY_MAX: 0.95,
  /** The deliberately short night, minutes asleep, N days before endDate. */
  SHORT_NIGHT_ASLEEP_MIN: 270,
  SHORT_NIGHT_DAYS_AGO: 3,
  /** Number of naps sprinkled across the window. */
  NAP_COUNT: 3,
  /** Recovery / HRV / RHR / strain ranges. */
  RECOVERY_MIN: 30,
  RECOVERY_MAX: 95,
  HRV_MIN_MS: 40,
  HRV_MAX_MS: 90,
  RHR_MIN: 48,
  RHR_MAX: 60,
  STRAIN_MIN: 6,
  STRAIN_MAX: 17,
});

/**
 * mulberry32 — a tiny, fast, deterministic 32-bit PRNG.
 *
 * @param {number} seed
 * @returns {() => number} a function returning floats in `[0, 1)`
 */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** @param {number} v @param {number} lo @param {number} hi */
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
/** @param {number} min */
const toMilli = (min) => Math.round(min * 60000);

/**
 * Deterministic UUID-shaped id.
 *
 * @param {() => number} rnd
 * @returns {string}
 */
function uuid(rnd) {
  const hex = (n) =>
    Array.from({ length: n }, () => Math.floor(rnd() * 16).toString(16)).join('');
  return `${hex(8)}-${hex(4)}-4${hex(3)}-a${hex(3)}-${hex(12)}`;
}

/**
 * Day of week for a `YYYY-MM-DD` string (0 = Sunday).
 *
 * @param {string} dateStr
 * @returns {number}
 */
export function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Build a full set of synthetic WHOOP v2 records.
 *
 * Layout, for `endDate` = today:
 * - `days` **scored** nights whose wake dates end at `endDate - 1`;
 * - one extra `PENDING_SCORE` sleep record for the most recent night
 *   (wake date `endDate`) so callers must handle unscored data;
 * - one recovery record per scored night, joined by `sleep_id`;
 * - one cycle per scored night covering the waking day that preceded it,
 *   plus a final open cycle (`end: null`).
 *
 * When `endDate` is **not** today the pending record is omitted and the scored
 * wake dates end at `endDate`.
 *
 * @param {Object} [options]
 * @param {number} [options.days=21] number of scored nights
 * @param {number} [options.seed=42]
 * @param {string|number} [options.tzOffset='+02:00']
 * @param {string} [options.endDate] `YYYY-MM-DD`, defaults to today in `tzOffset`
 * @param {Date} [options.now] override "now" (used to decide whether `endDate` is today)
 * @returns {{ sleep: any[], recovery: any[], cycle: any[] }}
 */
export function makeDemoData(options = {}) {
  const {
    days = 21,
    seed = 42,
    tzOffset = '+02:00',
    now = new Date(),
  } = options;

  const tzOffsetMin = parseTzOffset(tzOffset, 120);
  const tzString = typeof tzOffset === 'string' ? tzOffset : formatOffset(tzOffsetMin);
  const today = localDateString(now, tzOffsetMin);
  const endDate = options.endDate ?? today;
  const endDateIsToday = endDate === today;

  const rnd = mulberry32(seed);
  const C = DEMO_CONSTANTS;

  // Scored wake dates: when endDate is today, the newest night is unscored.
  const lastScored = endDateIsToday ? addDays(endDate, -1) : endDate;
  /** @type {string[]} */
  const dates = [];
  for (let i = days - 1; i >= 0; i -= 1) dates.push(addDays(lastScored, -i));

  const shortNightDate = addDays(endDate, -C.SHORT_NIGHT_DAYS_AGO);
  const napDates = new Set(
    [0.25, 0.55, 0.82]
      .slice(0, C.NAP_COUNT)
      .map((f) => dates[Math.min(dates.length - 1, Math.floor(f * dates.length))])
      .filter(Boolean),
  );

  /** @type {any[]} */
  const sleep = [];
  /** @type {any[]} */
  const recovery = [];
  /** @type {any[]} */
  const cycle = [];
  /** @type {{date: string, start: string, end: string}[]} */
  const nightSpans = [];
  /** @type {Map<string, number>} */
  const napMinutesByDate = new Map();

  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i];
    const prevDate = addDays(date, -1);
    const wakeDow = dayOfWeek(date);
    // Fri/Sat nights run later and Sat/Sun mornings sleep in — both keyed on the wake day.
    const isWeekend = wakeDow === 0 || wakeDow === 6;

    let bedtimeMin = Math.round(
      C.BEDTIME_BASE_MIN +
        (rnd() * 2 - 1) * C.BEDTIME_JITTER_MIN +
        (isWeekend ? C.WEEKEND_BEDTIME_SHIFT_MIN : 0),
    );
    let wakeMin = Math.round(
      C.WAKE_BASE_MIN +
        (rnd() * 2 - 1) * C.WAKE_JITTER_MIN +
        (isWeekend ? C.WEEKEND_WAKE_SHIFT_MIN : 0),
    );

    const isShortNight = date === shortNightDate;
    if (isShortNight) {
      bedtimeMin = 1510; // 01:10, i.e. after midnight on the wake date
      wakeMin = 420; // 07:00
    }

    const startIso = localToIso(prevDate, bedtimeMin, tzOffsetMin);
    const endIso = localToIso(date, wakeMin, tzOffsetMin);
    const inBedMin = minutesBetween(startIso, endIso);

    const efficiency = C.EFFICIENCY_MIN + rnd() * (C.EFFICIENCY_MAX - C.EFFICIENCY_MIN);
    const asleepMin = isShortNight
      ? C.SHORT_NIGHT_ASLEEP_MIN
      : clamp(Math.round(inBedMin * efficiency), C.ASLEEP_MIN_MIN, Math.min(C.ASLEEP_MAX_MIN, inBedMin - 12));

    const noDataMin = Math.round(rnd() * 3);
    const awakeMin = Math.max(0, inBedMin - asleepMin - noDataMin);

    const swsMin = Math.round(asleepMin * (0.19 + rnd() * 0.07));
    const remMin = Math.round(asleepMin * (0.19 + rnd() * 0.07));
    const lightMin = asleepMin - swsMin - remMin;

    // Sleep need: baseline + debt payback + strain, minus credit for yesterday's nap.
    const needBaselineMin = Math.round(C.NEED_BASELINE_MIN + (rnd() * 2 - 1) * 8);
    const needFromDebtMin = Math.round(rnd() * 42);
    const needFromStrainMin = Math.round(rnd() * 24);
    const yesterdayNapMin = napMinutesByDate.get(prevDate) ?? 0;
    const needFromNapMin = -Math.round(yesterdayNapMin * 0.5);
    const needTotalMin = needBaselineMin + needFromDebtMin + needFromStrainMin + needFromNapMin;

    const sleepId = uuid(rnd);
    const createdAt = localToIso(date, wakeMin + 12, tzOffsetMin);

    sleep.push({
      id: sleepId,
      user_id: DEMO_USER_ID,
      created_at: createdAt,
      updated_at: createdAt,
      start: startIso,
      end: endIso,
      timezone_offset: tzString,
      nap: false,
      score_state: 'SCORED',
      score: {
        stage_summary: {
          total_in_bed_time_milli: toMilli(inBedMin),
          total_awake_time_milli: toMilli(awakeMin),
          total_no_data_time_milli: toMilli(noDataMin),
          total_light_sleep_time_milli: toMilli(lightMin),
          total_slow_wave_sleep_time_milli: toMilli(swsMin),
          total_rem_sleep_time_milli: toMilli(remMin),
          sleep_cycle_count: 3 + Math.floor(rnd() * 4),
          disturbance_count: 4 + Math.floor(rnd() * 14),
        },
        sleep_needed: {
          baseline_milli: toMilli(needBaselineMin),
          need_from_sleep_debt_milli: toMilli(needFromDebtMin),
          need_from_recent_strain_milli: toMilli(needFromStrainMin),
          need_from_recent_nap_milli: toMilli(needFromNapMin),
        },
        respiratory_rate: round1(13.6 + rnd() * 2.8),
        sleep_performance_percentage: clamp(Math.round((asleepMin / needTotalMin) * 100), 20, 100),
        sleep_consistency_percentage: 58 + Math.floor(rnd() * 38),
        sleep_efficiency_percentage: round1((asleepMin / inBedMin) * 100),
      },
    });
    nightSpans.push({ date, start: startIso, end: endIso });

    // --- nap on this wake date ------------------------------------------------
    if (napDates.has(date)) {
      const napStartMin = 810 + Math.round(rnd() * 90); // 13:30–15:00
      const napAsleepMin = 22 + Math.round(rnd() * 24); // 22–46 min
      const napInBedMin = napAsleepMin + 4 + Math.round(rnd() * 6);
      const napSws = Math.round(napAsleepMin * 0.25);
      const napRem = Math.round(napAsleepMin * 0.12);
      const napLight = napAsleepMin - napSws - napRem;
      const napStart = localToIso(date, napStartMin, tzOffsetMin);
      const napEnd = localToIso(date, napStartMin + napInBedMin, tzOffsetMin);
      napMinutesByDate.set(date, napAsleepMin);
      sleep.push({
        id: uuid(rnd),
        user_id: DEMO_USER_ID,
        created_at: napEnd,
        updated_at: napEnd,
        start: napStart,
        end: napEnd,
        timezone_offset: tzString,
        nap: true,
        score_state: 'SCORED',
        score: {
          stage_summary: {
            total_in_bed_time_milli: toMilli(napInBedMin),
            total_awake_time_milli: toMilli(napInBedMin - napAsleepMin),
            total_no_data_time_milli: 0,
            total_light_sleep_time_milli: toMilli(napLight),
            total_slow_wave_sleep_time_milli: toMilli(napSws),
            total_rem_sleep_time_milli: toMilli(napRem),
            sleep_cycle_count: 1,
            disturbance_count: Math.floor(rnd() * 3),
          },
          sleep_needed: {
            baseline_milli: toMilli(needBaselineMin),
            need_from_sleep_debt_milli: 0,
            need_from_recent_strain_milli: 0,
            need_from_recent_nap_milli: 0,
          },
          respiratory_rate: round1(13.8 + rnd() * 2.2),
          sleep_performance_percentage: null,
          sleep_consistency_percentage: null,
          sleep_efficiency_percentage: round1((napAsleepMin / napInBedMin) * 100),
        },
      });
    }

    // --- recovery, correlated with how much sleep was banked ------------------
    const q = clamp((asleepMin - 360) / 110, 0, 1);
    const recoveryScore = Math.round(
      clamp(32 + 58 * q + (rnd() * 2 - 1) * 7, C.RECOVERY_MIN, C.RECOVERY_MAX),
    );
    const hrv = round1(clamp(42 + 42 * q + (rnd() * 2 - 1) * 6, C.HRV_MIN_MS, C.HRV_MAX_MS));
    const rhr = Math.round(clamp(58 - 8 * q + (rnd() * 2 - 1) * 2, C.RHR_MIN, C.RHR_MAX));

    recovery.push({
      cycle_id: 900_000 + i,
      sleep_id: sleepId,
      user_id: DEMO_USER_ID,
      created_at: createdAt,
      updated_at: createdAt,
      score_state: 'SCORED',
      score: {
        user_calibrating: false,
        recovery_score: recoveryScore,
        resting_heart_rate: rhr,
        hrv_rmssd_milli: hrv,
        spo2_percentage: round1(95 + rnd() * 3.5),
        skin_temp_celsius: round1(33.2 + rnd() * 1.6),
      },
    });
  }

  // --- cycles: one per night's preceding waking day, plus today's open cycle --
  for (let i = 0; i < nightSpans.length; i += 1) {
    const night = nightSpans[i];
    const cycleStart = i === 0 ? shiftIso(night.start, -16 * 60) : nightSpans[i - 1].end;
    const strain = round1(
      clamp(
        C.STRAIN_MIN + rnd() * (C.STRAIN_MAX - C.STRAIN_MIN),
        C.STRAIN_MIN,
        C.STRAIN_MAX,
      ),
    );
    cycle.push({
      id: 800_000 + i,
      user_id: DEMO_USER_ID,
      created_at: cycleStart,
      updated_at: night.end,
      start: cycleStart,
      end: night.end,
      timezone_offset: tzString,
      score_state: 'SCORED',
      score: {
        strain,
        kilojoule: Math.round(4200 + strain * 620 + rnd() * 400),
        average_heart_rate: 58 + Math.floor(rnd() * 22),
        max_heart_rate: 148 + Math.floor(rnd() * 38),
      },
    });
  }
  if (nightSpans.length > 0) {
    const openStart = nightSpans[nightSpans.length - 1].end;
    const openStrain = round1(clamp(C.STRAIN_MIN + rnd() * 6, C.STRAIN_MIN, C.STRAIN_MAX));
    cycle.push({
      id: 800_000 + nightSpans.length,
      user_id: DEMO_USER_ID,
      created_at: openStart,
      updated_at: openStart,
      start: openStart,
      end: null,
      timezone_offset: tzString,
      score_state: 'SCORED',
      score: {
        strain: openStrain,
        kilojoule: Math.round(2100 + openStrain * 480),
        average_heart_rate: 56 + Math.floor(rnd() * 18),
        max_heart_rate: 128 + Math.floor(rnd() * 40),
      },
    });
  }

  // --- the most recent night, not yet scored ---------------------------------
  if (endDateIsToday) {
    const prevDate = addDays(endDate, -1);
    const bedtimeMin = Math.round(C.BEDTIME_BASE_MIN + (rnd() * 2 - 1) * C.BEDTIME_JITTER_MIN);
    const wakeMin = Math.round(C.WAKE_BASE_MIN + (rnd() * 2 - 1) * C.WAKE_JITTER_MIN);
    const startIso = localToIso(prevDate, bedtimeMin, tzOffsetMin);
    const endIso = localToIso(endDate, wakeMin, tzOffsetMin);
    sleep.push({
      id: uuid(rnd),
      user_id: DEMO_USER_ID,
      created_at: endIso,
      updated_at: endIso,
      start: startIso,
      end: endIso,
      timezone_offset: tzString,
      nap: false,
      score_state: 'PENDING_SCORE',
    });
  }

  sleep.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
  return { sleep, recovery, cycle };
}

/** @param {number} n */
function round1(n) {
  return Math.round(n * 10) / 10;
}

/** @param {string} iso @param {number} minutes */
function shiftIso(iso, minutes) {
  return new Date(Date.parse(iso) + minutes * 60000).toISOString();
}

/** @param {number} tzOffsetMin */
function formatOffset(tzOffsetMin) {
  const sign = tzOffsetMin < 0 ? '-' : '+';
  const abs = Math.abs(tzOffsetMin);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

export default makeDemoData;
