#!/usr/bin/env node
/**
 * @file whoop-energy CLI — argument parsing and command dispatch.
 *
 * ---------------------------------------------------------------------------
 * CONTRACT WITH THE MODEL / REPORT MODULES
 * ---------------------------------------------------------------------------
 * These modules are imported **lazily** (dynamic `import()` inside the command
 * handlers) so that this file loads even while they are still being written.
 * The exports this CLI expects:
 *
 *   src/model/sleepDebt.js
 *     computeSleepNeed(nights: SleepNight[], opts?: { overrideMin?: number|null }): number
 *     computeSleepDebt(nights: SleepNight[], needMin: number): DebtSummary
 *
 *   src/model/circadian.js
 *     buildEnergyDay(opts: {
 *       nights: SleepNight[], needMin: number, nowMin: number|null,
 *       tzOffsetMin: number, date: string
 *     }): EnergyDay
 *
 *   src/model/zones.js
 *     (used internally by circadian.js — never imported here)
 *
 *   src/model/insights.js
 *     computeInsights(nights: SleepNight[], opts?: { windowDays?: number, needMin?: number }): Insights
 *
 *   src/report/terminal.js
 *     renderTodayTerminal(energyDay: EnergyDay): string
 *     renderInsightsTerminal(insights: Insights): string
 *
 *   src/report/html.js
 *     renderHtmlReport(opts: { energyDay: EnergyDay, insights: Insights, nights: SleepNight[] }): string
 *
 *   src/report/json.js
 *     toJson(opts: { energyDay?: EnergyDay|null, insights?: Insights|null, nights?: SleepNight[] }): object
 *
 * Types are the JSDoc typedefs in src/model/types.js (PLAN.md §4).
 * ---------------------------------------------------------------------------
 *
 * Exit codes: 0 ok, 2 usage, 3 not authenticated, 4 API error.
 */

import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';

import { loadConfig, loadSettings, ensureDataDir } from '../src/config.js';
import { parseHHMM, parseHours, parseTzOffset, localDateString } from '../src/time.js';
import { createClient, WhoopApiError } from '../src/whoop/client.js';
import {
  AuthError,
  runAuthFlow,
  refreshTokens,
  getValidAccessToken,
  authStatus,
} from '../src/whoop/auth.js';
import {
  syncWhoop,
  loadCache,
  isCacheStale,
  cacheAgeHours,
  fetchProfile,
  DEFAULT_SYNC_DAYS,
  DEFAULT_MAX_CACHE_AGE_HOURS,
} from '../src/whoop/sync.js';
import { normalizeNights } from '../src/model/normalize.js';
import { makeDemoData } from '../src/demo/fixtures.js';

/** CLI exit codes. */
export const EXIT = Object.freeze({ OK: 0, USAGE: 2, NOT_AUTHENTICATED: 3, API_ERROR: 4 });

/** Commands accepted by the CLI. */
export const COMMANDS = Object.freeze(['auth', 'sync', 'today', 'insights', 'report', 'status']);

/** Default insights window, in days. */
export const DEFAULT_INSIGHTS_DAYS = 14;
/** Default output file for `report`. */
export const DEFAULT_REPORT_FILE = 'whoop-energy-report.html';

const OPTION_SPEC = {
  demo: { type: 'boolean', default: false },
  'data-dir': { type: 'string' },
  tz: { type: 'string' },
  quiet: { type: 'boolean', default: false },
  offline: { type: 'boolean', default: false },
  now: { type: 'string' },
  need: { type: 'string' },
  days: { type: 'string' },
  format: { type: 'string' },
  out: { type: 'string' },
  help: { type: 'boolean', short: 'h', default: false },
  version: { type: 'boolean', short: 'v', default: false },
};

