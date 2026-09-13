/**
 * @file WHOOP OAuth 2.0 authorization-code flow, token storage and refresh.
 *
 * Node built-ins only: `node:http` for the loopback callback server,
 * `node:crypto` for the CSRF `state`, `node:child_process` only to *try* to
 * open a browser (failure is ignored — the URL is always printed).
 */

import http from 'node:http';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  loadConfig,
  readJson,
  writeJson,
  ensureDataDir,
  SECRET_FILE_MODE,
  DEFAULT_REDIRECT_URI,
} from '../config.js';

/** Refresh the access token when it expires within this many seconds. */
export const REFRESH_SKEW_SECONDS = 60;
/** How long `runAuthFlow` waits for the browser redirect, in milliseconds. */
export const AUTH_TIMEOUT_MS = 5 * 60 * 1000;

/**
 * Raised when credentials or tokens are missing/invalid. `code` is the CLI exit
 * code (3 = not authenticated).
 */
export class AuthError extends Error {
  /**
   * @param {string} message
   * @param {{ code?: number, cause?: unknown }} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'AuthError';
    /** @type {number} */
    this.code = info.code ?? 3;
    if (info.cause !== undefined) this.cause = info.cause;
  }
}

/**
 * @typedef {Object} TokenSet
 * @property {string} access_token
 * @property {string} [refresh_token]
 * @property {number} [expires_in] seconds, as returned by WHOOP
 * @property {string} [scope]
 * @property {string} [token_type]
 * @property {string} obtainedAt ISO instant the token was issued to us
 * @property {string} expiresAt ISO instant the access token stops being valid
 */

/**
 * Read `tokens.json`.
 *
 * @param {string} tokensPath
 * @returns {TokenSet|null}
 */
export function loadTokens(tokensPath) {
  const t = readJson(tokensPath, null);
  return t && typeof t === 'object' && t.access_token ? /** @type {TokenSet} */ (t) : null;
}

/**
 * Write `tokens.json` with mode 0600, stamping `obtainedAt` / `expiresAt`.
 *
 * @param {string} tokensPath
 * @param {Object} tokenResponse the raw WHOOP token response
 * @param {{ now?: Date, previous?: TokenSet|null }} [opts]
 * @returns {TokenSet} the stored token set
 */
export function saveTokens(tokensPath, tokenResponse, opts = {}) {
  const now = opts.now ?? new Date();
  const expiresIn = Number(tokenResponse.expires_in);
  /** @type {TokenSet} */
  const stored = {
    ...tokenResponse,
    // WHOOP omits refresh_token on some refresh responses; keep the previous one.
    refresh_token: tokenResponse.refresh_token || opts.previous?.refresh_token,
    obtainedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + (Number.isFinite(expiresIn) ? expiresIn : 3600) * 1000).toISOString(),
  };
  writeJson(tokensPath, stored, { mode: SECRET_FILE_MODE });
  return stored;
}

/**
 * Delete stored tokens (used by `auth --logout`-style flows).
 *
 * @param {string} tokensPath
 * @returns {boolean} true when a file was removed
 */
export function clearTokens(tokensPath) {
  try {
    fs.unlinkSync(tokensPath);
    return true;
  } catch {
    return false;
  }
}

/**
 * True when the token expires within `skewSeconds`.
 *
 * @param {TokenSet|null} tokens
 * @param {number} [skewSeconds=REFRESH_SKEW_SECONDS]
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isExpired(tokens, skewSeconds = REFRESH_SKEW_SECONDS, now = new Date()) {
  if (!tokens || !tokens.access_token) return true;
  const exp = Date.parse(tokens.expiresAt ?? '');
  if (!Number.isFinite(exp)) return true;
  return exp - now.getTime() <= skewSeconds * 1000;
}

/**
 * Assert that client credentials are present; throws a helpful `AuthError`.
 *
 * @param {{clientId?: string, clientSecret?: string}} config
 * @returns {void}
 */
