import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DIP_FALLBACK_END_MIN,
  DIP_FALLBACK_START_MIN,
  GROGGINESS_FALLBACK_MIN,
  MELATONIN_LEAD_MIN,
  MELATONIN_TAIL_MIN,
  NAP_CUTOFF_BEFORE_BED_MIN,
  NAP_DEBT_MIN_HOURS,
  NAP_MIN,
  RECOVERY_GREEN_MIN,
  RECOVERY_YELLOW_MIN,
  WIND_DOWN_LEAD_MIN,
  WORKOUT_HARD_MIN,
  ZONE_LABELS,
  buildDayPlan,
  detectZones,
  splitAroundDinner,
  unwrapCurve,
} from '../src/model/zones.js';
import { buildEnergyDay } from '../src/model/circadian.js';
import { makeNights } from './helpers/makeNights.js';

const TZ = 120;
const DATE = '2026-01-15';
const ORDER = [
  'grogginess',
  'morning_peak',
  'afternoon_dip',
  'evening_peak',
  'wind_down',
  'melatonin_window',
  'sleep',
];

/** A synthetic flat curve — nothing for the detector to latch onto. */
function flatCurve(wakeMin = 420, energy = 50) {
  return Array.from({ length: 96 }, (_, i) => ({
    t: wakeMin + i * 15,
    iso: `2026-01-15T00:00:00Z`,
    energy,
    S: 0.5,
    C: 0,
    inertia: 0,
  }));
}

function zonesFor(opts = {}) {
  return buildEnergyDay({ nights: makeNights(14, opts), tzOffsetMin: TZ, date: DATE }).zones;
}

// --- zone detection --------------------------------------------------------

test('zones come back in the documented order, once each', () => {
  assert.deepEqual(zonesFor().map((z) => z.kind), ORDER);
});

test('every zone carries a label and a one-sentence advice', () => {
  for (const zone of zonesFor()) {
    assert.equal(zone.label, ZONE_LABELS[zone.kind]);
    assert.ok(zone.label.length > 0);
    assert.equal(typeof zone.advice, 'string');
    assert.ok(zone.advice.length > 20, `advice too short for ${zone.kind}`);
    assert.ok(zone.advice.trim().endsWith('.'), `advice should be a sentence: ${zone.advice}`);
  }
});

test('durations are non-negative and the day chain has no gaps', () => {
  for (const opts of [{}, { asleepMin: 300 }, { bedtimeMin: 30, wakeMin: 540 }, { wakeMin: 300 }]) {
    const zones = zonesFor(opts);
    for (const zone of zones) {
      assert.ok(zone.endMin - zone.startMin >= 0, `${zone.kind} has a negative duration`);
    }
    // grogginess → melatonin_window is a contiguous chain.
    for (let i = 1; i < 6; i += 1) {
      assert.equal(zones[i].startMin, zones[i - 1].endMin, `gap before ${zones[i].kind}`);
    }
    const mel = zones[5];
    const sleep = zones[6];
    assert.equal(mel.endMin - mel.startMin, MELATONIN_LEAD_MIN + MELATONIN_TAIL_MIN);
    // Target bedtime sits inside the melatonin window by construction.
    assert.ok(sleep.startMin > mel.startMin && sleep.startMin < mel.endMin);
    assert.equal(sleep.startMin, mel.startMin + MELATONIN_LEAD_MIN);
  }
});

test('zone boundaries stay monotonic across midnight', () => {
  const zones = zonesFor({ bedtimeMin: 90, wakeMin: 9 * 60, asleepMin: 420 });
  const bounds = zones.slice(0, 6).flatMap((z) => [z.startMin, z.endMin]);
  for (let i = 1; i < bounds.length; i += 1) assert.ok(bounds[i] >= bounds[i - 1]);
  const sleep = zones.at(-1);
  assert.ok(sleep.startMin > 1440, `a 01:30 bedtime must be expressed past midnight, got ${sleep.startMin}`);
  assert.ok(sleep.endMin > sleep.startMin);
  assert.ok(sleep.endMin - sleep.startMin >= 240);
});

test('wind-down and the melatonin window hang off target bedtime', () => {
  const zones = zonesFor();
  const bed = zones.find((z) => z.kind === 'sleep').startMin;
  assert.equal(zones.find((z) => z.kind === 'melatonin_window').startMin, bed - MELATONIN_LEAD_MIN);
  assert.equal(zones.find((z) => z.kind === 'melatonin_window').endMin, bed + MELATONIN_TAIL_MIN);
  assert.equal(zones.find((z) => z.kind === 'wind_down').endMin, bed - MELATONIN_LEAD_MIN);
  assert.ok(zones.find((z) => z.kind === 'wind_down').startMin <= bed - WIND_DOWN_LEAD_MIN);
});

