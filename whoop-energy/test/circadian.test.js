import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CBT_OFFSET_MIN,
  CURVE_POINTS,
  CURVE_STEP_MIN,
  C_WEIGHT,
  DEBT_S_GAIN,
  DLMO_OFFSET_MIN,
  INERTIA_AMPLITUDE,
  INERTIA_MAX_MIN,
  INERTIA_TAU_MIN,
  MAX_PAYBACK_MIN,
  PAYBACK_PER_DEBT_HOUR_MIN,
  S_INITIAL,
  S_WEIGHT,
  TAU_SLEEP_H,
  TAU_WAKE_H,
  buildEnergyDay,
  computeAnchors,
  processC,
  simulateS,
  sleepInertia,
} from '../src/model/circadian.js';
import { makeNights } from './helpers/makeNights.js';

const TZ = 120;
const DATE = '2026-01-15';

test('constants match PLAN §5', () => {
  assert.equal(TAU_WAKE_H, 18.2);
  assert.equal(TAU_SLEEP_H, 4.2);
  assert.equal(S_INITIAL, 0.5);
  assert.equal(INERTIA_AMPLITUDE, 0.35);
  assert.equal(INERTIA_TAU_MIN, 30);
  assert.equal(INERTIA_MAX_MIN, 120);
  assert.equal(C_WEIGHT, 0.6);
  assert.equal(S_WEIGHT, 0.8);
  assert.equal(DEBT_S_GAIN, 0.15);
  assert.equal(CBT_OFFSET_MIN, -120);
  assert.equal(DLMO_OFFSET_MIN, -420);
  assert.equal(PAYBACK_PER_DEBT_HOUR_MIN, 15);
  assert.equal(MAX_PAYBACK_MIN, 45);
});

// --- anchors ---------------------------------------------------------------

test('computeAnchors derives CBT and DLMO from habitual wake', () => {
  const anchors = computeAnchors(makeNights(7, { wakeMin: 420, bedtimeMin: 1380 }));
  assert.equal(anchors.habitualWakeMin, 420);
  assert.equal(anchors.habitualBedtimeMin, 1380);
  assert.equal(anchors.cbtMin, 420 + CBT_OFFSET_MIN);
  assert.equal(anchors.dlmo, 420 + CBT_OFFSET_MIN + DLMO_OFFSET_MIN + 1440);
  assert.equal(anchors.midsleepMin, 180); // 23:00 → 07:00, midpoint 03:00
});

test('computeAnchors handles a schedule that crosses midnight', () => {
  const anchors = computeAnchors(makeNights(7, { bedtimeMin: 30, wakeMin: 8 * 60 }));
  assert.equal(anchors.habitualBedtimeMin, 30, 'bedtime 00:30 must not average towards noon');
  assert.equal(anchors.habitualWakeMin, 480);
  assert.equal(anchors.midsleepMin, 255); // 04:15
  assert.equal(anchors.cbtMin, 360); // 06:00
  assert.equal(anchors.dlmo, 1380); // 23:00 the previous evening
});

test('computeAnchors averages circularly around midnight', () => {
  // 23:40 and 00:20 must average to midnight, not to 12:00.
  const nights = makeNights(6, { bedtimeMin: (i) => (i % 2 ? 20 : 1420), wakeMin: 7 * 60 });
  const anchors = computeAnchors(nights);
  assert.ok(anchors.habitualBedtimeMin <= 5 || anchors.habitualBedtimeMin >= 1435, `got ${anchors.habitualBedtimeMin}`);
});

test('computeAnchors falls back to defaults with no history', () => {
  const anchors = computeAnchors([]);
  assert.equal(anchors.habitualWakeMin, 7 * 60);
  assert.equal(anchors.habitualBedtimeMin, 23 * 60);
});

// --- process C -------------------------------------------------------------

test('processC is 24h periodic and troughs near the CBT minimum', () => {
  const anchors = computeAnchors(makeNights(7, {}));
  for (const t of [0, 137, 640, 1439]) {
    assert.ok(Math.abs(processC(t, anchors) - processC(t + 1440, anchors)) < 1e-9);
  }
  let argmin = 0;
  let argmax = 0;
  for (let t = 1; t < 1440; t += 1) {
    if (processC(t, anchors) < processC(argmin, anchors)) argmin = t;
    if (processC(t, anchors) > processC(argmax, anchors)) argmax = t;
  }
  const distance = Math.min(Math.abs(argmin - anchors.cbtMin), 1440 - Math.abs(argmin - anchors.cbtMin));
  assert.ok(distance <= 120, `trough at ${argmin}, cbt at ${anchors.cbtMin}`);
  // The peak sits in the late afternoon / evening, ~12h from the trough.
  assert.ok(argmax > 16 * 60 && argmax < 22 * 60, `peak at ${argmax}`);
});