export function requireCredentials(config) {
  const missing = [];
  if (!config.clientId) missing.push('WHOOP_CLIENT_ID');
  if (!config.clientSecret) missing.push('WHOOP_CLIENT_SECRET');
  if (missing.length === 0) return;
  throw new AuthError(
    [
      `Missing ${missing.join(' and ')}.`,
      '',
      '1. Create an app at https://developer-dashboard.whoop.com/',
      `2. Register the redirect URI: ${config.redirectUri || DEFAULT_REDIRECT_URI}`,
      '3. Copy whoop-energy/.env.example to whoop-energy/.env and fill in the values',
      '   (or export them in your shell), then run: whoop-energy auth',
      '',
      'No credentials needed to try the tool: run any command with --demo.',
    ].join('\n'),
    { code: 3 },
  );
}

/**
 * Build the WHOOP authorize URL.
 *
 * @param {Object} params
 * @param {string} params.clientId
 * @param {string} params.redirectUri
 * @param {string[]|string} params.scopes
 * @param {string} params.state
 * @param {string} [params.oauthBase]
 * @returns {string}
 */
export function buildAuthorizeUrl({ clientId, redirectUri, scopes, state, oauthBase }) {
  const base = `${(oauthBase || loadConfig().oauthBase).replace(/\/+$/, '')}/auth`;
  const url = new URL(base);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('scope', Array.isArray(scopes) ? scopes.join(' ') : String(scopes));
  url.searchParams.set('state', state);
  return url.toString();
}

/**
 * Best-effort browser open. Never throws, never blocks the flow.
 *
 * @param {string} url
 * @param {NodeJS.Platform} [platform=process.platform]
 * @returns {boolean} true when a child process was spawned
 */
export function tryOpenBrowser(url, platform = process.platform) {
  const candidates =
    platform === 'darwin'
      ? [['open', [url]]]
      : platform === 'win32'
        ? [['cmd', ['/c', 'start', '', url]]]
        : [['xdg-open', [url]]];
  for (const [cmd, args] of candidates) {
    try {
      const child = spawn(cmd, args, { stdio: 'ignore', detached: true });
      child.on('error', () => {});
      child.unref();
      return true;
    } catch {
      /* ignored — the URL is printed regardless */
    }
  }
  return false;
}

/**
 * Exchange form-encoded parameters at the WHOOP token endpoint.
 *
 * @param {Object} params
 * @param {Record<string,string>} params.form
 * @param {string} params.oauthBase
 * @param {typeof fetch} [params.fetchImpl]
 * @returns {Promise<Object>} the raw token response
 */
export async function postToken({ form, oauthBase, fetchImpl = globalThis.fetch }) {
  const url = `${String(oauthBase).replace(/\/+$/, '')}/token`;
  const body = new URLSearchParams(form).toString();
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json',
      },
      body,
    });
  } catch (err) {
    throw new AuthError(`Could not reach the WHOOP token endpoint: ${err?.message ?? err}`, { code: 4 });
  }
  const text = await res.text().catch(() => '');
  let parsed = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }
  if (!res.ok) {
    const detail =
      parsed && typeof parsed === 'object'
        ? `${parsed.error ?? ''} ${parsed.error_description ?? ''}`.trim()
        : String(parsed ?? '').slice(0, 200);
    throw new AuthError(`Token request failed (${res.status}). ${detail}`.trim(), { code: 3 });
  }
  if (!parsed || typeof parsed !== 'object' || !parsed.access_token) {
    throw new AuthError('Token endpoint returned no access_token.', { code: 3 });
  }
  return parsed;
}

/**
 * Wait for the OAuth redirect on a loopback HTTP server.
 *
 * @param {Object} params
 * @param {string} params.redirectUri the registered redirect URI (its port + path are used)
 * @param {string} params.state expected CSRF state
 * @param {number} [params.timeoutMs=AUTH_TIMEOUT_MS]
 * @returns {Promise<string>} the authorization `code`
 */
