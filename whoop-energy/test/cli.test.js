/**
 * @file End-to-end smoke tests for `bin/whoop-energy.js`.
 *
 * These spawn the real CLI as a child process in `--demo` mode, so they cover
 * the wiring between the CLI, the model and the report modules — the contract
 * at the top of `bin/whoop-energy.js`. No network, no credentials, no state
 * outside a per-run temp directory.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(HERE, '..', 'bin', 'whoop-energy.js');

/** A scratch directory that never touches the user's real ~/.whoop-energy. */
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'whoop-energy-cli-'));
test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

/**
 * Run the CLI with a throwaway data directory.
 *
 * @param {string[]} args
 * @returns {{status: number, stdout: string, stderr: string}}
 */
function run(args) {
  const res = spawnSync(process.execPath, [CLI, ...args, '--data-dir', path.join(TMP, 'data')], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(res.error, undefined, `spawn failed: ${res.error}`);
  return { status: res.status ?? -1, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
}

// ---------------------------------------------------------------------------
// today
// ---------------------------------------------------------------------------

test('today --demo prints a terminal schedule', () => {
  const { status, stdout } = run(['today', '--demo']);
  assert.equal(status, 0);
  assert.ok(stdout.length > 500, 'non-empty report');
  for (const needle of ['Whoop Energy', 'Sleep debt', 'Zones', 'Your day', 'target bedtime']) {
    assert.ok(stdout.includes(needle), `mentions ${needle}`);
  }
});

test('today --demo --format json emits a parseable envelope', () => {
  const { status, stdout } = run(['today', '--demo', '--format', 'json']);
  assert.equal(status, 0);
  const json = JSON.parse(stdout);
  assert.equal(json.insights, null, 'today alone carries no insights');
  const day = json.energyDay;
  assert.ok(day, 'energyDay present');
  assert.equal(day.curve.length, 96);
  assert.ok(day.zones.length >= 6 && day.plan.length >= 3);
  assert.ok(Array.isArray(json.nights) && json.nights.length > 0);
});

test('today --demo --format html writes a self-contained document', () => {
  const out = path.join(TMP, 'today.html');
  const { status } = run(['today', '--demo', '--format', 'html', '--out', out]);
  assert.equal(status, 0);
  const html = fs.readFileSync(out, 'utf8');
  assert.ok(html.length > 5000);
  assert.ok(html.startsWith('<!DOCTYPE html>') || html.startsWith('<!doctype html>'));
  assert.ok(!/<(script|img|link)[^>]+src=["']https?:/i.test(html), 'no external assets');
});

test('today --demo --now moves the "now" marker', () => {
  const { status, stdout } = run(['today', '--demo', '--now', '14:30']);
  assert.equal(status, 0);
  assert.ok(stdout.includes('14:30'), 'the overridden clock is shown');
});

test('today --demo --need overrides sleep need', () => {
  const a = JSON.parse(run(['today', '--demo', '--format', 'json', '--need', '7h30m']).stdout);
  assert.equal(a.energyDay.need.baselineMin, 450);
  const b = JSON.parse(run(['today', '--demo', '--format', 'json', '--need', '9h']).stdout);
  assert.equal(b.energyDay.need.baselineMin, 540);
  assert.ok(b.energyDay.debt.hours > a.energyDay.debt.hours, 'a bigger need means more debt');
});

test('a sleeper carrying debt is sent to bed earlier than habitual', () => {
  // Regression: the DLMO floor used to cancel the payback outright, so the
  // report said "severe debt" next to an unchanged bedtime.
  const { energyDay } = JSON.parse(run(['today', '--demo', '--format', 'json']).stdout);
  assert.ok(energyDay.debt.hours > 1, 'the demo sleeper owes sleep');
  const habitual = energyDay.anchors.habitualBedtimeMin;
  const target = energyDay.targetBedtimeMin;
  const advance = ((habitual - target) % 1440 + 1440) % 1440;
  // 45 min cap, plus the 5-minute rounding grid.
  assert.ok(advance >= 15 && advance <= 50, `bedtime advanced by ${advance} min`);
});

// ---------------------------------------------------------------------------
// insights
// ---------------------------------------------------------------------------

test('insights --demo prints stats and recommendations', () => {
  const { status, stdout } = run(['insights', '--demo']);
  assert.equal(status, 0);
  for (const needle of ['Sleep debt', 'Sleep vs need', 'Consistency', 'What to optimize']) {
    assert.ok(stdout.includes(needle), `mentions ${needle}`);
  }
  assert.ok(/sleep debt/i.test(stdout), 'the demo sleeper is told to pay down debt');
});

test('insights --demo --format json is parseable and signs shortfalls consistently', () => {
  const { status, stdout } = run(['insights', '--demo', '--format', 'json']);
  assert.equal(status, 0);
  const { insights, energyDay } = JSON.parse(stdout);
  assert.equal(energyDay, null);
  assert.equal(insights.windowDays, 14);
  assert.ok(insights.recommendations.length >= 1);
  for (const row of insights.debt.byDay) {
    // deltaMin is need − asleep, so a short night is positive.
    assert.equal(row.deltaMin, row.needMin - row.asleepMin);
  }
  const short = insights.debt.byDay.find((r) => r.asleepMin < r.needMin);
  assert.ok(short && short.deltaMin > 0, 'a short night has a positive deltaMin');
});

// ---------------------------------------------------------------------------
// report
// ---------------------------------------------------------------------------

test('report --demo writes HTML and can also emit JSON', () => {
  const out = path.join(TMP, 'report.html');
  const html = run(['report', '--demo', '--out', out]);
  assert.equal(html.status, 0);
  const doc = fs.readFileSync(out, 'utf8');
  assert.ok(doc.includes('Sleep vs need') && doc.includes('What to optimize'));

  const json = run(['report', '--demo', '--format', 'json']);
  assert.equal(json.status, 0);
  const parsed = JSON.parse(json.stdout);
  assert.ok(parsed.energyDay && parsed.insights, 'report carries both halves');
});

// ---------------------------------------------------------------------------
// status, sync, auth, usage
// ---------------------------------------------------------------------------

test('status --demo reports the fixture window without touching credentials', () => {
  const { status, stdout } = run(['status', '--demo']);
  assert.equal(status, 0);
  assert.ok(stdout.includes('demo'));
  assert.ok(/Nights:\s+\d+/.test(stdout));
});

test('sync and auth are no-ops under --demo', () => {
  for (const cmd of ['sync', 'auth']) {
    const { status } = run([cmd, '--demo']);
    assert.equal(status, 0, `${cmd} --demo exits 0`);
  }
});

test('status without credentials explains itself and still exits 0', () => {
  const res = spawnSync(process.execPath, [CLI, 'status', '--data-dir', path.join(TMP, 'empty')], {
    encoding: 'utf8',
    env: { ...process.env, WHOOP_CLIENT_ID: '', WHOOP_CLIENT_SECRET: '' },
  });
  assert.equal(res.status, 0);
  assert.ok(/Authenticated:\s+no/.test(res.stdout), 'says it is not authenticated');
});

test('a data command without credentials exits 3 with advice', () => {
  const res = spawnSync(
    process.execPath,
    [CLI, 'insights', '--data-dir', path.join(TMP, 'empty')],
    { encoding: 'utf8', env: { ...process.env, WHOOP_CLIENT_ID: '', WHOOP_CLIENT_SECRET: '' } },
  );
  assert.equal(res.status, 3);
  assert.ok(/--demo/.test(res.stderr), 'points at demo mode');
});

test('--help exits 0 and lists every command', () => {
  const { status, stdout } = run(['--help']);
  assert.equal(status, 0);
  for (const cmd of ['auth', 'sync', 'today', 'insights', 'report', 'status']) {
    assert.ok(stdout.includes(cmd), `help mentions ${cmd}`);
  }
});

test('an unknown command exits 2', () => {
  const { status, stderr } = run(['definitely-not-a-command']);
  assert.equal(status, 2);
  assert.ok(stderr.includes('Unknown command'));
});

test('an unknown --format exits 2', () => {
  const { status } = run(['today', '--demo', '--format', 'pdf']);
  assert.equal(status, 2);
});

test('no command at all exits 2 with the usage text', () => {
  const { status, stdout } = run([]);
  assert.equal(status, 2);
  assert.ok(stdout.includes('Usage:'));
});
