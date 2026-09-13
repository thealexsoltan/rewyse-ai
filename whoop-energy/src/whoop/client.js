/**
 * @file Minimal WHOOP v2 REST client.
 *
 * Zero dependencies. `fetch` and `sleep` are injectable so the whole thing is
 * testable without a network or real timers.
 */

import { DEFAULT_API_BASE } from '../config.js';

/** WHOOP caps collection `limit` at 25. */
export const MAX_PAGE_LIMIT = 25;
/** Default page size used by {@link createClient}'s paginate helpers. */
export const DEFAULT_PAGE_LIMIT = 25;
/** Maximum number of 429 retries before giving up. */
export const MAX_RATE_LIMIT_RETRIES = 3;
/** Upper bound on any single `Retry-After` wait, in milliseconds. */
export const MAX_RETRY_AFTER_MS = 60_000;
/** Fallback wait when a 429 carries no usable `Retry-After`, in milliseconds. */
export const DEFAULT_RETRY_AFTER_MS = 1_000;
/** Hard cap on pages walked by `paginate`, a guard against a server that never clears `next_token`. */
export const MAX_PAGES = 200;

/**
 * An error raised for any non-2xx WHOOP API response.
 */
export class WhoopApiError extends Error {
  /**
   * @param {string} message
   * @param {{ status?: number, body?: unknown, url?: string, method?: string }} [info]
   */
  constructor(message, info = {}) {
    super(message);
    this.name = 'WhoopApiError';
    /** @type {number} HTTP status (0 when the request never completed) */
    this.status = info.status ?? 0;
    /** @type {unknown} parsed JSON body, or the raw text */
    this.body = info.body ?? null;
    /** @type {string|undefined} */
    this.url = info.url;
    /** @type {string|undefined} */
    this.method = info.method;
  }
}

/**
 * Parse a `Retry-After` header (delta-seconds or HTTP-date) into milliseconds.
 *
 * @param {string|null|undefined} header
 * @param {number} [nowMs=Date.now()]
 * @returns {number} milliseconds, clamped to `[0, MAX_RETRY_AFTER_MS]`
 */
export function parseRetryAfter(header, nowMs = Date.now()) {
  if (header == null || header === '') return DEFAULT_RETRY_AFTER_MS;
  const asNumber = Number(String(header).trim());
  let ms;
  if (Number.isFinite(asNumber)) {
    ms = asNumber * 1000;
  } else {
    const when = Date.parse(String(header));
    if (!Number.isFinite(when)) return DEFAULT_RETRY_AFTER_MS;
    ms = when - nowMs;
  }
  if (!Number.isFinite(ms) || ms < 0) return 0;
  return Math.min(MAX_RETRY_AFTER_MS, ms);
}

/** @param {number} ms */
const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Build a query string, dropping `undefined`/`null`/`''` values.
 *
 * @param {Record<string, string|number|boolean|null|undefined>} [query]
 * @returns {string} `''` or `'?a=1&b=2'`
 */
export function buildQuery(query) {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    params.append(k, String(v));
  }
  const s = params.toString();
  return s ? `?${s}` : '';
}

/**
 * Join a base URL and a path without doubling or dropping slashes.
 *
 * @param {string} baseUrl
 * @param {string} path
 * @returns {string}
 */
