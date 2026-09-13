/**
 * @file Environment + filesystem configuration for whoop-energy.
 *
 * Zero dependencies: a tiny KEY=VALUE `.env` parser, plus path helpers for the
 * data directory that holds `tokens.json`, `cache.json` and `settings.json`.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

/** Directory mode for the data dir (owner-only). */
export const DATA_DIR_MODE = 0o700;
/** File mode for secrets (tokens.json). */
export const SECRET_FILE_MODE = 0o600;

/** Default OAuth redirect URI; must be registered in the WHOOP developer dashboard. */
export const DEFAULT_REDIRECT_URI = 'http://localhost:8787/callback';
/** WHOOP OAuth2 endpoints base. */
export const DEFAULT_OAUTH_BASE = 'https://api.prod.whoop.com/oauth/oauth2';
/** WHOOP REST v2 base. */
export const DEFAULT_API_BASE = 'https://api.prod.whoop.com/developer/v2';
/** Scopes requested during the authorization-code flow. */
export const DEFAULT_SCOPES = [
  'read:sleep',
  'read:recovery',
  'read:cycles',
  'read:workout',
  'read:profile',
  'read:body_measurement',
  'offline',
];

/** File names inside the data directory. */
export const FILE_NAMES = Object.freeze({
  tokens: 'tokens.json',
  cache: 'cache.json',
  settings: 'settings.json',
});

const HERE = path.dirname(fileURLToPath(import.meta.url));
/** The `whoop-energy/` package root (one level above `src/`). */
export const PACKAGE_ROOT = path.resolve(HERE, '..');

/**
 * Parse a `.env`-style string into a plain object.
 * Supports `KEY=VALUE`, `export KEY=VALUE`, `#` comments, blank lines and
 * single/double quoted values. No interpolation, no multiline values.
 *
 * @param {string} text
 * @returns {Record<string,string>}
 */
export function parseEnv(text) {
  /** @type {Record<string,string>} */
  const out = {};
  if (typeof text !== 'string') return out;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;
    const key = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) continue;
    let value = withoutExport.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
      (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
    ) {
      value = value.slice(1, -1);
    } else {
      // Strip trailing inline comment for unquoted values.
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    out[key] = value;
  }
  return out;
}

/**
 * Load `whoop-energy/.env` (if present) into `process.env` without overwriting
 * variables that are already set. Idempotent and safe to call repeatedly.
 *
 * @param {{ envPath?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {Record<string,string>} the parsed file contents (empty when absent)
 */
export function loadDotEnv(opts = {}) {
  const envPath = opts.envPath ?? path.join(PACKAGE_ROOT, '.env');
  const env = opts.env ?? process.env;
  let text;
  try {
    text = fs.readFileSync(envPath, 'utf8');
  } catch {
    return {};
  }
  const parsed = parseEnv(text);
  for (const [k, v] of Object.entries(parsed)) {
    if (env[k] === undefined) env[k] = v;
  }
  return parsed;
}

/**
 * Resolve the data directory: CLI `--data-dir` > `$WHOOP_ENERGY_HOME` > `~/.whoop-energy`.
 *
 * @param {{ dataDir?: string, env?: NodeJS.ProcessEnv }} [opts]
 * @returns {string} absolute path
 */
export function resolveDataDir(opts = {}) {
  const env = opts.env ?? process.env;
  const chosen = opts.dataDir || env.WHOOP_ENERGY_HOME || path.join(os.homedir(), '.whoop-energy');
  return path.resolve(chosen);
}

/**
 * Create the data directory (recursively) with owner-only permissions.
 *
 * @param {string} dataDir
 * @returns {string} the same path, for chaining
 */
export function ensureDataDir(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true, mode: DATA_DIR_MODE });
  try {
    fs.chmodSync(dataDir, DATA_DIR_MODE);
  } catch {
    /* best effort (e.g. exotic filesystems) */
  }
  return dataDir;
}

/**
 * Build the full runtime config.
 *
 * @param {{ dataDir?: string, env?: NodeJS.ProcessEnv, loadEnvFile?: boolean, envPath?: string }} [opts]
 * @returns {{
 *   dataDir: string, tokensPath: string, cachePath: string, settingsPath: string,
 *   clientId: string|undefined, clientSecret: string|undefined, redirectUri: string,
 *   apiBase: string, oauthBase: string, scopes: string[]
 * }}
 */
export function loadConfig(opts = {}) {
  if (opts.loadEnvFile !== false) loadDotEnv({ envPath: opts.envPath, env: opts.env });
  const env = opts.env ?? process.env;
  const dataDir = resolveDataDir({ dataDir: opts.dataDir, env });
  return {
    dataDir,
    tokensPath: path.join(dataDir, FILE_NAMES.tokens),
    cachePath: path.join(dataDir, FILE_NAMES.cache),
    settingsPath: path.join(dataDir, FILE_NAMES.settings),
    clientId: env.WHOOP_CLIENT_ID || undefined,
    clientSecret: env.WHOOP_CLIENT_SECRET || undefined,
    redirectUri: env.WHOOP_REDIRECT_URI || DEFAULT_REDIRECT_URI,
    apiBase: env.WHOOP_API_BASE || DEFAULT_API_BASE,
    oauthBase: env.WHOOP_OAUTH_BASE || DEFAULT_OAUTH_BASE,
    scopes: env.WHOOP_SCOPES ? env.WHOOP_SCOPES.split(/[\s,]+/).filter(Boolean) : DEFAULT_SCOPES,
  };
}

/**
 * Read a JSON file, returning `fallback` when missing or unparseable.
 *
 * @template T
 * @param {string} filePath
 * @param {T} [fallback]
 * @returns {T|null}
 */
export function readJson(filePath, fallback = null) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

/**
 * Write JSON atomically-ish (write + rename) with an explicit mode.
 *
 * @param {string} filePath
 * @param {unknown} value
 * @param {{ mode?: number }} [opts]
 * @returns {string} filePath
 */
export function writeJson(filePath, value, opts = {}) {
  const mode = opts.mode ?? 0o644;
  ensureDataDir(path.dirname(filePath));
  const tmp = `${filePath}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`, { mode });
  fs.renameSync(tmp, filePath);
  try {
    fs.chmodSync(filePath, mode);
  } catch {
    /* best effort */
  }
  return filePath;
}

/**
 * Load `settings.json` (user overrides such as `needMin`).
 *
 * @param {string} dataDir
 * @returns {Record<string, any>}
 */
export function loadSettings(dataDir) {
  return readJson(path.join(dataDir, FILE_NAMES.settings), {}) ?? {};
}

/**
 * Persist `settings.json`.
 *
 * @param {string} dataDir
 * @param {Record<string, any>} settings
 * @returns {string} path written
 */
export function saveSettings(dataDir, settings) {
  return writeJson(path.join(dataDir, FILE_NAMES.settings), settings);
}
