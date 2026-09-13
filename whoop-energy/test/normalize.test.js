import test from 'node:test';
import assert from 'node:assert/strict';

import {
  normalizeNights,
  normalizeSleepRecord,
  indexRecoveryBySleepId,
  findCycleForInstant,
  toNightRecovery,
  isScored,
  milliToMin,
} from '../src/model/normalize.js';
import { makeDemoData, DEMO_CONSTANTS } from '../src/demo/fixtures.js';
import { parseTzOffset, localDateString, addDays } from '../src/time.js';

const NOW = new Date('2026-09-13T10:00:00Z');
const TZ = '+02:00';
const TZ_MIN = parseTzOffset(TZ);

const raw = makeDemoData({ now: NOW, tzOffset: TZ, days: 21 });
const nights = normalizeNights(raw);

test('milliToMin rounds to whole minutes', () => {
  assert.equal(milliToMin(3_600_000), 60);
  assert.equal(milliToMin(89_000), 1);
  assert.equal(milliToMin(91_000), 2);
  assert.equal(milliToMin(null), 0);
  assert.equal(milliToMin(undefined), 0);
});

test('isScored rejects pending, unscorable and score-less records', () => {
  assert.equal(isScored({ score_state: 'SCORED', score: {} }), true);
  assert.equal(isScored({ score: {} }), true, 'a score object with no state is usable');
  assert.equal(isScored({ score_state: 'PENDING_SCORE' }), false);
  assert.equal(isScored({ score_state: 'UNSCORABLE', score: {} }), false);
  assert.equal(isScored({ score_state: 'SCORED' }), false);
  assert.equal(isScored(null), false);
});

test('normalizeNights returns one entry per scored night, sorted by date ascending', () => {
  assert.equal(nights.length, 21);
  const dates = nights.map((n) => n.date);
  assert.deepEqual([...dates].sort(), dates, 'dates are ascending');
  assert.equal(new Set(dates).size, dates.length, 'no duplicate dates');
  assert.equal(dates.at(-1), '2026-09-12');
  assert.equal(dates[0], addDays('2026-09-12', -20));
});

test('unscored records are skipped', () => {
  const pending = raw.sleep.filter((s) => s.score_state === 'PENDING_SCORE');
  assert.equal(pending.length, 1, 'the fixture provides a pending record to skip');
  const pendingDate = localDateString(pending[0].end, TZ_MIN);
  assert.equal(pendingDate, '2026-09-13');
  assert.ok(!nights.some((n) => n.date === pendingDate), 'the pending night never becomes a SleepNight');
});

test('every night carries the full SleepNight contract', () => {
  for (const n of nights) {
    for (const key of [
      'date', 'start', 'end', 'tzOffsetMin', 'bedtimeMin', 'bedtimeAfterMidnight', 'wakeMin',
      'inBedMin', 'asleepMin', 'awakeMin', 'lightMin', 'swsMin', 'remMin',
      'efficiencyPct', 'performancePct', 'consistencyPct', 'respiratoryRate', 'disturbances',
      'needBaselineMin', 'needFromDebtMin', 'needFromStrainMin', 'needFromNapMin', 'needTotalMin',
      'naps', 'napMin', 'recovery', 'strain', 'sleepId', 'sleepCycleCount',
    ]) {
      assert.ok(key in n, `${n.date} missing ${key}`);
    }
    assert.equal(n.tzOffsetMin, TZ_MIN);
    assert.ok(n.bedtimeMin >= 0 && n.bedtimeMin < 1440, `bedtimeMin ${n.bedtimeMin} not normalised`);
    assert.ok(n.wakeMin >= 0 && n.wakeMin < 1440);
    assert.equal(n.asleepMin, n.lightMin + n.swsMin + n.remMin, 'asleepMin = light + sws + rem');
    assert.equal(
      n.needTotalMin,
      n.needBaselineMin + n.needFromDebtMin + n.needFromStrainMin + n.needFromNapMin,
      'needTotalMin is the sum of the four parts',
    );
    assert.equal(n.date, localDateString(n.end, TZ_MIN), 'date is the local WAKE date');
  }
});