export function waitForCallback({ redirectUri, state, timeoutMs = AUTH_TIMEOUT_MS }) {
  const target = new URL(redirectUri);
  const port = Number(target.port || 80);
  const wantPath = target.pathname || '/callback';

  return new Promise((resolve, reject) => {
    /** @type {NodeJS.Timeout} */
    let timer;
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || '/', `http://localhost:${port}`);
      if (url.pathname !== wantPath) {
        res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('Not found');
        return;
      }
      const code = url.searchParams.get('code');
      const gotState = url.searchParams.get('state');
      const error = url.searchParams.get('error');

      /** @param {string} title @param {string} detail */
      const page = (title, detail) =>
        `<!doctype html><meta charset="utf-8"><title>${title}</title>` +
        `<body style="font:16px system-ui;padding:3rem;max-width:34rem;margin:auto">` +
        `<h1 style="font-size:1.3rem">${title}</h1><p>${detail}</p></body>`;

      if (error) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page('WHOOP authorization failed', `WHOOP returned: <code>${escapeHtml(error)}</code>`));
        finish(new AuthError(`Authorization denied by WHOOP: ${error}`, { code: 3 }));
        return;
      }
      if (!code) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page('Missing code', 'The redirect did not include an authorization code.'));
        return;
      }
      if (gotState !== state) {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' });
        res.end(page('State mismatch', 'The state parameter did not match. Nothing was saved.'));
        finish(new AuthError('OAuth state mismatch — aborting (possible CSRF).', { code: 3 }));
        return;
      }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
      res.end(page('WHOOP connected', 'You can close this tab and return to your terminal.'));
      finish(null, code);
    });

    /** @param {Error|null} err @param {string} [code] */
    function finish(err, code) {
      clearTimeout(timer);
      server.close(() => {
        if (err) reject(err);
        else resolve(/** @type {string} */ (code));
      });
      // Do not let a keep-alive socket hold the process open.
      server.closeAllConnections?.();
    }

    server.on('error', (err) => {
      clearTimeout(timer);
      const hint =
        /** @type {any} */ (err).code === 'EADDRINUSE'
          ? `Port ${port} is already in use. Close whatever is using it, or set WHOOP_REDIRECT_URI to another registered URI.`
          : String(err.message ?? err);
      reject(new AuthError(`Could not start the local callback server. ${hint}`, { code: 3 }));
    });

    server.listen(port, '127.0.0.1', () => {
      timer = setTimeout(() => {
        finish(new AuthError(`Timed out after ${Math.round(timeoutMs / 1000)}s waiting for the WHOOP redirect.`, { code: 3 }));
      }, timeoutMs);
      if (typeof timer.unref === 'function') timer.unref();
    });
  });
}

/** @param {string} s */
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/**
 * Run the full authorization-code flow and persist the tokens.
 *
 * @param {Object} [options]
 * @param {ReturnType<typeof loadConfig>} [options.config]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {(msg: string) => void} [options.log]
 * @param {boolean} [options.openBrowser=true]
 * @param {number} [options.timeoutMs]
 * @returns {Promise<TokenSet>}
 */