test('a flat curve falls back to the clock windows', () => {
  const zones = detectZones(flatCurve(), { wakeMin: 420, targetBedtimeMin: 1380, targetWakeMin: 420 });
  const grog = zones.find((z) => z.kind === 'grogginess');
  const dip = zones.find((z) => z.kind === 'afternoon_dip');
  assert.equal(grog.endMin, 420 + GROGGINESS_FALLBACK_MIN);
  assert.equal(dip.startMin, 420 + DIP_FALLBACK_START_MIN);
  assert.equal(dip.endMin, 420 + DIP_FALLBACK_END_MIN);
  assert.deepEqual(zones.map((z) => z.kind), ORDER);
});

test('detectZones accepts a curve whose t values wrapped past midnight', () => {
  const wrapped = flatCurve(1320).map((p) => ({ ...p, t: p.t % 1440 }));
  const zones = detectZones(wrapped, { wakeMin: 1320, targetBedtimeMin: 900, targetWakeMin: 1320 });
  assert.deepEqual(zones.map((z) => z.kind), ORDER);
  for (const zone of zones) assert.ok(zone.endMin >= zone.startMin);
  assert.equal(unwrapCurve(wrapped).length, 96);
  assert.equal(unwrapCurve(wrapped).at(-1).t, 1320 + 95 * 15);
});

test('detectZones tolerates an empty curve', () => {
  const zones = detectZones([], { wakeMin: 420, targetBedtimeMin: 1350, targetWakeMin: 420 });
  assert.deepEqual(zones.map((z) => z.kind), ORDER);
  for (const zone of zones) assert.ok(zone.endMin >= zone.startMin);
});

// --- day plan --------------------------------------------------------------

function planFor(opts = {}) {
  return buildEnergyDay({ nights: makeNights(14, opts), tzOffsetMin: TZ, date: DATE }).plan;
}

test('every plan entry has a reason and a non-negative span', () => {
  for (const entry of planFor()) {
    assert.ok(entry.endMin > entry.startMin, `${entry.activity} has no duration`);
    assert.equal(typeof entry.reason, 'string');
    assert.ok(entry.reason.length > 20, `reason too short: ${entry.reason}`);
  }
});

test('the plan is sorted by start time', () => {
  const plan = planFor();
  for (let i = 1; i < plan.length; i += 1) assert.ok(plan[i].startMin >= plan[i - 1].startMin);
});

test('red recovery gets no workout, green gets exactly one', () => {
  const red = planFor({ recoveryScore: RECOVERY_YELLOW_MIN - 10 });
  assert.equal(red.filter((p) => p.activity === 'workout').length, 0, 'red recovery must not schedule a workout');

  const green = planFor({ recoveryScore: RECOVERY_GREEN_MIN + 10 });
  const workouts = green.filter((p) => p.activity === 'workout');
  assert.equal(workouts.length, 1);
  assert.equal(workouts[0].endMin - workouts[0].startMin, WORKOUT_HARD_MIN);
  assert.match(workouts[0].reason, /green/i);
});

test('yellow recovery gets one light evening session', () => {
  const plan = planFor({ recoveryScore: 50 });
  const workouts = plan.filter((p) => p.activity === 'workout');
  assert.equal(workouts.length, 1);
  assert.match(workouts[0].reason, /yellow/i);
  const evening = buildEnergyDay({
    nights: makeNights(14, { recoveryScore: 50 }),
    tzOffsetMin: TZ,
    date: DATE,
  }).zones.find((z) => z.kind === 'evening_peak');
  assert.ok(workouts[0].startMin >= evening.startMin && workouts[0].endMin <= evening.endMin);
});

test('a green day trains in the morning when HRV is above its 7-day average', () => {
  const zones = zonesFor({ recoveryScore: 80 });
  const morning = zones.find((z) => z.kind === 'morning_peak');
  const plan = buildDayPlan({
    zones,
    recovery: { score: 80, hrvMs: 80, rhr: 50, spo2: 97, skinTempC: 33, calibrating: false },
    debtHours: 0,
    hrvMs: 80,
    hrvAvg7d: 60,
  });
  const workout = plan.find((p) => p.activity === 'workout');
  assert.ok(workout);
  assert.equal(workout.startMin, morning.startMin);
  assert.match(workout.reason, /HRV/);
});