export function joinUrl(baseUrl, path) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${String(baseUrl).replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`;
}

/**
 * Create a WHOOP API client.
 *
 * @param {Object} options
 * @param {() => (string|Promise<string>)} options.getToken returns a valid bearer access token
 * @param {() => (string|Promise<string>|void|Promise<void>)} [options.refresh] refresh the token; called once on a 401
 * @param {typeof fetch} [options.fetchImpl=fetch] injected for tests
 * @param {string} [options.baseUrl] REST base, defaults to the WHOOP v2 base
 * @param {(ms:number)=>Promise<void>} [options.sleepImpl] injected for tests
 * @param {number} [options.maxRetries=MAX_RATE_LIMIT_RETRIES] 429 retries
 * @param {number} [options.pageLimit=DEFAULT_PAGE_LIMIT] page size for paginate helpers
 * @returns {{
 *   baseUrl: string,
 *   request: (path: string, opts?: Object) => Promise<any>,
 *   get: (path: string, query?: Object) => Promise<any>,
 *   pages: (path: string, query?: Object) => AsyncGenerator<{records: any[], next_token: string|null}>,
 *   paginate: (path: string, query?: Object) => Promise<any[]>
 * }}
 */
export function createClient(options = {}) {
  const {
    getToken,
    refresh,
    fetchImpl = globalThis.fetch,
    baseUrl = DEFAULT_API_BASE,
    sleepImpl = defaultSleep,
    maxRetries = MAX_RATE_LIMIT_RETRIES,
    pageLimit = DEFAULT_PAGE_LIMIT,
  } = options;

  if (typeof getToken !== 'function') {
    throw new TypeError('createClient requires a getToken() function');
  }
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('createClient requires a fetch implementation (Node 18+ provides one globally)');
  }

  /**
   * Read a response body as JSON when possible, otherwise as text.
   * @param {Response} res
   * @returns {Promise<any>}
   */
  async function readBody(res) {
    let text = '';
    try {
      text = await res.text();
    } catch {
      return null;
    }
    if (!text) return null;
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /**
   * Perform one API request, handling 401 (refresh once) and 429 (Retry-After).
   *
   * @param {string} path e.g. `/activity/sleep` or an absolute URL
   * @param {{ method?: string, query?: Object, headers?: Record<string,string>, body?: any }} [opts]
   * @returns {Promise<any>} parsed JSON body
   */
  async function request(path, opts = {}) {
    const method = opts.method ?? 'GET';
    const url = `${joinUrl(baseUrl, path)}${buildQuery(opts.query)}`;
    let refreshed = false;
    let rateLimitRetries = 0;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      const token = await getToken();
      /** @type {Record<string,string>} */
      const headers = {
        accept: 'application/json',
        ...(opts.headers ?? {}),
      };
      if (token) headers.authorization = `Bearer ${token}`;

      /** @type {Response} */
      let res;
      try {
        res = await fetchImpl(url, { method, headers, body: opts.body });
      } catch (err) {
        throw new WhoopApiError(`Network error calling WHOOP: ${err && err.message ? err.message : err}`, {
          status: 0,
          url,
          method,
        });
      }

      if (res.status === 401 && !refreshed && typeof refresh === 'function') {
        refreshed = true;
        await refresh();
        continue;
      }

      if (res.status === 429 && rateLimitRetries < maxRetries) {
        rateLimitRetries += 1;
        const header = res.headers && typeof res.headers.get === 'function' ? res.headers.get('retry-after') : null;
        await sleepImpl(parseRetryAfter(header));
        continue;
      }

      if (!res.ok) {
        const body = await readBody(res);
        throw new WhoopApiError(describeStatus(res.status, method, url, body), {
          status: res.status,
          body,
          url,
          method,
        });
      }

      return readBody(res);
    }
  }

  /**
   * GET a single resource.
   *
   * @param {string} path
   * @param {Object} [query]
   * @returns {Promise<any>}
   */
  function get(path, query) {
    return request(path, { method: 'GET', query });
  }

  /**
   * Walk a paginated collection page by page.
   *
   * @param {string} path
   * @param {Object} [query] `start`, `end`, `limit` … `nextToken` is managed here
   * @returns {AsyncGenerator<{records: any[], next_token: string|null}>}
   */
  async function* pages(path, query = {}) {
    const limit = Math.min(Number(query.limit) || pageLimit, MAX_PAGE_LIMIT);
    let nextToken;
    let page = 0;
    do {
      const body = await get(path, { ...query, limit, nextToken });
      const records = Array.isArray(body?.records) ? body.records : [];
      yield { records, next_token: body?.next_token ?? null };
      nextToken = body?.next_token || undefined;
      page += 1;
    } while (nextToken && page < MAX_PAGES);
  }

  /**
   * Collect every record of a paginated collection.
   *
   * @param {string} path
   * @param {Object} [query]
   * @returns {Promise<any[]>}
   */
  async function paginate(path, query = {}) {
    /** @type {any[]} */
    const all = [];
    for await (const page of pages(path, query)) all.push(...page.records);
    return all;
  }

  return { baseUrl, request, get, pages, paginate };
}

/**
 * Human-readable message for a failed request.
 *
 * @param {number} status
 * @param {string} method
 * @param {string} url
 * @param {unknown} body
 * @returns {string}
 */
function describeStatus(status, method, url, body) {
  const hints = {
    400: 'Bad request — check the start/end dates.',
    401: 'Not authenticated — run `whoop-energy auth`.',
    403: 'Forbidden — the token is missing a required scope.',
    404: 'Not found — the endpoint path may have changed.',
    429: 'Rate limited — too many requests; try again shortly.',
    500: 'WHOOP server error.',
    502: 'WHOOP gateway error.',
    503: 'WHOOP is temporarily unavailable.',
  };
  const detail =
    body && typeof body === 'object' && 'message' in body
      ? ` ${String(/** @type {any} */ (body).message)}`
      : typeof body === 'string' && body
        ? ` ${body.slice(0, 200)}`
        : '';
  return `WHOOP API ${status} on ${method} ${url}. ${hints[status] ?? ''}${detail}`.trim();
}