export async function runAuthFlow(options = {}) {
  const config = options.config ?? loadConfig();
  const log = options.log ?? ((m) => process.stderr.write(`${m}\n`));
  requireCredentials(config);
  ensureDataDir(config.dataDir);

  const state = crypto.randomBytes(16).toString('hex');
  const authorizeUrl = buildAuthorizeUrl({
    clientId: /** @type {string} */ (config.clientId),
    redirectUri: config.redirectUri,
    scopes: config.scopes,
    state,
    oauthBase: config.oauthBase,
  });

  log('Open this URL to authorize whoop-energy with WHOOP:\n');
  log(`  ${authorizeUrl}\n`);
  log(`Waiting for the redirect to ${config.redirectUri} …`);
  if (options.openBrowser !== false) tryOpenBrowser(authorizeUrl);

  const code = await waitForCallback({
    redirectUri: config.redirectUri,
    state,
    timeoutMs: options.timeoutMs,
  });

  const tokenResponse = await postToken({
    oauthBase: config.oauthBase,
    fetchImpl: options.fetchImpl,
    form: {
      grant_type: 'authorization_code',
      code,
      client_id: /** @type {string} */ (config.clientId),
      client_secret: /** @type {string} */ (config.clientSecret),
      redirect_uri: config.redirectUri,
    },
  });

  const saved = saveTokens(config.tokensPath, tokenResponse);
  log(`Authorized. Tokens saved to ${config.tokensPath} (mode 0600).`);
  return saved;
}

/**
 * Exchange the stored refresh token for a fresh access token.
 *
 * @param {Object} [options]
 * @param {ReturnType<typeof loadConfig>} [options.config]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {TokenSet|null} [options.tokens] override the on-disk tokens
 * @returns {Promise<TokenSet>}
 */
export async function refreshTokens(options = {}) {
  const config = options.config ?? loadConfig();
  requireCredentials(config);
  const current = options.tokens ?? loadTokens(config.tokensPath);
  if (!current?.refresh_token) {
    throw new AuthError('No refresh token stored — run `whoop-energy auth`.', { code: 3 });
  }
  const tokenResponse = await postToken({
    oauthBase: config.oauthBase,
    fetchImpl: options.fetchImpl,
    form: {
      grant_type: 'refresh_token',
      refresh_token: current.refresh_token,
      client_id: /** @type {string} */ (config.clientId),
      client_secret: /** @type {string} */ (config.clientSecret),
      scope: 'offline',
    },
  });
  return saveTokens(config.tokensPath, tokenResponse, { previous: current });
}

/**
 * Return a usable access token, refreshing when it is within
 * {@link REFRESH_SKEW_SECONDS} of expiry.
 *
 * @param {Object} [options]
 * @param {ReturnType<typeof loadConfig>} [options.config]
 * @param {typeof fetch} [options.fetchImpl]
 * @param {boolean} [options.allowRefresh=true]
 * @returns {Promise<string>}
 * @throws {AuthError} exit code 3 when not authenticated
 */
export async function getValidAccessToken(options = {}) {
  const config = options.config ?? loadConfig();
  const tokens = loadTokens(config.tokensPath);
  if (!tokens) {
    throw new AuthError('Not authenticated — run `whoop-energy auth` (or use --demo).', { code: 3 });
  }
  if (!isExpired(tokens)) return tokens.access_token;
  if (options.allowRefresh === false) return tokens.access_token;
  const refreshed = await refreshTokens({ config, fetchImpl: options.fetchImpl });
  return refreshed.access_token;
}

/**
 * Summarise the local auth state for `whoop-energy status`.
 *
 * @param {ReturnType<typeof loadConfig>} config
 * @param {Date} [now]
 * @returns {{ authenticated: boolean, hasCredentials: boolean, expiresAt: string|null, expiresInSec: number|null, expired: boolean, scope: string|null, tokensPath: string }}
 */
export function authStatus(config, now = new Date()) {
  const tokens = loadTokens(config.tokensPath);
  const exp = tokens?.expiresAt ? Date.parse(tokens.expiresAt) : NaN;
  return {
    authenticated: Boolean(tokens),
    hasCredentials: Boolean(config.clientId && config.clientSecret),
    expiresAt: tokens?.expiresAt ?? null,
    expiresInSec: Number.isFinite(exp) ? Math.round((exp - now.getTime()) / 1000) : null,
    expired: isExpired(tokens, 0, now),
    scope: tokens?.scope ?? null,
    tokensPath: config.tokensPath,
  };
}
