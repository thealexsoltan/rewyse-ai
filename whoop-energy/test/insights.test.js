import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CORR_MIN_N,
  CORR_MIN_R,
  MAX_RECOMMENDATIONS,
  REC_DEBT_HOURS,
  REC_SD_MIN,
  bedtimeLateness,
  buildRecommendations,
  computeCorrelations,
  computeInsights,
  pearson,
} from '../src/model/insights.js';
import { makeNights } from './helpers/makeNights.js';

// --- pearson ---------------------------------------------------------------

test('pearson returns +1 / -1 for perfectly correlated vectors', () => {
  assert.deepEqual(pearson([1, 2, 3], [2, 4, 6]), { r: 1, n: 3 });
  assert.deepEqual(pearson([1, 2, 3], [6, 4, 2]), { r: -1, n: 3 });
});

test('pearson matches a hand-computed coefficient', () => {
  // Σdxdy = 6, Σdx² = 10, Σdy² = 6 → r = 6/√60 = 0.7745966…
  assert.deepEqual(pearson([1, 2, 3, 4, 5], [2, 4, 5, 4, 5]), { r: 0.775, n: 5 });
  assert.deepEqual(pearson([10, 20, 30, 40], [1, 3, 2, 4]), { r: 0.8, n: 4 });
});

test('pearson is null when it cannot be defined', () => {
  assert.equal(pearson([1, 2, 3], [5, 5, 5]), null, 'zero variance');
  assert.equal(pearson([5, 5, 5], [1, 2, 3]), null, 'zero variance');
  assert.equal(pearson([1], [2]), null, 'single pair');
  assert.equal(pearson([], []), null);
  assert.equal(pearson(undefined, undefined), null);
});

test('pearson drops pairs with a missing member', () => {
  assert.deepEqual(pearson([1, 2, 3, NaN], [2, 4, 6, 99]), { r: 1, n: 3 });
  assert.deepEqual(pearson([1, 2, 3, 4], [2, 4, 6, null]), { r: 1, n: 3 });
});

test('bedtimeLateness keeps midnight-crossing bedtimes ordered', () => {
  assert.equal(bedtimeLateness(18 * 60), 0);
  assert.equal(bedtimeLateness(23 * 60 + 30), 330);
  assert.equal(bedtimeLateness(30), 390);
  assert.ok(bedtimeLateness(30) > bedtimeLateness(23 * 60 + 30));
});

// --- correlations ----------------------------------------------------------

test('correlations need enough samples and enough signal', () => {
  const few = makeNights(CORR_MIN_N - 1, {
    seed: 11,
    asleepMin: (i) => 360 + i * 20,
    recoveryScore: (i) => 40 + i * 5,
  });
  assert.deepEqual(computeCorrelations(few), [], 'fewer than CORR_MIN_N pairs is not reportable');

  const enough = makeNights(CORR_MIN_N + 3, {
    seed: 11,
    asleepMin: (i) => 360 + i * 20,
    recoveryScore: (i) => 40 + i * 5,
  });
  const corrs = computeCorrelations(enough);
  const sleepVsRecovery = corrs.find((c) => c.x === 'asleepMin' && c.y === 'recoveryScore');
  assert.ok(sleepVsRecovery, 'a perfect sleep↔recovery relationship must be reported');
  assert.equal(sleepVsRecovery.r, 1);
  assert.equal(sleepVsRecovery.n, CORR_MIN_N + 3);
  assert.match(sleepVsRecovery.reading, /r = 1\.00, n = 10/);
  for (const c of corrs) assert.ok(Math.abs(c.r) >= CORR_MIN_R);
});

test('correlations are dropped when the relationship is weak', () => {
  const flat = makeNights(14, { asleepMin: 480, recoveryScore: 65 });
  assert.deepEqual(computeCorrelations(flat), []);
});

