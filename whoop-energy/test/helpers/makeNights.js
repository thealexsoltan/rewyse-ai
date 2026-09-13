/**
 * @file Seeded generator for canonical `SleepNight[]` fixtures.
 *
 * Model tests must not depend on `src/demo/fixtures.js` (owned by another
 * module) so this builds the exact shape documented in `src/model/types.js`
 * from plain options. Every option accepts either a constant or a
 * `(i, rnd) => number` function, where `i` is the night index (0 = oldest).
 */

import { addDays, localToIso } from '../../src/time.js';

/** Deterministic 32-bit PRNG (mulberry32). @param {number} seed @returns {() => number} */
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

/** @param {number} m @returns {number} */
function mod1440(m) {
  return ((Math.round(m) % 1440) + 1440) % 1440;
}

/**
 * @param {number|((i: number, rnd: () => number) => number)|null|undefined} value
 * @param {number} i
 * @param {() => number} rnd
 * @returns {any}
 */
function resolve(value, i, rnd) {
  return typeof value === 'function' ? value(i, rnd) : value;
}

/**
 * Build `days` consecutive `SleepNight` objects ending on `endDate`.
 *
 * @param {number} days
 * @param {Object} [opts]
 * @param {string} [opts.endDate] local wake date of the LAST night (`YYYY-MM-DD`)
 * @param {number} [opts.seed]
 * @param {number} [opts.tzOffsetMin]
 * @param {number|Function} [opts.wakeMin] local minutes-of-day of wake
 * @param {number|Function} [opts.bedtimeMin] fixed bedtime; omit to derive it from `asleepMin`/`efficiencyPct`
 * @param {number|Function} [opts.asleepMin]
 * @param {number|Function} [opts.needMin] WHOOP `needBaselineMin`
 * @param {number|Function} [opts.efficiencyPct]
 * @param {number|Function} [opts.performancePct]
 * @param {number|Function} [opts.consistencyPct]
 * @param {number|Function} [opts.disturbances]
 * @param {number|Function} [opts.respiratoryRate]
 * @param {number|Function|null} [opts.recoveryScore] null → no recovery record
 * @param {number|Function} [opts.hrvMs]
 * @param {number|Function} [opts.rhr]
 * @param {boolean|Function} [opts.calibrating]
 * @param {number|Function|null} [opts.strain]
 * @param {number|Function} [opts.napMin] a single afternoon nap of this length
 * @param {number} [opts.jitterMin] symmetric jitter applied to bed/wake times
 * @param {(i: number, rnd: () => number) => Object} [opts.override] per-night partial, applied before derivation
 * @returns {import('../../src/model/types.js').SleepNight[]} oldest first
 */
export function makeNights(days, opts = {}) {
  const {
    endDate = '2026-01-15',
    seed = 42,
    tzOffsetMin = 120,
    wakeMin = 7 * 60,
    bedtimeMin,
    asleepMin = 480,
    needMin = 480,
    efficiencyPct = 92,
    performancePct = 95,
    consistencyPct = 85,
    disturbances = 6,
    respiratoryRate = 14.5,
    recoveryScore = 65,
    hrvMs = 60,
    rhr = 54,
    calibrating = false,
    strain = 12,
    napMin = 0,
    jitterMin = 0,
    override = null,
  } = opts;

  const rnd = mulberry32(seed);
  const explicitBedtime = bedtimeMin !== undefined && bedtimeMin !== null;
  /** @type {import('../../src/model/types.js').SleepNight[]} */
  const nights = [];

  for (let i = 0; i < days; i += 1) {
    const date = addDays(endDate, -(days - 1 - i));
    const jitter = () => (jitterMin ? Math.round((rnd() * 2 - 1) * jitterMin) : 0);

    const base = {
      wakeMin: Math.round(resolve(wakeMin, i, rnd)) + jitter(),
      bedtimeMin: explicitBedtime ? Math.round(resolve(bedtimeMin, i, rnd)) + jitter() : null,
      asleepMin: Math.round(resolve(asleepMin, i, rnd)),
      needBaselineMin: Math.round(resolve(needMin, i, rnd)),
      efficiencyPct: Number(resolve(efficiencyPct, i, rnd)),
      performancePct: Number(resolve(performancePct, i, rnd)),
      consistencyPct: Number(resolve(consistencyPct, i, rnd)),
      disturbances: Math.round(resolve(disturbances, i, rnd)),
      respiratoryRate: Number(resolve(respiratoryRate, i, rnd)),
      recoveryScore: resolve(recoveryScore, i, rnd),
      hrvMs: resolve(hrvMs, i, rnd),
      rhr: resolve(rhr, i, rnd),
      calibrating: Boolean(resolve(calibrating, i, rnd)),
      strain: resolve(strain, i, rnd),
      napMin: Math.round(resolve(napMin, i, rnd)),
      ...(override ? override(i, rnd) : {}),
    };

    const wake = mod1440(base.wakeMin);
    let asleep = Math.max(0, Math.round(base.asleepMin));
    let inBed;
    let bed;

    if (base.bedtimeMin === null || base.bedtimeMin === undefined) {
      inBed = Math.round((asleep * 100) / Math.max(1, base.efficiencyPct));
      bed = mod1440(wake - inBed);
    } else {
      bed = mod1440(base.bedtimeMin);
      inBed = mod1440(wake - bed) || 1440;
      if (asleep > inBed) asleep = inBed;
    }
    const efficiency = inBed > 0 ? Math.round((asleep / inBed) * 1000) / 10 : 0;
    const awake = Math.max(0, inBed - asleep);
    const light = Math.round(asleep * 0.55);
    const rem = Math.round(asleep * 0.23);
    const sws = Math.max(0, asleep - light - rem);
    const bedtimeAfterMidnight = bed < wake;

    const naps = [];
    if (base.napMin > 0) {
      naps.push({
        start: localToIso(date, 14 * 60, tzOffsetMin),
        end: localToIso(date, 14 * 60 + base.napMin, tzOffsetMin),
        asleepMin: base.napMin,
      });
    }

    nights.push({
      date,
      start: localToIso(date, bedtimeAfterMidnight ? bed : bed - 1440, tzOffsetMin),
      end: localToIso(date, wake, tzOffsetMin),
      tzOffsetMin,
      bedtimeMin: bed,
      bedtimeAfterMidnight,
      wakeMin: wake,
      inBedMin: inBed,
      asleepMin: asleep,
      awakeMin: awake,
      lightMin: light,
      swsMin: sws,
      remMin: rem,
      efficiencyPct: efficiency,
      performancePct: base.performancePct,
      consistencyPct: base.consistencyPct,
      respiratoryRate: base.respiratoryRate,
      disturbances: base.disturbances,
      needBaselineMin: base.needBaselineMin,
      needFromDebtMin: 0,
      needFromStrainMin: 0,
      needFromNapMin: 0,
      needTotalMin: base.needBaselineMin,
      naps,
      napMin: naps.reduce((s, n) => s + n.asleepMin, 0),
      recovery:
        base.recoveryScore == null
          ? null
          : {
              score: Number(base.recoveryScore),
              hrvMs: base.hrvMs == null ? null : Number(base.hrvMs),
              rhr: base.rhr == null ? null : Number(base.rhr),
              spo2: 96.5,
              skinTempC: 33.5,
              calibrating: base.calibrating,
            },
      strain: base.strain == null ? null : Number(base.strain),
      sleepId: `sleep-${date}`,
      sleepCycleCount: Math.max(1, Math.round(asleep / 95)),
    });
  }

  return nights;
}

export default makeNights;