const USAGE = `whoop-energy — a Rise-style circadian energy schedule from your WHOOP data

Usage:
  whoop-energy <command> [options]

Commands:
  auth                     Start the WHOOP OAuth flow (prints a URL, waits for the callback)
  sync [--days 30]         Fetch sleep / recovery / cycle records and cache them
  today                    Today's energy curve, zones and day plan
  insights [--days 14]     Sleep debt, consistency, trends and ranked recommendations
  report [--out FILE]      Full self-contained HTML report
  status                   Auth state, token expiry, cache freshness, profile name

Options:
  --demo                   Use deterministic synthetic data (no credentials, no network)
  --data-dir PATH          Override the data directory (default: $WHOOP_ENERGY_HOME or ~/.whoop-energy)
  --tz +02:00              Force a timezone offset instead of the one in the records
                           (negative offsets need the = form: --tz=-05:00)
  --now HH:MM              Pretend it is this local time
  --need 7.5h              Override sleep need (accepts 7.5h, 7h30m, 450)
  --days N                 Window size (sync: days to fetch; insights: days to analyse)
  --format terminal|json|html
  --out FILE               Write output to a file instead of stdout
  --offline                Never hit the network; use whatever is cached
  --quiet                  Suppress progress messages
  -h, --help               Show this help
  -v, --version            Show the version

Exit codes: 0 ok, 2 usage error, 3 not authenticated, 4 API error.`;

/**
 * A usage error (exit code 2).
 */
class UsageError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'UsageError';
    this.code = EXIT.USAGE;
  }
}

/**
 * Raised when a model/report module has not been written yet.
 */
class MissingModuleError extends Error {
  /** @param {string} specifier */
  constructor(specifier) {
    super(
      `Module not available yet: ${specifier}\n` +
        'This build is incomplete — see the CONTRACT block at the top of bin/whoop-energy.js.',
    );
    this.name = 'MissingModuleError';
    this.specifier = specifier;
  }
}

/**
 * Import a module that another agent may not have written yet, turning
 * `ERR_MODULE_NOT_FOUND` into a readable message.
 *
 * @param {string} specifier relative to this file
 * @returns {Promise<any>}
 */
async function lazyImport(specifier) {
  try {
    return await import(specifier);
  } catch (err) {
    if (err && (err.code === 'ERR_MODULE_NOT_FOUND' || err.code === 'MODULE_NOT_FOUND')) {
      throw new MissingModuleError(specifier);
    }
    throw err;
  }
}

/**
 * Parse argv into `{ command, values }`.
 *
 * @param {string[]} argv usually `process.argv.slice(2)`
 * @returns {{ command: string|null, values: Record<string, any>, positionals: string[] }}
 */
export function parseCli(argv) {
  let parsed;
  try {
    parsed = parseArgs({ args: argv, options: OPTION_SPEC, allowPositionals: true, strict: true });
  } catch (err) {
    throw new UsageError(`${err.message}\n\n${USAGE}`);
  }
  const [command = null, ...rest] = parsed.positionals;
  if (command !== null && !COMMANDS.includes(command)) {
    throw new UsageError(`Unknown command: ${command}\n\n${USAGE}`);
  }
  if (rest.length > 0) throw new UsageError(`Unexpected argument: ${rest[0]}\n\n${USAGE}`);
  return { command, values: parsed.values, positionals: parsed.positionals };
}

/**
 * Resolve every derived option once, so command handlers stay small.
 *
 * @param {Record<string, any>} values
 * @returns {{
 *   demo: boolean, quiet: boolean, offline: boolean, format: string|undefined,
 *   out: string|undefined, days: number|undefined, needOverrideMin: number|null,
 *   tzOverrideMin: number|null, nowOverrideMin: number|null, dataDir: string|undefined
 * }}
 */
export function resolveOptions(values) {
  /** @type {number|undefined} */
  let days;
  if (values.days !== undefined) {
    days = Number(values.days);
    if (!Number.isFinite(days) || days <= 0) throw new UsageError(`--days must be a positive number, got "${values.days}"`);
    days = Math.floor(days);
  }
  /** @type {number|null} */
  let needOverrideMin = null;
  if (values.need !== undefined) {
    try {
      needOverrideMin = parseHours(values.need);
    } catch (err) {
      throw new UsageError(`--need: ${err.message}`);
    }
  }
  /** @type {number|null} */
  let tzOverrideMin = null;
  if (values.tz !== undefined) {
    const parsedTz = parseTzOffset(values.tz, NaN);
    if (!Number.isFinite(parsedTz)) throw new UsageError(`--tz must look like +02:00, got "${values.tz}"`);
    tzOverrideMin = parsedTz;
  }
  /** @type {number|null} */
  let nowOverrideMin = null;
  if (values.now !== undefined) {
    try {
      nowOverrideMin = parseHHMM(values.now);
    } catch (err) {
      throw new UsageError(`--now: ${err.message}`);
    }
  }
  return {
    demo: Boolean(values.demo),
    quiet: Boolean(values.quiet),
    offline: Boolean(values.offline),
    format: values.format,
    out: values.out,
    days,
    needOverrideMin,
    tzOverrideMin,
    nowOverrideMin,
    dataDir: values['data-dir'],
  };
}