test('a green day trains in the evening when HRV is below its 7-day average', () => {
  const zones = zonesFor({ recoveryScore: 80 });
  const evening = zones.find((z) => z.kind === 'evening_peak');
  const plan = buildDayPlan({
    zones,
    recovery: { score: 80, hrvMs: 40, rhr: 50, spo2: 97, skinTempC: 33, calibrating: false },
    debtHours: 0,
    hrvMs: 40,
    hrvAvg7d: 60,
  });
  const workout = plan.find((p) => p.activity === 'workout');
  assert.ok(workout);
  assert.equal(workout.endMin, evening.endMin);
});

test('deep work covers the peaks and admin covers the dip', () => {
  const day = buildEnergyDay({
    nights: makeNights(14, { recoveryScore: 20 }), // red: no workout stealing peak time
    tzOffsetMin: TZ,
    date: DATE,
  });
  const dip = day.zones.find((z) => z.kind === 'afternoon_dip');
  const morning = day.zones.find((z) => z.kind === 'morning_peak');
  const deep = day.plan.filter((p) => p.activity === 'deep_work');
  const admin = day.plan.filter((p) => p.activity === 'admin');

  assert.ok(deep.length >= 1);
  assert.ok(deep.some((p) => p.startMin === morning.startMin && p.endMin === morning.endMin));
  assert.equal(admin.length, 1);
  assert.equal(admin[0].startMin, dip.startMin);
  assert.equal(admin[0].endMin, dip.endMin);
});

test('a nap is offered only with real debt and enough runway before bed', () => {
  const rested = planFor({});
  assert.equal(rested.filter((p) => p.activity === 'nap').length, 0);

  const tired = buildEnergyDay({ nights: makeNights(14, { asleepMin: 330 }), tzOffsetMin: TZ, date: DATE });
  const nap = tired.plan.find((p) => p.activity === 'nap');
  const dip = tired.zones.find((z) => z.kind === 'afternoon_dip');
  const bed = tired.zones.find((z) => z.kind === 'sleep').startMin;
  assert.ok(nap, 'a severely indebted sleeper should be offered a nap');
  assert.ok(tired.debt.hours >= NAP_DEBT_MIN_HOURS);
  assert.equal(nap.startMin, dip.startMin);
  assert.equal(nap.endMin - nap.startMin, NAP_MIN);
  assert.ok(nap.endMin <= bed - NAP_CUTOFF_BEFORE_BED_MIN);
});

test('a late-afternoon dip too close to bedtime blocks the nap', () => {
  const zones = detectZones(flatCurve(720), { wakeMin: 720, targetBedtimeMin: 1350, targetWakeMin: 720 });
  const plan = buildDayPlan({ zones, recovery: null, debtHours: 5 });
  assert.equal(plan.filter((p) => p.activity === 'nap').length, 0);
});

test('the evening peak is split around dinner', () => {
  assert.deepEqual(splitAroundDinner(16 * 60, 22 * 60), [[16 * 60, 19 * 60], [20 * 60, 22 * 60]]);
  // No dinner inside the block → one piece.
  assert.deepEqual(splitAroundDinner(9 * 60, 12 * 60), [[9 * 60, 12 * 60]]);
  // Works past midnight (curve space).
  assert.deepEqual(splitAroundDinner(1440 + 16 * 60, 1440 + 22 * 60), [
    [1440 + 16 * 60, 1440 + 19 * 60],
    [1440 + 20 * 60, 1440 + 22 * 60],
  ]);
  // Fragments shorter than the minimum are dropped.
  assert.deepEqual(splitAroundDinner(18 * 60 + 50, 22 * 60), [[20 * 60, 22 * 60]]);
});

test('wind_down and bed close out the plan', () => {
  const day = buildEnergyDay({ nights: makeNights(14, {}), tzOffsetMin: TZ, date: DATE });
  const windDown = day.plan.find((p) => p.activity === 'wind_down');
  const bed = day.plan.find((p) => p.activity === 'bed');
  const windZone = day.zones.find((z) => z.kind === 'wind_down');
  const sleepZone = day.zones.find((z) => z.kind === 'sleep');
  assert.deepEqual([windDown.startMin, windDown.endMin], [windZone.startMin, windZone.endMin]);
  assert.deepEqual([bed.startMin, bed.endMin], [sleepZone.startMin, sleepZone.endMin]);
  assert.equal(bed, day.plan.at(-1));
});

test('buildDayPlan tolerates missing zones and recovery', () => {
  assert.deepEqual(buildDayPlan({}), []);
  assert.deepEqual(buildDayPlan({ zones: [] }), []);
});