// --- process S -------------------------------------------------------------

test('simulateS returns a bounded pressure that falls during sleep', () => {
  const nights = makeNights(14, {});
  const atWake = simulateS(nights, { upToIso: nights.at(-1).end });
  const atBed = simulateS(nights, { upToIso: nights.at(-1).start });
  assert.ok(atWake > 0 && atWake < 1);
  assert.ok(atBed > atWake, 'pressure must be higher at bedtime than at wake');
  assert.ok(atWake < 0.2, `expected a rested wake pressure, got ${atWake}`);
});

test('simulateS: shorter nights leave more pressure at wake', () => {
  const rested = makeNights(14, { asleepMin: 480 });
  const short = makeNights(14, { asleepMin: 300 });
  assert.ok(
    simulateS(short, { upToIso: short.at(-1).end }) > simulateS(rested, { upToIso: rested.at(-1).end }),
  );
});

test('simulateS is insensitive to the starting value after a long window', () => {
  const nights = makeNights(14, {});
  const long = simulateS(nights, { upToIso: nights.at(-1).end });
  const short = simulateS(nights.slice(-3), { upToIso: nights.at(-1).end });
  assert.ok(Math.abs(long - short) < 0.01);
});

test('simulateS with no records returns the seed value', () => {
  assert.equal(simulateS([], {}), S_INITIAL);
});

// --- inertia ---------------------------------------------------------------

test('sleepInertia decays exponentially and stops after two hours', () => {
  assert.equal(sleepInertia(420, 420), INERTIA_AMPLITUDE);
  assert.ok(Math.abs(sleepInertia(450, 420) - INERTIA_AMPLITUDE * Math.exp(-1)) < 1e-12);
  assert.equal(sleepInertia(420 + INERTIA_MAX_MIN + 1, 420), 0);
  assert.equal(sleepInertia(419, 420), 0);
});

// --- the day ---------------------------------------------------------------

test('buildEnergyDay returns 96 points on a 15-minute grid', () => {
  const day = buildEnergyDay({ nights: makeNights(14, {}), tzOffsetMin: TZ, date: DATE });
  assert.equal(day.curve.length, CURVE_POINTS);
  assert.equal(day.curve[0].t, day.wakeMin);
  for (let i = 1; i < day.curve.length; i += 1) {
    assert.equal(day.curve[i].t - day.curve[i - 1].t, CURVE_STEP_MIN);
    assert.ok(Date.parse(day.curve[i].iso) > Date.parse(day.curve[i - 1].iso));
  }
  assert.equal(day.curve.at(-1).t, day.wakeMin + (CURVE_POINTS - 1) * CURVE_STEP_MIN);
  for (const p of day.curve) {
    assert.ok(p.energy >= 0 && p.energy <= 100, `energy out of range: ${p.energy}`);
    assert.ok(p.S >= 0 && p.S <= 1);
    assert.ok(p.inertia >= 0 && p.inertia <= INERTIA_AMPLITUDE);
    assert.equal(typeof p.iso, 'string');
  }
});

test('the curve rises after wake, dips in the afternoon and peaks again in the evening', () => {
  const day = buildEnergyDay({ nights: makeNights(14, {}), tzOffsetMin: TZ, date: DATE });
  const energyAt = (offsetMin) => day.curve[offsetMin / CURVE_STEP_MIN].energy;

  // morning rise
  assert.ok(energyAt(240) > energyAt(0) + 30, 'energy must climb through the morning');

  const zoneOf = (kind) => day.zones.find((z) => z.kind === kind);
  const within = (zone) => day.curve.filter((p) => p.t >= zone.startMin && p.t <= zone.endMin);
  const dip = within(zoneOf('afternoon_dip'));
  const morning = within(zoneOf('morning_peak'));
  const evening = within(zoneOf('evening_peak'));

  const dipMin = Math.min(...dip.map((p) => p.energy));
  const morningMax = Math.max(...morning.map((p) => p.energy));
  const eveningMax = Math.max(...evening.map((p) => p.energy));

  assert.ok(dipMin < morningMax, `dip ${dipMin} should be below the morning peak ${morningMax}`);
  assert.ok(dipMin < eveningMax, `dip ${dipMin} should be below the evening peak ${eveningMax}`);
});

