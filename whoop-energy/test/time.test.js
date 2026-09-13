import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MINUTES_PER_DAY,
  parseTzOffset,
  formatTzOffset,
  toLocalMinutes,
  localDateString,
  minutesBetween,
  addMinutes,
  wrapMinutes,
  clampMinutes,
  fmtHHMM,
  fmtDuration,
  parseHHMM,
  parseHours,
  circularMeanMinutes,
  circularSdMinutes,
  circularDiffMinutes,
  localToIso,
  addDays,
} from '../src/time.js';

test('parseTzOffset handles WHOOP offset strings', () => {
  assert.equal(parseTzOffset('+02:00'), 120);
  assert.equal(parseTzOffset('-05:30'), -330);
  assert.equal(parseTzOffset('+0200'), 120);
  assert.equal(parseTzOffset('-07'), -420);
  assert.equal(parseTzOffset('Z'), 0);
  assert.equal(parseTzOffset(90), 90);
  assert.equal(parseTzOffset('nonsense', -1), -1, 'unparseable falls back');
  assert.equal(parseTzOffset(undefined), 0);
});

test('formatTzOffset round-trips parseTzOffset', () => {
  for (const s of ['+02:00', '-05:30', '+00:00', '+13:45']) {
    assert.equal(formatTzOffset(parseTzOffset(s)), s);
  }
});

test('toLocalMinutes / localDateString shift by the offset', () => {
  const iso = '2026-09-13T22:00:00Z';
  assert.equal(toLocalMinutes(iso, 120), 0, 'midnight the next local day');
  assert.equal(localDateString(iso, 120), '2026-09-14');
  assert.equal(toLocalMinutes(iso, 0), 22 * 60);
  assert.equal(localDateString(iso, 0), '2026-09-13');
  assert.equal(toLocalMinutes('2026-09-13T04:30:00Z', -330), 23 * 60, 'negative offset rolls back a day');
  assert.equal(localDateString('2026-09-13T04:30:00Z', -330), '2026-09-12');
});

test('minutesBetween returns whole signed minutes', () => {
  assert.equal(minutesBetween('2026-01-01T00:00:00Z', '2026-01-01T07:30:00Z'), 450);
  assert.equal(minutesBetween('2026-01-01T07:30:00Z', '2026-01-01T00:00:00Z'), -450);
});

test('addMinutes: numbers wrap, instants shift', () => {
  assert.equal(addMinutes(1430, 30), 20);
  assert.equal(addMinutes(10, -30), 1420);
  assert.equal(addMinutes('2026-01-01T00:00:00Z', 90), '2026-01-01T01:30:00.000Z');
});

test('wrapMinutes and clampMinutes', () => {
  assert.equal(wrapMinutes(1500), 60);
  assert.equal(wrapMinutes(-30), 1410);
  assert.equal(wrapMinutes(1440), 0);
  assert.equal(clampMinutes(-5), 0);
  assert.equal(clampMinutes(2000), MINUTES_PER_DAY);
  assert.equal(clampMinutes(700, 600, 660), 660);
});

test('fmtHHMM wraps past midnight', () => {
  assert.equal(fmtHHMM(0), '00:00');
  assert.equal(fmtHHMM(450), '07:30');
  assert.equal(fmtHHMM(1439), '23:59');
  assert.equal(fmtHHMM(1500), '01:00');
  assert.equal(fmtHHMM(-30), '23:30');
});

test('fmtDuration does not wrap', () => {
  assert.equal(fmtDuration(450), '7h 30m');
  assert.equal(fmtDuration(45), '45m');
  assert.equal(fmtDuration(1500), '25h 0m');
  assert.equal(fmtDuration(-90), '-1h 30m');
});

test('parseHHMM', () => {
  assert.equal(parseHHMM('07:30'), 450);
  assert.equal(parseHHMM('7:30'), 450);
  assert.equal(parseHHMM('0730'), 450);
  assert.equal(parseHHMM('7'), 420);
  assert.equal(parseHHMM('00:00'), 0);
  assert.throws(() => parseHHMM('25:00'), TypeError);
  assert.throws(() => parseHHMM('half seven'), TypeError);
});

test('parseHours accepts 7.5h, 7h30m and bare minutes', () => {
  assert.equal(parseHours('7.5h'), 450);
  assert.equal(parseHours('7h30m'), 450);
  assert.equal(parseHours('7h 30m'), 450);
  assert.equal(parseHours('450'), 450);
  assert.equal(parseHours('450m'), 450);
  assert.equal(parseHours('7:30'), 450);
  assert.equal(parseHours('8h'), 480);
  assert.equal(parseHours(480), 480);
  assert.throws(() => parseHours('lots'), TypeError);
});

test('circularMeanMinutes works across midnight', () => {
  assert.equal(circularMeanMinutes([1430, 10]), 0);
  // 23:20, 23:40, 00:40 → mean 23:53 (circular), whereas the linear mean would be 15:00.
  assert.equal(circularMeanMinutes([1400, 1420, 40]), 1433);
  assert.equal(circularMeanMinutes([420, 450, 480]), 450, 'plain daytime mean');
  assert.equal(circularMeanMinutes([]), null);
  assert.equal(circularMeanMinutes(undefined), null);
});

test('circularSdMinutes measures spread around the clock', () => {
  assert.equal(circularSdMinutes([1430, 10]), 10);
  assert.equal(circularSdMinutes([450, 450, 450]), 0);
  assert.equal(circularSdMinutes([450]), null);
  const tight = circularSdMinutes([1400, 1410, 1420]);
  const loose = circularSdMinutes([1200, 1410, 120]);
  assert.ok(tight !== null && loose !== null && loose > tight);
});

test('circularDiffMinutes takes the short way round', () => {
  assert.equal(circularDiffMinutes(1430, 10), 20);
  assert.equal(circularDiffMinutes(10, 1430), -20);
  assert.equal(circularDiffMinutes(60, 120), 60);
});

test('localToIso builds an instant from a local wall clock', () => {
  assert.equal(localToIso('2026-09-13', 450, 120), '2026-09-13T05:30:00.000Z');
  assert.equal(localToIso('2026-09-13', 1510, 120), '2026-09-13T23:10:00.000Z', 'past midnight rolls the date');
  assert.equal(localDateString(localToIso('2026-09-13', 1510, 120), 120), '2026-09-14');
});

test('addDays shifts YYYY-MM-DD strings', () => {
  assert.equal(addDays('2026-09-13', 1), '2026-09-14');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
  assert.equal(addDays('2026-01-01', -1), '2025-12-31');
  assert.equal(addDays('2026-09-13', 0), '2026-09-13');
});
