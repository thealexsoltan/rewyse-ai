/**
 * Report-layer tests. Everything is driven by the hand-built fixtures in
 * `test/helpers/reportFixtures.js`, so these never touch the network, the
 * filesystem, the model layer or the clock.
 */

import test from 'node:test';
import assert from 'node:assert/strict';

import { renderTodayTerminal, renderInsightsTerminal } from '../src/report/terminal.js';
import { renderHtmlReport, escapeHtml } from '../src/report/html.js';
import { toJson, toJsonString, minutesToClock } from '../src/report/json.js';
import { makeEnergyDay, makeInsights, makeNights } from './helpers/reportFixtures.js';

const ESC = String.fromCharCode(27);

const ZONE_LABELS = [
  'Grogginess',
  'Morning peak',
  'Afternoon dip',
  'Evening peak',
  'Wind-down',
  'Melatonin window',
  'Sleep',
];
const PLAN_LABELS = ['Deep work', 'Nap', 'Admin', 'Workout', 'Wind down'];

test('fixture EnergyDay matches the shape the renderers rely on', () => {
  const day = makeEnergyDay();
  assert.equal(day.curve.length, 96);
  assert.deepEqual(
    day.zones.map((z) => z.kind),
    [
      'grogginess',
      'morning_peak',
      'afternoon_dip',
      'evening_peak',
      'wind_down',
      'melatonin_window',
      'sleep',
    ],
  );
  assert.equal(day.plan.length, 5);
  assert.ok(day.recovery && Number.isFinite(day.recovery.score));
  assert.ok(day.lastNight && Number.isFinite(day.lastNight.asleepMin));
  for (const point of day.curve) {
    assert.ok(point.energy >= 0 && point.energy <= 100, `energy in range: ${point.energy}`);
  }
});