/**
 * Validate `--format` against what a command supports.
 *
 * @param {string|undefined} format
 * @param {string[]} allowed
 * @param {string} fallback
 * @returns {string}
 */
function pickFormat(format, allowed, fallback) {
  if (format === undefined) return fallback;
  if (!allowed.includes(format)) {
    throw new UsageError(`--format must be one of ${allowed.join('|')}, got "${format}"`);
  }
  return format;
}

/**
 * Build an authenticated WHOOP API client.
 *
 * @param {ReturnType<typeof loadConfig>} config
 * @returns {ReturnType<typeof createClient>}
 */
function makeApiClient(config) {
  return createClient({
    baseUrl: config.apiBase,
    getToken: () => getValidAccessToken({ config }),
    refresh: () => refreshTokens({ config }),
  });
}

/**
 * Load raw WHOOP data, from fixtures in `--demo` mode or from the cache
 * (auto-syncing when it is stale and the network is allowed).
 *
 * @param {Object} ctx
 * @param {ReturnType<typeof resolveOptions>} ctx.opts
 * @param {ReturnType<typeof loadConfig>} ctx.config
 * @param {(msg: string) => void} ctx.log
 * @param {boolean} [ctx.autoSync=true]
 * @returns {Promise<{ raw: {sleep: any[], recovery: any[], cycle: any[]}, source: string, fetchedAt: string|null }>}
 */
async function loadRaw({ opts, config, log, autoSync = true }) {
  if (opts.demo) {
    const tz = opts.tzOverrideMin === null ? '+02:00' : opts.tzOverrideMin;
    return { raw: makeDemoData({ tzOffset: tz }), source: 'demo', fetchedAt: new Date().toISOString() };
  }
  let cache = loadCache(config.dataDir);
  const stale = isCacheStale(cache, DEFAULT_MAX_CACHE_AGE_HOURS);
  if (autoSync && stale && !opts.offline) {
    log(cache ? 'Cache is stale — syncing…' : 'No cache yet — syncing…');
    cache = await syncWhoop({
      client: makeApiClient(config),
      days: opts.days ?? DEFAULT_SYNC_DAYS,
      dataDir: config.dataDir,
    });
  }
  if (!cache) {
    throw new AuthError(
      opts.offline
        ? 'No cached data and --offline was given. Run `whoop-energy sync` first, or try --demo.'
        : 'No cached data. Run `whoop-energy auth` then `whoop-energy sync`, or try --demo.',
      { code: EXIT.NOT_AUTHENTICATED },
    );
  }
  return { raw: cache, source: 'cache', fetchedAt: cache.fetchedAt ?? null };
}

/**
 * Turn raw records into nights plus the derived time context.
 *
 * @param {Object} ctx
 * @param {{sleep: any[], recovery: any[], cycle: any[]}} ctx.raw
 * @param {ReturnType<typeof resolveOptions>} ctx.opts
 * @param {ReturnType<typeof loadConfig>} ctx.config
 * @returns {{ nights: import('../src/model/types.js').SleepNight[], tzOffsetMin: number, nowMin: number, date: string, needOverrideMin: number|null }}
 */