test('naps attach to the night whose local wake date matches the nap date', () => {
  const napRecords = raw.sleep.filter((s) => s.nap);
  assert.equal(napRecords.length, DEMO_CONSTANTS.NAP_COUNT);

  const nightsWithNaps = nights.filter((n) => n.naps.length > 0);
  assert.equal(nightsWithNaps.length, DEMO_CONSTANTS.NAP_COUNT);

  for (const napRecord of napRecords) {
    const napDate = localDateString(napRecord.start, TZ_MIN);
    const host = nights.find((n) => n.date === napDate);
    assert.ok(host, `a night exists for nap date ${napDate}`);
    assert.ok(host.naps.some((n) => n.start === napRecord.start), 'the nap is attached to that night');
  }
  for (const n of nights) {
    assert.equal(n.napMin, n.naps.reduce((s, x) => s + x.asleepMin, 0), 'napMin is the sum of the naps');
    if (n.naps.length === 0) assert.equal(n.napMin, 0);
  }
  const napped = nightsWithNaps[0];
  assert.ok(napped.napMin > 0 && napped.napMin < 60, `nap of ${napped.napMin} min looks like a nap`);
});

test('recovery joins on sleep_id', () => {
  const bySleepId = new Map(raw.recovery.map((r) => [r.sleep_id, r]));
  for (const n of nights) {
    assert.ok(n.recovery, `${n.date} has recovery`);
    const source = bySleepId.get(n.sleepId);
    assert.ok(source, 'the join key is the sleep record id');
    assert.equal(n.recovery.score, source.score.recovery_score);
    assert.equal(n.recovery.hrvMs, source.score.hrv_rmssd_milli);
    assert.equal(n.recovery.rhr, source.score.resting_heart_rate);
    assert.equal(n.recovery.calibrating, false);
  }
});

test('an unmatched recovery leaves recovery null', () => {
  const detached = {
    sleep: raw.sleep,
    recovery: raw.recovery.map((r) => ({ ...r, sleep_id: `x-${r.sleep_id}` })),
    cycle: raw.cycle,
  };
  const out = normalizeNights(detached);
  assert.ok(out.every((n) => n.recovery === null));
});

test('strain comes from the cycle containing the sleep start', () => {
  for (const n of nights) {
    assert.equal(typeof n.strain, 'number', `${n.date} has strain`);
    const start = Date.parse(n.start);
    const containing = raw.cycle.find(
      (c) => Date.parse(c.start) <= start && (c.end === null || start <= Date.parse(c.end)),
    );
    assert.ok(containing, 'a containing cycle exists');
    assert.equal(n.strain, containing.score.strain);
    assert.ok(Date.parse(containing.start) < start, 'the cycle began on the preceding waking day');
  }
});

test('findCycleForInstant handles the open cycle and picks the latest match', () => {
  const cycles = [
    { start: '2026-09-10T05:00:00Z', end: '2026-09-11T05:00:00Z', score: { strain: 1 }, score_state: 'SCORED' },
    { start: '2026-09-11T05:00:00Z', end: null, score: { strain: 2 }, score_state: 'SCORED' },
  ];
  assert.equal(findCycleForInstant(cycles, '2026-09-10T21:00:00Z').score.strain, 1);
  assert.equal(findCycleForInstant(cycles, '2026-09-30T21:00:00Z').score.strain, 2, 'open cycle runs forever');
  assert.equal(findCycleForInstant(cycles, '2026-09-01T00:00:00Z'), null, 'before every cycle');
  assert.equal(findCycleForInstant([], '2026-09-10T21:00:00Z'), null);
  assert.equal(findCycleForInstant(cycles, 'not-a-date'), null);
});

test('an unscored cycle yields a null strain', () => {
  const out = normalizeNights({
    sleep: raw.sleep,
    recovery: raw.recovery,
    cycle: raw.cycle.map((c) => ({ ...c, score_state: 'PENDING_SCORE', score: undefined })),
  });
  assert.ok(out.every((n) => n.strain === null));
});