test('terminal today view: no escape codes when color is false', () => {
  const out = renderTodayTerminal(makeEnergyDay(), { color: false, width: 80 });
  assert.ok(!out.includes(ESC), 'output must contain zero ANSI escape sequences');
  assert.ok(!/\[\d+m/.test(out), 'output must contain no bare ANSI style fragments');
});

test('terminal today view: contains date, zones, plan and target bedtime', () => {
  const day = makeEnergyDay();
  const out = renderTodayTerminal(day, { color: false, width: 100 });

  assert.ok(out.includes('2025-09-13'), 'shows the date');
  assert.ok(out.includes('now 14:20'), 'shows the now marker time');
  assert.ok(out.includes('▼'), 'draws the now marker row');
  assert.ok(out.includes('asleep 6h50'), 'shows last night asleep as h:mm');
  assert.ok(out.includes('efficiency 91%'), 'shows sleep efficiency');
  assert.ok(out.includes('recovery 62'), 'shows the recovery score');
  assert.ok(out.includes('HRV 68 ms'), 'shows HRV');
  assert.ok(out.includes('RHR 54 bpm'), 'shows resting heart rate');
  assert.ok(out.includes('2h15'), 'shows sleep debt as h:mm');
  assert.ok(out.includes('moderate'), 'shows the debt level');

  for (const label of ZONE_LABELS) {
    assert.ok(out.includes(label), `zone label present: ${label}`);
  }
  for (const label of PLAN_LABELS) {
    assert.ok(out.includes(label), `plan activity present: ${label}`);
  }
  assert.ok(out.includes('target bedtime 22:45'), 'shows the target bedtime');
  assert.ok(out.includes('target wake 07:00'), 'shows the target wake time');
});

test('terminal today view: sparkline uses block characters and an hour axis', () => {
  const out = renderTodayTerminal(makeEnergyDay(), { color: false, width: 96 });
  const spark = out.split('\n').find((line) => /^[▁▂▃▄▅▆▇█]+$/.test(line));
  assert.ok(spark, 'a pure block-character sparkline row exists');
  assert.equal(spark.length, 96, 'sparkline fills the requested width');
  // Hour labels every 3 h from wake at 07:00, wrapping past midnight.
  assert.ok(out.includes('07:00'), 'axis starts at wake');
  assert.ok(out.includes('10:00') && out.includes('13:00'), 'axis labels every three hours');
  assert.ok(out.includes('01:00'), 'axis wraps past midnight');

  const narrow = renderTodayTerminal(makeEnergyDay(), { color: false, width: 60 });
  const narrowSpark = narrow.split('\n').find((line) => /^[▁▂▃▄▅▆▇█]+$/.test(line));
  assert.equal(narrowSpark.length, 60, 'sparkline is fitted to a narrower width');
});

test('terminal today view: emits ANSI only when color is true', () => {
  const colored = renderTodayTerminal(makeEnergyDay(), { color: true, width: 80 });
  assert.ok(colored.includes(ESC), 'colour mode emits escape sequences');
  assert.ok(colored.includes(`${ESC}[33m`), 'recovery 62 is rendered yellow (34-66)');
});

test('terminal insights view: plain text, with the whole report body', () => {
  const insights = makeInsights();
  const out = renderInsightsTerminal(insights, { color: false, width: 92 });

  assert.ok(!out.includes(ESC), 'no escape codes without colour');
  assert.ok(out.includes('14 days'), 'window summary');
  assert.ok(out.includes('14 scored nights'), 'night count');
  assert.ok(/Sep\s+\d+\s+[█░ ]+/.test(out), 'per-day bar chart rows');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  for (const day of insights.debt.byDay) {
    // Day numbers are right-aligned in the terminal, so `Sep  9` has two spaces.
    const short = `${months[Number(day.date.slice(5, 7)) - 1]} ${String(Number(day.date.slice(8))).padStart(2, ' ')}`;
    assert.ok(out.includes(short), `a row for ${day.date}`);
  }
  assert.ok(out.includes('bedtime ±47 min'), 'consistency block');
  assert.ok(out.includes('efficiency 90%'), 'quality block');
  assert.ok(out.includes('HRV'), 'HRV block');
  assert.ok(out.includes('RHR'), 'RHR block');
  assert.ok(out.includes('time asleep ↔ next-day recovery'), 'correlations');
  for (const rec of insights.recommendations) {
    assert.ok(out.includes(rec.title), `recommendation present: ${rec.title}`);
  }
  assert.ok(out.includes('1. [high]'), 'recommendations are ranked with impact');
});

test('escapeHtml escapes the five markup-significant characters', () => {
  assert.equal(escapeHtml('a & b < c > d " e \' f'), 'a &amp; b &lt; c &gt; d &quot; e &#39; f');
});

test('html report: complete, self-contained document', () => {
  const energyDay = makeEnergyDay();
  const insights = makeInsights();
  const nights = makeNights();
  const html = renderHtmlReport({
    energyDay,
    insights,
    nights,
    generatedAt: '2025-09-13T12:20:00.000Z',
  });

  assert.ok(html.startsWith('<!doctype html>'), 'starts with a doctype');
  assert.ok(html.includes('<svg'), 'contains inline SVG');
  assert.ok(html.includes('viewBox="0 0 960 260"'), 'energy curve uses the agreed viewBox');
  assert.ok(html.includes('<title>Whoop Energy — 2025-09-13</title>'), 'document title');
  assert.ok(html.includes('prefers-color-scheme: dark'), 'theme-aware CSS');
  assert.ok(html.includes('max-width: 960px'), 'constrained page width');

  // No external assets of any kind (an optional single comment may mention one).
  const withoutComments = html.replace(/<!--[\s\S]*?-->/g, '');
  assert.ok(!withoutComments.includes('http'), 'no external URLs anywhere in the document');
  assert.ok(!/<link\b/i.test(html) && !/<img\b/i.test(html), 'no linked stylesheets or images');
  assert.ok(!/src\s*=/.test(html), 'no script or asset src attributes');

  assert.ok(Buffer.byteLength(html, 'utf8') < 200 * 1024, 'document stays under 200 KB');
});

test('html report: escapes recommendation titles containing < and &', () => {
  const insights = makeInsights();
  const risky = insights.recommendations.find((r) => r.title.includes('&') && r.title.includes('<'));
  assert.ok(risky, 'fixture carries a title with < and &');

  const html = renderHtmlReport({
    energyDay: makeEnergyDay(),
    insights,
    nights: makeNights(),
    generatedAt: '2025-09-13T12:20:00.000Z',
  });

  assert.ok(html.includes(escapeHtml(risky.title)), 'escaped title is present');
  assert.ok(!html.includes(risky.title), 'raw unescaped title is absent');
  assert.ok(html.includes('Screens &amp; light: keep evening exposure &lt; 50 lux'), 'exact escaping');
});

test('html report: renders zones, plan, debt bars and trends', () => {
  const html = renderHtmlReport({
    energyDay: makeEnergyDay(),
    insights: makeInsights(),
    nights: makeNights(),
  });
  for (const label of ZONE_LABELS) {
    assert.ok(html.includes(escapeHtml(label)), `zone label rendered: ${label}`);
  }
  for (const label of PLAN_LABELS) {
    assert.ok(html.includes(label), `plan activity rendered: ${label}`);
  }
  assert.ok(html.includes('viewBox="0 0 960 240"'), 'sleep vs need chart');
  assert.ok(html.includes('Recovery, HRV and resting heart rate'), 'per-night mini sparklines');
  assert.ok(html.includes('class="bar bar-short"') || html.includes('bar bar-short'), 'shortfall bars highlighted');
  assert.ok(html.includes('nowline'), 'now marker on the curve');
  assert.ok(html.includes('bed 22:45'), 'target bedtime marked');
  assert.ok(html.includes('melatonin'), 'melatonin window marked');
});

test('html report: readable without JavaScript', () => {
  const html = renderHtmlReport({ energyDay: makeEnergyDay(), insights: makeInsights() });
  const body = html.slice(html.indexOf('<body>'));
  const withoutScript = body.replace(/<script>[\s\S]*?<\/script>/g, '');
  assert.ok(withoutScript.includes('Energy through the day'), 'sections survive without script');
  assert.ok(withoutScript.includes('<svg'), 'charts are static SVG, not script-drawn');
  assert.ok(withoutScript.includes('Sleep debt'), 'stat tiles are static markup');
});

test('minutesToClock wraps past midnight', () => {
  assert.equal(minutesToClock(0), '00:00');
  assert.equal(minutesToClock(420), '07:00');
  assert.equal(minutesToClock(1365), '22:45');
  assert.equal(minutesToClock(1500), '01:00');
  assert.equal(minutesToClock(1860), '07:00');
  assert.equal(minutesToClock(null), null);
});

test('json envelope: round-trips and carries clock strings', () => {
  const energyDay = makeEnergyDay();
  const insights = makeInsights();
  const nights = makeNights();

  const text = toJsonString({ energyDay, insights, nights, generatedAt: '2025-09-13T12:20:00.000Z' });
  const parsed = JSON.parse(text);

  assert.equal(parsed.schemaVersion, 1);
  assert.equal(parsed.generatedAt, '2025-09-13T12:20:00.000Z');
  assert.equal(parsed.energyDay.date, '2025-09-13');
  assert.equal(parsed.nights.length, 14);

  assert.equal(parsed.energyDay.zones.length, 7);
  for (const zone of parsed.energyDay.zones) {
    assert.match(zone.startClock, /^\d{2}:\d{2}$/);
    assert.match(zone.endClock, /^\d{2}:\d{2}$/);
  }
  assert.equal(parsed.energyDay.zones[0].startClock, '07:00');
  assert.equal(parsed.energyDay.zones[6].startClock, '22:45');
  assert.equal(parsed.energyDay.zones[6].endClock, '07:00');

  for (const entry of parsed.energyDay.plan) {
    assert.match(entry.startClock, /^\d{2}:\d{2}$/);
    assert.match(entry.endClock, /^\d{2}:\d{2}$/);
  }
  assert.equal(parsed.energyDay.plan[0].startClock, '08:30');
  assert.equal(parsed.energyDay.targetBedtimeClock, '22:45');
  assert.equal(parsed.energyDay.nowClock, '14:20');
  assert.deepEqual(parsed.insights.debt.byDay.length, 14);
});

test('json envelope: never mutates its inputs', () => {
  const energyDay = makeEnergyDay();
  const before = JSON.stringify(energyDay);
  const envelope = toJson({ energyDay, insights: makeInsights(), nights: makeNights() });

  assert.equal(JSON.stringify(energyDay), before, 'input object untouched');
  assert.equal(energyDay.zones[0].startClock, undefined, 'no clock strings leaked onto the input');
  assert.equal(envelope.energyDay.zones[0].startClock, '07:00', 'copy carries the clock string');
  assert.notEqual(envelope.energyDay.zones[0], energyDay.zones[0], 'zones are copies');
});

test('json envelope: defaults generatedAt and tolerates missing pieces', () => {
  const envelope = toJson({ energyDay: makeEnergyDay() });
  assert.match(envelope.generatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.equal(envelope.insights, null);
  assert.deepEqual(envelope.nights, []);
});