function buildContext({ raw, opts, config }) {
  const nights = normalizeNights(raw, opts.tzOverrideMin === null ? {} : { tzOffsetMin: opts.tzOverrideMin });
  const lastNight = nights[nights.length - 1];
  const tzOffsetMin = opts.tzOverrideMin ?? lastNight?.tzOffsetMin ?? 0;
  const now = new Date();
  const date = localDateString(now, tzOffsetMin);
  const clockMin = (() => {
    const shiftedMs = now.getTime() + tzOffsetMin * 60000;
    const d = new Date(shiftedMs);
    return d.getUTCHours() * 60 + d.getUTCMinutes();
  })();
  const settings = opts.demo ? {} : loadSettings(config.dataDir);
  const settingsNeedMin = Number.isFinite(Number(settings.needMin)) ? Number(settings.needMin) : null;
  return {
    nights,
    tzOffsetMin,
    nowMin: opts.nowOverrideMin ?? clockMin,
    date,
    needOverrideMin: opts.needOverrideMin ?? settingsNeedMin,
  };
}

/**
 * Build the `EnergyDay` for today (or `--now`).
 *
 * @param {ReturnType<typeof buildContext>} ctx
 * @returns {Promise<{ energyDay: any, needMin: number }>}
 */
async function buildToday(ctx) {
  const { computeSleepNeed } = await lazyImport('../src/model/sleepDebt.js');
  const { buildEnergyDay } = await lazyImport('../src/model/circadian.js');
  const needMin = computeSleepNeed(ctx.nights, { overrideMin: ctx.needOverrideMin });
  const energyDay = buildEnergyDay({
    nights: ctx.nights,
    needMin,
    nowMin: ctx.nowMin,
    tzOffsetMin: ctx.tzOffsetMin,
    date: ctx.date,
  });
  return { energyDay, needMin };
}

/**
 * Write a string to `--out` or stdout.
 *
 * @param {string} text
 * @param {string|undefined} out
 * @param {(msg: string) => void} log
 */
function emit(text, out, log) {
  if (out) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.writeFileSync(path.resolve(out), text.endsWith('\n') ? text : `${text}\n`, 'utf8');
    log(`Wrote ${path.resolve(out)}`);
    return;
  }
  process.stdout.write(text.endsWith('\n') ? text : `${text}\n`);
}

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

/** @param {{opts: any, config: any, log: (m:string)=>void}} ctx */
async function cmdAuth({ opts, config, log }) {
  if (opts.demo) {
    log('--demo needs no credentials; nothing to authorize.');
    return EXIT.OK;
  }
  await runAuthFlow({ config, log });
  return EXIT.OK;
}

/** @param {{opts: any, config: any, log: (m:string)=>void}} ctx */
async function cmdSync({ opts, config, log }) {
  if (opts.demo) {
    log('--demo uses in-memory fixtures; nothing to sync.');
    return EXIT.OK;
  }
  if (opts.offline) throw new UsageError('`sync` cannot run with --offline.');
  ensureDataDir(config.dataDir);
  const days = opts.days ?? DEFAULT_SYNC_DAYS;
  log(`Fetching the last ${days} days from WHOOP…`);
  const cache = await syncWhoop({ client: makeApiClient(config), days, dataDir: config.dataDir });
  log(
    `Synced ${cache.sleep.length} sleep, ${cache.recovery.length} recovery and ${cache.cycle.length} cycle records ` +
      `→ ${path.join(config.dataDir, 'cache.json')}`,
  );
  return EXIT.OK;
}

/** @param {{opts: any, config: any, log: (m:string)=>void}} ctx */
async function cmdToday({ opts, config, log }) {
  const format = pickFormat(opts.format, ['terminal', 'json', 'html'], 'terminal');
  const { raw } = await loadRaw({ opts, config, log });
  const ctx = buildContext({ raw, opts, config });
  const { energyDay, needMin } = await buildToday(ctx);

  if (format === 'terminal') {
    const { renderTodayTerminal } = await lazyImport('../src/report/terminal.js');
    emit(renderTodayTerminal(energyDay), opts.out, log);
    return EXIT.OK;
  }
  if (format === 'json') {
    const { toJson } = await lazyImport('../src/report/json.js');
    emit(JSON.stringify(toJson({ energyDay, insights: null, nights: ctx.nights }), null, 2), opts.out, log);
    return EXIT.OK;
  }
  const { computeInsights } = await lazyImport('../src/model/insights.js');
  const { renderHtmlReport } = await lazyImport('../src/report/html.js');
  const insights = computeInsights(ctx.nights, { windowDays: opts.days ?? DEFAULT_INSIGHTS_DAYS, needMin });
  emit(renderHtmlReport({ energyDay, insights, nights: ctx.nights }), opts.out, log);
  return EXIT.OK;
}