test('a late-bedtime penalty shows up as a negative correlation', () => {
  const nights = makeNights(14, {
    seed: 2,
    wakeMin: 7 * 60,
    bedtimeMin: (i) => 1320 + i * 10,
    recoveryScore: (i) => 80 - i * 3,
  });
  const corr = computeCorrelations(nights).find((c) => c.x === 'bedtimeLateness');
  assert.ok(corr);
  assert.ok(corr.r <= -CORR_MIN_R, `expected a negative r, got ${corr.r}`);
  assert.match(corr.reading, /cost you recovery/);
});

// --- recommendations -------------------------------------------------------

/** A sleeper doing almost everything wrong. */
function badSleeper() {
  return makeNights(14, {
    seed: 3,
    asleepMin: (i, r) => 300 + Math.round(r() * 90),
    efficiencyPct: 78,
    bedtimeMin: (i, r) => 1380 + Math.round(r() * 120),
    wakeMin: (i, r) => 390 + Math.round(r() * 120),
    recoveryScore: (i, r) => (i < 7 ? 60 + Math.round(r() * 10) : 35 + Math.round(r() * 10)),
    hrvMs: (i) => (i < 7 ? 70 : 50),
    rhr: (i) => (i < 7 ? 52 : 58),
    disturbances: 15,
    consistencyPct: 55,
  });
}

/** A sleeper with nothing to fix. */
function greatSleeper() {
  return makeNights(14, {
    seed: 5,
    asleepMin: (i, r) => 480 + Math.round(r() * 20 - 10),
    efficiencyPct: 93,
    consistencyPct: 90,
    disturbances: 4,
    recoveryScore: (i, r) => 70 + Math.round(r() * 10),
    hrvMs: (i, r) => 65 + Math.round(r() * 6 - 3),
    rhr: (i, r) => 50 + Math.round(r() * 2 - 1),
  });
}

test('a bad sleeper gets a full, ranked recommendation list', () => {
  const insights = computeInsights(badSleeper());
  const recs = insights.recommendations;
  assert.ok(recs.length > 0, 'recommendations must not be empty');
  assert.ok(recs.length <= MAX_RECOMMENDATIONS);
  assert.deepEqual(recs.map((r) => r.rank), recs.map((_, i) => i + 1));

  const order = { high: 0, medium: 1, low: 2 };
  for (let i = 1; i < recs.length; i += 1) {
    assert.ok(order[recs[i].impact] >= order[recs[i - 1].impact], 'impact must not increase down the list');
  }
  for (const rec of recs) {
    for (const field of ['title', 'why', 'action']) {
      assert.equal(typeof rec[field], 'string');
      assert.ok(rec[field].length > 10, `${field} too short in "${rec.title}"`);
    }
  }
  assert.ok(insights.debt.hours >= REC_DEBT_HOURS);
  assert.equal(recs[0].title, 'Pay down your sleep debt');
  assert.match(recs[0].action, /nights/);
  assert.ok(recs.some((r) => r.title.includes('HRV')));
  assert.ok(recs.some((r) => r.title.includes('efficiency')));
});

test('a great sleeper gets little or nothing to do', () => {
  const insights = computeInsights(greatSleeper());
  assert.ok(insights.recommendations.length <= 2, `expected a short list, got ${insights.recommendations.length}`);
  assert.equal(insights.recommendations.filter((r) => r.impact === 'high').length, 0);
  assert.equal(insights.debt.level, 'low');
});

test('an irregular schedule triggers the wake-anchor advice', () => {
  const nights = makeNights(14, {
    wakeMin: (i) => (i % 2 ? 6 * 60 : 9 * 60),
    bedtimeMin: (i) => (i % 2 ? 22 * 60 : 25 * 60 - 1440 + 1440),
    asleepMin: 470,
  });
  const insights = computeInsights(nights);
  assert.ok(insights.consistency.wakeSdMin >= REC_SD_MIN, `wake SD ${insights.consistency.wakeSdMin}`);
  const anchor = insights.recommendations.find((r) => r.title === 'Anchor your wake time');
  assert.ok(anchor);
  assert.equal(anchor.impact, 'high');
  assert.match(anchor.action, /\d{2}:\d{2}/);
});