test('targets are rounded to 5 minutes and payback tracks debt', () => {
  const day = buildEnergyDay({ nights: makeNights(14, { asleepMin: 400 }), tzOffsetMin: TZ, date: DATE });
  assert.equal(day.targetBedtimeMin % 5, 0);
  assert.equal(day.targetWakeMin % 5, 0);
  assert.equal(day.targetWakeMin, day.anchors.habitualWakeMin);

  const payback = Math.min(MAX_PAYBACK_MIN, day.debt.hours * PAYBACK_PER_DEBT_HOUR_MIN);
  assert.equal(day.need.todayMin, Math.round(day.need.baselineMin + payback));
  assert.ok(day.need.todayMin > day.need.baselineMin, 'a short sleeper should owe extra sleep today');
});

test('a rested sleeper gets no bedtime payback', () => {
  const day = buildEnergyDay({ nights: makeNights(14, {}), tzOffsetMin: TZ, date: DATE });
  assert.equal(day.debt.hours, 0);
  assert.equal(day.need.todayMin, day.need.baselineMin);
  assert.equal(day.targetBedtimeMin, Math.round(day.anchors.habitualBedtimeMin / 5) * 5);
});

test('debt drags the whole curve down', () => {
  const rested = buildEnergyDay({ nights: makeNights(14, {}), tzOffsetMin: TZ, date: DATE });
  const tired = buildEnergyDay({ nights: makeNights(14, { asleepMin: 330 }), tzOffsetMin: TZ, date: DATE });
  assert.ok(tired.debt.hours > rested.debt.hours);
  assert.ok(tired.curve.some((p) => p.S > 0));
  const restedS = rested.curve[32].S;
  const tiredS = tired.curve[32].S;
  assert.ok(tiredS > restedS, 'a sleep-deprived day carries more homeostatic pressure');
});

test('the curve starts at last night’s actual wake', () => {
  const nights = makeNights(14, { wakeMin: 6 * 60 });
  nights.at(-1).wakeMin = 8 * 60 + 30; // slept in today
  const day = buildEnergyDay({ nights, tzOffsetMin: TZ, date: DATE });
  assert.equal(day.wakeMin, 510);
  assert.equal(day.curve[0].t, 510);
  assert.equal(day.anchors.habitualWakeMin !== 510, true);
});

test('a missing night for the requested date falls back to habitual wake', () => {
  const nights = makeNights(14, { wakeMin: 6 * 60, endDate: '2026-01-10' });
  const day = buildEnergyDay({ nights, tzOffsetMin: TZ, date: DATE });
  assert.equal(day.wakeMin, day.anchors.habitualWakeMin);
  assert.equal(day.date, DATE);
});

test('buildEnergyDay survives an empty history', () => {
  const day = buildEnergyDay({ nights: [], tzOffsetMin: TZ, date: DATE });
  assert.equal(day.curve.length, CURVE_POINTS);
  assert.equal(day.lastNight, null);
  assert.equal(day.recovery, null);
  assert.equal(day.debt.hours, 0);
  assert.equal(day.need.baselineMin, 480);
  assert.ok(day.zones.length === 7);
});

test('the EnergyDay envelope matches the contract', () => {
  const day = buildEnergyDay({ nights: makeNights(14, {}), nowMin: 615, tzOffsetMin: TZ, date: DATE });
  assert.deepEqual(Object.keys(day).sort(), [
    'anchors',
    'curve',
    'date',
    'debt',
    'lastNight',
    'need',
    'now',
    'plan',
    'recovery',
    'targetBedtimeMin',
    'targetWakeMin',
    'tzOffsetMin',
    'wakeMin',
    'zones',
  ]);
  assert.equal(day.now, 615);
  assert.equal(day.tzOffsetMin, TZ);
  assert.deepEqual(Object.keys(day.debt).sort(), ['hours', 'level', 'trend7d']);
  assert.deepEqual(Object.keys(day.anchors).sort(), [
    'cbtMin',
    'dlmo',
    'habitualBedtimeMin',
    'habitualWakeMin',
    'midsleepMin',
  ]);
  assert.deepEqual(Object.keys(day.curve[0]).sort(), ['C', 'S', 'energy', 'inertia', 'iso', 't']);
});