/** @param {{opts: any, config: any, log: (m:string)=>void}} ctx */
async function cmdInsights({ opts, config, log }) {
  const format = pickFormat(opts.format, ['terminal', 'json'], 'terminal');
  const { raw } = await loadRaw({ opts, config, log, autoSync: false });
  const ctx = buildContext({ raw, opts, config });
  const { computeSleepNeed } = await lazyImport('../src/model/sleepDebt.js');
  const { computeInsights } = await lazyImport('../src/model/insights.js');
  const needMin = computeSleepNeed(ctx.nights, { overrideMin: ctx.needOverrideMin });
  const insights = computeInsights(ctx.nights, { windowDays: opts.days ?? DEFAULT_INSIGHTS_DAYS, needMin });

  if (format === 'json') {
    const { toJson } = await lazyImport('../src/report/json.js');
    emit(JSON.stringify(toJson({ energyDay: null, insights, nights: ctx.nights }), null, 2), opts.out, log);
    return EXIT.OK;
  }
  const { renderInsightsTerminal } = await lazyImport('../src/report/terminal.js');
  emit(renderInsightsTerminal(insights), opts.out, log);
  return EXIT.OK;
}

/** @param {{opts: any, config: any, log: (m:string)=>void}} ctx */
async function cmdReport({ opts, config, log }) {
  const format = pickFormat(opts.format, ['html', 'json'], 'html');
  const { raw } = await loadRaw({ opts, config, log });
  const ctx = buildContext({ raw, opts, config });
  const { energyDay, needMin } = await buildToday(ctx);
  const { computeInsights } = await lazyImport('../src/model/insights.js');
  const insights = computeInsights(ctx.nights, { windowDays: opts.days ?? DEFAULT_INSIGHTS_DAYS, needMin });

  if (format === 'json') {
    const { toJson } = await lazyImport('../src/report/json.js');
    emit(JSON.stringify(toJson({ energyDay, insights, nights: ctx.nights }), null, 2), opts.out, log);
    return EXIT.OK;
  }
  const { renderHtmlReport } = await lazyImport('../src/report/html.js');
  emit(renderHtmlReport({ energyDay, insights, nights: ctx.nights }), opts.out ?? DEFAULT_REPORT_FILE, log);
  return EXIT.OK;
}

