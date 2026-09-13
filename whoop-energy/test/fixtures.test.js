import test from 'node:test';
import assert from 'node:assert/strict';

import { makeDemoData, mulberry32, dayOfWeek, DEMO_CONSTANTS, DEMO_USER_ID } from '../src/demo/fixtures.js';
import { parseTzOffset, localDateString, minutesBetween, addDays } from '../src/time.js';

/** A fixed "now" so `endDate` defaults deterministically. */
const NOW = new Date('2026-09-13T10:00:00Z');
const TZ = '+02:00';
const TZ_MIN = parseTzOffset(TZ);

/** @param {object} [opts] */
const demo = (opts = {}) => makeDemoData({ now: NOW, tzOffset: TZ, ...opts });

test('mulberry32 is deterministic and stays in [0,1)', () => {
  const a = mulberry32(42);
  const b = mulberry32(42);
  const c = mulberry32(43);
  const seqA = Array.from({ length: 5 }, a);
  const seqB = Array.from({ length: 5 }, b);
  assert.deepEqual(seqA, seqB);
  assert.notDeepEqual(seqA, Array.from({ length: 5 }, c));
  for (const v of seqA) assert.ok(v >= 0 && v < 1, `${v} out of range`);
});

test('dayOfWeek matches the calendar', () => {
  assert.equal(dayOfWeek('2026-09-13'), 0, '2026-09-13 is a Sunday');
  assert.equal(dayOfWeek('2026-09-14'), 1);
  assert.equal(dayOfWeek('2026-09-12'), 6);
});

test('makeDemoData is byte-identical for the same seed and differs for another', () => {
  assert.equal(JSON.stringify(demo()), JSON.stringify(demo()));
  assert.notEqual(JSON.stringify(demo()), JSON.stringify(demo({ seed: 7 })));
});

test('produces the requested number of scored nights plus naps and one pending record', () => {
  const { sleep, recovery, cycle } = demo({ days: 21 });

  const scoredMain = sleep.filter((s) => !s.nap && s.score_state === 'SCORED');
  const naps = sleep.filter((s) => s.nap);
  const pending = sleep.filter((s) => s.score_state === 'PENDING_SCORE');

  assert.equal(scoredMain.length, 21);
  assert.equal(naps.length, DEMO_CONSTANTS.NAP_COUNT);
  assert.equal(pending.length, 1, 'the most recent night is not scored yet');
  assert.equal(pending[0].nap, false);
  assert.equal(pending[0].score, undefined, 'pending records carry no score object');
  assert.equal(localDateString(pending[0].end, TZ_MIN), '2026-09-13', 'pending night wakes today');

  assert.equal(recovery.length, 21, 'one recovery per scored night');
  assert.equal(cycle.length, 22, 'one cycle per night plus the open cycle');
});

test('omits the pending record when endDate is not today', () => {
  const { sleep } = demo({ days: 10, endDate: '2026-08-01' });
  assert.equal(sleep.filter((s) => s.score_state === 'PENDING_SCORE').length, 0);
  const mains = sleep.filter((s) => !s.nap);
  assert.equal(mains.length, 10);
  assert.equal(localDateString(mains.at(-1).end, TZ_MIN), '2026-08-01');
});