test('buildRecommendations returns nothing when every metric is healthy', () => {
  const recs = buildRecommendations({
    debt: { hours: 0.2, level: 'low', trend7d: 'flat', byDay: [] },
    consistency: { bedtimeSdMin: 10, wakeSdMin: 8, whoopConsistencyAvg: 90 },
    quality: { efficiencyAvg: 94, disturbancesAvg: 4, swsPctAvg: 22, remPctAvg: 24, performanceAvg: 96 },
    recovery: { avg: 70, avg7d: 71, hrvAvg: 60, hrvAvg7d: 61, hrvDeltaPct: 1.7, rhrAvg: 50, rhrAvg7d: 50, calibrating: false },
    correlations: [],
    habitualWakeMin: 420,
    needMin: 480,
  });
  assert.deepEqual(recs, []);
});

// --- envelope --------------------------------------------------------------

test('computeInsights matches the Insights contract', () => {
  const insights = computeInsights(badSleeper(), { windowDays: 14 });
  assert.deepEqual(Object.keys(insights).sort(), [
    'consistency',
    'correlations',
    'debt',
    'nights',
    'quality',
    'recommendations',
    'recovery',
    'windowDays',
  ]);
  assert.equal(insights.windowDays, 14);
  assert.equal(insights.nights, 14);
  assert.deepEqual(Object.keys(insights.debt).sort(), ['byDay', 'hours', 'level', 'trend7d']);
  assert.deepEqual(Object.keys(insights.consistency).sort(), ['bedtimeSdMin', 'wakeSdMin', 'whoopConsistencyAvg']);
  assert.deepEqual(Object.keys(insights.quality).sort(), [
    'disturbancesAvg',
    'efficiencyAvg',
    'performanceAvg',
    'remPctAvg',
    'swsPctAvg',
  ]);
  assert.deepEqual(Object.keys(insights.recovery).sort(), [
    'avg',
    'avg7d',
    'calibrating',
    'hrvAvg',
    'hrvAvg7d',
    'hrvDeltaPct',
    'rhrAvg',
    'rhrAvg7d',
  ]);
  for (const corr of insights.correlations) {
    assert.deepEqual(Object.keys(corr).sort(), ['n', 'r', 'reading', 'x', 'y']);
  }
  for (const rec of insights.recommendations) {
    assert.deepEqual(Object.keys(rec).sort(), ['action', 'impact', 'rank', 'title', 'why']);
  }
});

test('computeInsights honours the window and reuses computeSleepDebt', () => {
  const nights = makeNights(21, { asleepMin: (i) => (i < 14 ? 240 : 480) });
  const insights = computeInsights(nights, { windowDays: 7 });
  assert.equal(insights.windowDays, 7);
  assert.equal(insights.nights, 7);
  assert.equal(insights.debt.hours, 0, 'only the last 7 (good) nights should count');
  assert.equal(insights.debt.byDay.length, 7);
});

test('computeInsights survives sparse data', () => {
  const insights = computeInsights([]);
  assert.equal(insights.nights, 0);
  assert.equal(insights.debt.hours, 0);
  assert.equal(insights.consistency.bedtimeSdMin, null);
  assert.equal(insights.quality.efficiencyAvg, null);
  assert.equal(insights.recovery.hrvDeltaPct, null);
  assert.deepEqual(insights.correlations, []);

  const noRecovery = makeNights(14, { recoveryScore: null, strain: null });
  const partial = computeInsights(noRecovery);
  assert.equal(partial.recovery.avg, null);
  assert.equal(partial.recovery.calibrating, false);
  assert.ok(Array.isArray(partial.recommendations));
});

test('a supplied need overrides the WHOOP baseline', () => {
  const nights = makeNights(14, { asleepMin: 480, needMin: 480 });
  assert.equal(computeInsights(nights).debt.hours, 0);
  assert.ok(computeInsights(nights, { needMin: 540 }).debt.hours > 0);
});
