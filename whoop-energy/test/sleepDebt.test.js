import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEBT_CAP_MULTIPLIER,
  DEBT_DECAY,
  DEBT_WINDOW,
  DEFAULT_NEED_MIN,
  TREND_EPSILON_HOURS,
  computeSleepDebt,
  computeSleepNeed,
  debtLevel,
  totalSleepMin,
  weightedDebtHours,
} from '../src/model/sleepDebt.js';
import { makeNights } from './helpers/makeNights.js';

test('constants match PLAN §5', () => {
  assert.equal(DEBT_DECAY, 0.9);
  assert.equal(DEBT_WINDOW, 14);
  assert.equal(DEFAULT_NEED_MIN, 480);
  assert.equal(DEBT_CAP_MULTIPLIER, 2);
});

test('computeSleepNeed averages needBaselineMin', () => {
  const nights = makeNights(14, { needMin: (i) => 460 + i * 2 });
  // 460,462,…,486 → mean 473
  assert.equal(computeSleepNeed(nights), 473);
});

test('computeSleepNeed honours the override and falls back to 480', () => {
  const nights = makeNights(7, { needMin: 500 });
  assert.equal(computeSleepNeed(nights, { overrideMin: 450 }), 450);
  assert.equal(computeSleepNeed([]), DEFAULT_NEED_MIN);
  assert.equal(computeSleepNeed(makeNights(7, { calibrating: true })), DEFAULT_NEED_MIN);
});

test('debt is zero when every night hits the need', () => {
  const nights = makeNights(14, { asleepMin: 480, needMin: 480 });
  const debt = computeSleepDebt(nights, 480);
  assert.equal(debt.hours, 0);
  assert.equal(debt.level, 'low');
  assert.equal(debt.trend7d, 'flat');
  assert.equal(debt.byDay.length, 14);
  assert.ok(debt.byDay.every((d) => d.deltaMin === 0 && d.cumulativeDebtHours === 0));
});

test('naps count towards the need', () => {
  const nights = makeNights(14, { asleepMin: 450, napMin: 30 });
  assert.equal(totalSleepMin(nights[0]), 480);
  assert.equal(computeSleepDebt(nights, 480).hours, 0);
});

test('a single 4.5h night three days ago produces moderate-or-worse debt', () => {
  const nights = makeNights(14, {
    asleepMin: 480,
    override: (i) => (i === 11 ? { asleepMin: 270 } : {}), // i=11 of 0..13 → three days ago
  });
  const debt = computeSleepDebt(nights, 480);
  // weight for the 3rd-most-recent night is 0.9^2; deficit is 210 min
  const expected = Math.round((DEBT_DECAY ** 2 * 210) / 60 * 100) / 100;
  assert.equal(debt.hours, expected);
  assert.ok(debt.hours > 0, 'debt must be positive');
  assert.ok(['moderate', 'high', 'severe'].includes(debt.level), `got ${debt.level}`);
  assert.equal(debt.byDay[11].deltaMin, 210);
  assert.equal(debt.byDay[11].asleepMin, 270);
});

test('debt levels follow the PLAN thresholds', () => {
  assert.equal(debtLevel(0), 'low');
  assert.equal(debtLevel(0.99), 'low');
  assert.equal(debtLevel(1), 'moderate');
  assert.equal(debtLevel(3), 'moderate');
  assert.equal(debtLevel(3.01), 'high');
  assert.equal(debtLevel(5), 'high');
  assert.equal(debtLevel(5.01), 'severe');
});

test('debt is capped at 2x need and never negative', () => {
  const starved = makeNights(14, { asleepMin: 0, efficiencyPct: 100 });
  assert.equal(computeSleepDebt(starved, 480).hours, (DEBT_CAP_MULTIPLIER * 480) / 60);
  const rested = makeNights(14, { asleepMin: 600 });
  assert.equal(computeSleepDebt(rested, 480).hours, 0);
});

test('older nights are discounted by 0.9^(i-1)', () => {
  const need = 480;
  const one = makeNights(1, { asleepMin: 420 });
  assert.equal(weightedDebtHours(one, need), 1);
  const two = makeNights(2, { asleepMin: 420 });
  // 60 + 0.9*60 = 114 min = 1.9h
  assert.equal(weightedDebtHours(two, need), 1.9);
});

test('only the last 14 nights count', () => {
  const nights = makeNights(21, { asleepMin: (i) => (i < 7 ? 240 : 480) });
  assert.equal(computeSleepDebt(nights, 480).hours, 0);
  assert.equal(computeSleepDebt(nights, 480).byDay.length, DEBT_WINDOW);
});

test('trend7d compares the two 7-night halves', () => {
  const rising = makeNights(14, { asleepMin: (i) => (i < 7 ? 480 : 360) });
  assert.equal(computeSleepDebt(rising, 480).trend7d, 'rising');

  const falling = makeNights(14, { asleepMin: (i) => (i < 7 ? 360 : 480) });
  assert.equal(computeSleepDebt(falling, 480).trend7d, 'falling');

  const flat = makeNights(14, { asleepMin: 450 });
  assert.equal(computeSleepDebt(flat, 480).trend7d, 'flat');

  // A difference smaller than the epsilon still reads flat.
  const nudge = makeNights(14, { asleepMin: (i) => (i < 7 ? 480 : 478) });
  const d = computeSleepDebt(nudge, 480);
  assert.ok(d.hours < TREND_EPSILON_HOURS);
  assert.equal(d.trend7d, 'flat');
});

test('byDay carries the contract fields in chronological order', () => {
  const nights = makeNights(14, { asleepMin: 420 });
  const { byDay } = computeSleepDebt(nights, 480);
  for (const row of byDay) {
    assert.deepEqual(Object.keys(row).sort(), [
      'asleepMin',
      'cumulativeDebtHours',
      'date',
      'deltaMin',
      'needMin',
    ]);
    assert.equal(row.needMin, 480);
    assert.equal(row.deltaMin, 60);
  }
  assert.deepEqual(
    byDay.map((d) => d.date),
    nights.map((n) => n.date),
  );
  assert.ok(byDay[13].cumulativeDebtHours > byDay[0].cumulativeDebtHours);
});

test('unsorted input is handled', () => {
  const nights = makeNights(14, { asleepMin: (i) => (i === 13 ? 300 : 480) });
  const shuffled = [...nights].reverse();
  assert.equal(computeSleepDebt(shuffled, 480).hours, computeSleepDebt(nights, 480).hours);
});