test('bedtime after midnight is normalised and flagged', () => {
  const shortDate = addDays('2026-09-13', -DEMO_CONSTANTS.SHORT_NIGHT_DAYS_AGO);
  const short = nights.find((n) => n.date === shortDate);
  assert.ok(short, 'the deliberately short night is present');
  assert.equal(short.asleepMin, DEMO_CONSTANTS.SHORT_NIGHT_ASLEEP_MIN);
  assert.equal(short.bedtimeMin, 70, '01:10 local, already wrapped into [0,1440)');
  assert.equal(short.bedtimeAfterMidnight, true);
  assert.ok(short.bedtimeMin < short.wakeMin, 'both fall on the wake date');
  assert.equal(short.inBedMin, 350);

  const normal = nights.find((n) => !n.bedtimeAfterMidnight);
  assert.ok(normal, 'ordinary nights start before midnight');
  assert.ok(normal.bedtimeMin > 720, `bedtime ${normal.bedtimeMin} is in the evening`);
  assert.equal(localDateString(normal.start, TZ_MIN), addDays(normal.date, -1));
});

test('normalizeSleepRecord can be forced onto a different timezone offset', () => {
  const record = raw.sleep.find((s) => !s.nap && s.score_state === 'SCORED');
  const asUtc = normalizeSleepRecord(record, { tzOffsetMin: 0 });
  const asLocal = normalizeSleepRecord(record);
  assert.equal(asLocal.tzOffsetMin, TZ_MIN);
  assert.equal(asUtc.tzOffsetMin, 0);
  assert.equal((asUtc.wakeMin + 120) % 1440, asLocal.wakeMin);
  assert.equal(asUtc.asleepMin, asLocal.asleepMin, 'durations do not depend on the offset');
});

test('normalizeNights accepts a global timezone override', () => {
  const out = normalizeNights(raw, { tzOffsetMin: 0 });
  assert.ok(out.every((n) => n.tzOffsetMin === 0));
  assert.equal(out.length, nights.length);
});

test('two main sleeps ending on the same date keep the longer one and fold the other in as a nap', () => {
  const base = raw.sleep.filter((s) => !s.nap && s.score_state === 'SCORED').slice(0, 1);
  const extra = {
    ...base[0],
    id: 'duplicate-short-sleep',
    start: '2026-08-23T01:00:00Z',
    end: '2026-08-23T02:00:00Z',
    score: {
      ...base[0].score,
      stage_summary: {
        ...base[0].score.stage_summary,
        total_light_sleep_time_milli: 30 * 60000,
        total_slow_wave_sleep_time_milli: 15 * 60000,
        total_rem_sleep_time_milli: 5 * 60000,
      },
    },
  };
  const out = normalizeNights({ sleep: [...base, extra], recovery: [], cycle: [] });
  assert.equal(out.length, 1);
  assert.equal(out[0].sleepId, base[0].id, 'the longer sleep stays the night');
  assert.equal(out[0].naps.length, 1);
  assert.equal(out[0].napMin, 50);
});

test('empty and malformed input degrade gracefully', () => {
  assert.deepEqual(normalizeNights({}), []);
  assert.deepEqual(normalizeNights({ sleep: [], recovery: [], cycle: [] }), []);
  assert.deepEqual(normalizeNights({ sleep: [{ score_state: 'PENDING_SCORE' }] }), []);
});

test('indexRecoveryBySleepId and toNightRecovery', () => {
  const idx = indexRecoveryBySleepId(raw.recovery);
  assert.equal(idx.size, raw.recovery.length);
  assert.equal(indexRecoveryBySleepId([{ score_state: 'PENDING_SCORE', sleep_id: 'a' }]).size, 0);
  assert.equal(toNightRecovery(null), null);
  assert.deepEqual(
    toNightRecovery({
      score_state: 'SCORED',
      score: { recovery_score: 70, hrv_rmssd_milli: 55.2, resting_heart_rate: 52, spo2_percentage: 97, skin_temp_celsius: 34, user_calibrating: true },
    }),
    { score: 70, hrvMs: 55.2, rhr: 52, spo2: 97, skinTempC: 34, calibrating: true },
  );
});