test('sleep records match the WHOOP v2 shape', () => {
  const { sleep } = demo();
  const night = sleep.find((s) => !s.nap && s.score_state === 'SCORED');

  for (const key of ['id', 'user_id', 'created_at', 'updated_at', 'start', 'end', 'timezone_offset', 'nap', 'score_state', 'score']) {
    assert.ok(key in night, `missing ${key}`);
  }
  assert.match(night.id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.equal(night.user_id, DEMO_USER_ID);
  assert.equal(night.timezone_offset, TZ);

  const stages = night.score.stage_summary;
  for (const key of [
    'total_in_bed_time_milli',
    'total_awake_time_milli',
    'total_no_data_time_milli',
    'total_light_sleep_time_milli',
    'total_slow_wave_sleep_time_milli',
    'total_rem_sleep_time_milli',
    'sleep_cycle_count',
    'disturbance_count',
  ]) {
    assert.ok(key in stages, `missing stage_summary.${key}`);
    assert.equal(typeof stages[key], 'number');
  }
  const needed = night.score.sleep_needed;
  for (const key of ['baseline_milli', 'need_from_sleep_debt_milli', 'need_from_recent_strain_milli', 'need_from_recent_nap_milli']) {
    assert.ok(key in needed, `missing sleep_needed.${key}`);
  }
  for (const key of ['respiratory_rate', 'sleep_performance_percentage', 'sleep_consistency_percentage', 'sleep_efficiency_percentage']) {
    assert.ok(key in night.score, `missing score.${key}`);
  }
});

test('recovery and cycle records match the WHOOP v2 shape', () => {
  const { recovery, cycle, sleep } = demo();
  const r = recovery[0];
  for (const key of ['cycle_id', 'sleep_id', 'user_id', 'created_at', 'updated_at', 'score_state', 'score']) {
    assert.ok(key in r, `missing ${key}`);
  }
  for (const key of ['user_calibrating', 'recovery_score', 'resting_heart_rate', 'hrv_rmssd_milli', 'spo2_percentage', 'skin_temp_celsius']) {
    assert.ok(key in r.score, `missing recovery score.${key}`);
  }
  const sleepIds = new Set(sleep.map((s) => s.id));
  for (const rec of recovery) assert.ok(sleepIds.has(rec.sleep_id), 'every recovery joins to a sleep record');

  const c = cycle[0];
  for (const key of ['id', 'user_id', 'created_at', 'updated_at', 'start', 'end', 'timezone_offset', 'score_state', 'score']) {
    assert.ok(key in c, `missing ${key}`);
  }
  for (const key of ['strain', 'kilojoule', 'average_heart_rate', 'max_heart_rate']) {
    assert.ok(key in c.score, `missing cycle score.${key}`);
  }
  assert.equal(cycle.at(-1).end, null, 'the last cycle is still open');
  assert.equal(cycle.filter((x) => x.end === null).length, 1);
});

test('timings are realistic: bedtime ~23:30±40, wake ~07:15±25, 6.2–7.8h asleep', () => {
  const { sleep } = demo({ days: 21 });
  const shortNightDate = addDays('2026-09-13', -DEMO_CONSTANTS.SHORT_NIGHT_DAYS_AGO);
  const mains = sleep.filter((s) => !s.nap && s.score_state === 'SCORED');

  for (const s of mains) {
    const date = localDateString(s.end, TZ_MIN);
    if (date === shortNightDate) continue;

    const stages = s.score.stage_summary;
    const asleepMin =
      (stages.total_light_sleep_time_milli + stages.total_slow_wave_sleep_time_milli + stages.total_rem_sleep_time_milli) /
      60000;
    assert.ok(
      asleepMin >= DEMO_CONSTANTS.ASLEEP_MIN_MIN && asleepMin <= DEMO_CONSTANTS.ASLEEP_MAX_MIN,
      `${date}: ${asleepMin} min asleep out of range`,
    );

    const inBedMin = stages.total_in_bed_time_milli / 60000;
    assert.equal(inBedMin, minutesBetween(s.start, s.end), `${date}: in-bed must equal start→end`);
    assert.ok(asleepMin < inBedMin, `${date}: cannot sleep longer than time in bed`);

    // Bedtime and wake stay inside the configured jitter (plus the weekend shift).
    const bedLocalMin = localMinutes(s.start);
    const wakeLocalMin = localMinutes(s.end);
    const bedOffset = bedLocalMin > 720 ? bedLocalMin - DEMO_CONSTANTS.BEDTIME_BASE_MIN : bedLocalMin + 1440 - DEMO_CONSTANTS.BEDTIME_BASE_MIN;
    assert.ok(
      Math.abs(bedOffset) <= DEMO_CONSTANTS.BEDTIME_JITTER_MIN + DEMO_CONSTANTS.WEEKEND_BEDTIME_SHIFT_MIN + 1,
      `${date}: bedtime ${bedLocalMin} too far from base`,
    );
    assert.ok(
      Math.abs(wakeLocalMin - DEMO_CONSTANTS.WAKE_BASE_MIN) <=
        DEMO_CONSTANTS.WAKE_JITTER_MIN + DEMO_CONSTANTS.WEEKEND_WAKE_SHIFT_MIN + 1,
      `${date}: wake ${wakeLocalMin} too far from base`,
    );
  }
});

test('the deliberately short night sits three days before endDate and starts after midnight', () => {
  const { sleep } = demo({ days: 21 });
  const shortDate = addDays('2026-09-13', -DEMO_CONSTANTS.SHORT_NIGHT_DAYS_AGO);
  const short = sleep.find((s) => !s.nap && s.score_state === 'SCORED' && localDateString(s.end, TZ_MIN) === shortDate);

  assert.ok(short, 'short night exists');
  const stages = short.score.stage_summary;
  const asleepMin =
    (stages.total_light_sleep_time_milli + stages.total_slow_wave_sleep_time_milli + stages.total_rem_sleep_time_milli) /
    60000;
  assert.equal(asleepMin, DEMO_CONSTANTS.SHORT_NIGHT_ASLEEP_MIN, '4.5 hours');
  assert.equal(localDateString(short.start, TZ_MIN), shortDate, 'sleep onset already on the wake date');
  assert.equal(localMinutes(short.start), 70, '01:10 local');
});

test('need baseline is around 7h50m and the four need parts are present', () => {
  const { sleep } = demo({ days: 21 });
  const mains = sleep.filter((s) => !s.nap && s.score_state === 'SCORED');
  for (const s of mains) {
    const baselineMin = s.score.sleep_needed.baseline_milli / 60000;
    assert.ok(Math.abs(baselineMin - DEMO_CONSTANTS.NEED_BASELINE_MIN) <= 9, `${baselineMin} min baseline`);
  }
  const withNapCredit = mains.filter((s) => s.score.sleep_needed.need_from_recent_nap_milli < 0);
  assert.ok(withNapCredit.length > 0, 'the day after a nap needs less sleep');
});

test('recovery, HRV, RHR and strain stay in their documented ranges and correlate with sleep', () => {
  const { sleep, recovery, cycle } = demo({ days: 21 });
  const C = DEMO_CONSTANTS;

  for (const r of recovery) {
    assert.ok(r.score.recovery_score >= C.RECOVERY_MIN && r.score.recovery_score <= C.RECOVERY_MAX);
    assert.ok(r.score.hrv_rmssd_milli >= C.HRV_MIN_MS && r.score.hrv_rmssd_milli <= C.HRV_MAX_MS);
    assert.ok(r.score.resting_heart_rate >= C.RHR_MIN && r.score.resting_heart_rate <= C.RHR_MAX);
  }
  for (const c of cycle) {
    assert.ok(c.score.strain >= C.STRAIN_MIN && c.score.strain <= C.STRAIN_MAX, `strain ${c.score.strain}`);
  }

  // Sleep duration and recovery should be positively correlated by construction.
  const bySleepId = new Map(sleep.map((s) => [s.id, s]));
  const pairs = recovery
    .map((r) => {
      const s = bySleepId.get(r.sleep_id);
      const st = s.score.stage_summary;
      return [
        (st.total_light_sleep_time_milli + st.total_slow_wave_sleep_time_milli + st.total_rem_sleep_time_milli) / 60000,
        r.score.recovery_score,
      ];
    })
    .filter(Boolean);
  assert.ok(pearson(pairs) > 0.5, 'recovery tracks sleep duration');
});

test('cycles cover the night that follows them, and the open cycle does not', () => {
  const { sleep, cycle } = demo({ days: 21 });
  const mains = sleep.filter((s) => !s.nap && s.score_state === 'SCORED');
  for (const s of mains) {
    const start = Date.parse(s.start);
    const containing = cycle.filter((c) => Date.parse(c.start) <= start && (c.end === null || start <= Date.parse(c.end)));
    assert.equal(containing.length, 1, `exactly one cycle contains ${s.start}`);
    assert.notEqual(containing[0].end, null, 'a scored night never falls inside the open cycle');
  }
});

test('honours days, seed, tzOffset and endDate options', () => {
  const { sleep } = makeDemoData({ now: NOW, days: 5, tzOffset: '-05:00', endDate: '2026-05-04' });
  const mains = sleep.filter((s) => !s.nap);
  assert.equal(mains.length, 5);
  assert.equal(mains[0].timezone_offset, '-05:00');
  const dates = mains.map((s) => localDateString(s.end, -300));
  assert.deepEqual(dates, ['2026-04-30', '2026-05-01', '2026-05-02', '2026-05-03', '2026-05-04']);
});

/** @param {string} iso */
function localMinutes(iso) {
  const d = new Date(Date.parse(iso) + TZ_MIN * 60000);
  return d.getUTCHours() * 60 + d.getUTCMinutes();
}

/** @param {number[][]} pairs */
function pearson(pairs) {
  const n = pairs.length;
  const mx = pairs.reduce((s, p) => s + p[0], 0) / n;
  const my = pairs.reduce((s, p) => s + p[1], 0) / n;
  let num = 0;
  let dx = 0;
  let dy = 0;
  for (const [x, y] of pairs) {
    num += (x - mx) * (y - my);
    dx += (x - mx) ** 2;
    dy += (y - my) ** 2;
  }
  return num / Math.sqrt(dx * dy);
}