/** @param {{opts: any, config: any, log: (m:string)=>void}} ctx */
async function cmdStatus({ opts, config, log }) {
  const format = pickFormat(opts.format, ['terminal', 'json'], 'terminal');
  const lines = [];
  /** @type {Record<string, any>} */
  const data = { mode: opts.demo ? 'demo' : 'live', dataDir: config.dataDir };

  if (opts.demo) {
    const raw = makeDemoData({ tzOffset: opts.tzOverrideMin === null ? '+02:00' : opts.tzOverrideMin });
    const nights = normalizeNights(raw);
    data.demo = { nights: nights.length, first: nights[0]?.date ?? null, last: nights.at(-1)?.date ?? null };
    lines.push('Mode:      demo (deterministic fixtures, no credentials used)');
    lines.push(`Nights:    ${data.demo.nights} (${data.demo.first} → ${data.demo.last})`);
    lines.push(`Data dir:  ${config.dataDir}`);
  } else {
    const auth = authStatus(config);
    data.auth = auth;
    lines.push(`Data dir:      ${config.dataDir}`);
    lines.push(`Credentials:   ${auth.hasCredentials ? 'WHOOP_CLIENT_ID/SECRET present' : 'MISSING — see .env.example'}`);
    lines.push(`Authenticated: ${auth.authenticated ? 'yes' : 'no (run `whoop-energy auth`)'}`);
    if (auth.authenticated) {
      const mins = auth.expiresInSec === null ? null : Math.round(auth.expiresInSec / 60);
      lines.push(
        `Token:         ${auth.expired ? 'EXPIRED' : 'valid'}` +
          (auth.expiresAt ? ` — expires ${auth.expiresAt}${mins === null ? '' : ` (${mins} min)`}` : ''),
      );
      if (auth.scope) lines.push(`Scopes:        ${auth.scope}`);
    }

    const cache = loadCache(config.dataDir);
    const ageH = cacheAgeHours(cache);
    data.cache = cache
      ? { fetchedAt: cache.fetchedAt, days: cache.days, ageHours: ageH, stale: isCacheStale(cache), sleep: cache.sleep.length, recovery: cache.recovery.length, cycle: cache.cycle.length }
      : null;
    lines.push(
      cache
        ? `Cache:         ${cache.sleep.length} sleep / ${cache.recovery.length} recovery / ${cache.cycle.length} cycle, ` +
          `${ageH === null ? 'unknown age' : `${ageH}h old`}${isCacheStale(cache) ? ' (stale)' : ''}`
        : 'Cache:         none — run `whoop-energy sync`',
    );

    if (auth.authenticated && !opts.offline) {
      try {
        const profile = await fetchProfile(makeApiClient(config));
        const name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ');
        data.profile = profile ?? null;
        lines.push(`Profile:       ${name || '(unnamed)'}${profile?.email ? ` <${profile.email}>` : ''}`);
      } catch (err) {
        data.profileError = String(err?.message ?? err);
        lines.push(`Profile:       unavailable (${err?.message ?? err})`);
      }
    } else if (opts.offline) {
      lines.push('Profile:       skipped (--offline)');
    }
  }

  if (format === 'json') emit(JSON.stringify(data, null, 2), opts.out, log);
  else emit(lines.join('\n'), opts.out, log);
  return EXIT.OK;
}

/** @type {Record<string, (ctx: any) => Promise<number>>} */
const HANDLERS = {
  auth: cmdAuth,
  sync: cmdSync,
  today: cmdToday,
  insights: cmdInsights,
  report: cmdReport,
  status: cmdStatus,
};

/**
 * Run the CLI.
 *
 * @param {string[]} [argv=process.argv.slice(2)]
 * @returns {Promise<number>} process exit code
 */
export async function main(argv = process.argv.slice(2)) {
  /** @type {ReturnType<typeof parseCli>} */
  let cli;
  try {
    cli = parseCli(argv);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return EXIT.USAGE;
  }

  if (cli.values.version) {
    process.stdout.write('whoop-energy 0.1.0\n');
    return EXIT.OK;
  }
  if (cli.values.help || cli.command === null) {
    process.stdout.write(`${USAGE}\n`);
    return cli.command === null && !cli.values.help ? EXIT.USAGE : EXIT.OK;
  }

  /** @type {ReturnType<typeof resolveOptions>} */
  let opts;
  try {
    opts = resolveOptions(cli.values);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    return EXIT.USAGE;
  }

  const log = opts.quiet ? () => {} : (/** @type {string} */ m) => process.stderr.write(`${m}\n`);
  const config = loadConfig({ dataDir: opts.dataDir });

  try {
    return await HANDLERS[cli.command]({ opts, config, log });
  } catch (err) {
    if (err instanceof UsageError) {
      process.stderr.write(`${err.message}\n`);
      return EXIT.USAGE;
    }
    if (err instanceof AuthError) {
      process.stderr.write(`${err.message}\n`);
      return err.code ?? EXIT.NOT_AUTHENTICATED;
    }
    if (err instanceof MissingModuleError) {
      process.stderr.write(`${err.message}\n`);
      return EXIT.API_ERROR;
    }
    if (err instanceof WhoopApiError) {
      process.stderr.write(`${err.message}\n`);
      return err.status === 401 ? EXIT.NOT_AUTHENTICATED : EXIT.API_ERROR;
    }
    process.stderr.write(`${err?.stack ?? err?.message ?? err}\n`);
    return EXIT.API_ERROR;
  }
}

// Only run when executed directly, so tests can import `main`.
const invokedDirectly =
  process.argv[1] && (await import('node:url')).fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  process.exitCode = await main();
}

export { USAGE, UsageError, MissingModuleError };
