/**
 * @file Pull sleep / recovery / cycle records for the last N days and cache them.
 */

import path from 'node:path';
import { FILE_NAMES, readJson, writeJson, ensureDataDir } from '../config.js';

/** Default sync window, in days. */
export const DEFAULT_SYNC_DAYS = 30;
/** A cache older than this is considered stale by `today` / `report`. */
export const DEFAULT_MAX_CACHE_AGE_HOURS = 6;

/** WHOOP v2 collection paths. */
export const ENDPOINTS = Object.freeze({
  sleep: '/activity/sleep',
  recovery: '/recovery',
  cycle: '/cycle',
  profile: '/user/profile/basic',
});

/**
 * @typedef {import('../model/types.js').WhoopCache} WhoopCache
 */

/**
 * Fetch sleep, recovery and cycle records for `[now - days, now]` and write
 * `cache.json` in the data directory.
 *
 * Recovery records carry no `start`/`end`, so the collection is fetched with
 * the same window and filtered server-side by WHOOP on `created_at`.
 *
 * @param {Object} params
 * @param {{ paginate: (path: string, query?: Object) => Promise<any[]> }} params.client
 * @param {number} [params.days=DEFAULT_SYNC_DAYS]
 * @param {string} params.dataDir
 * @param {Date} [params.now]
 * @param {boolean} [params.write=true] set false to fetch without touching disk
 * @returns {Promise<WhoopCache>}
 */
export async function syncWhoop({ client, days = DEFAULT_SYNC_DAYS, dataDir, now = new Date(), write = true }) {
  const end = new Date(now.getTime());
  // Pad the start by a day so the cycle preceding the oldest sleep is included.
  const start = new Date(end.getTime() - (Number(days) + 1) * 24 * 60 * 60 * 1000);
  const window = { start: start.toISOString(), end: end.toISOString() };

  const [sleep, recovery, cycle] = await Promise.all([
    client.paginate(ENDPOINTS.sleep, window),
    client.paginate(ENDPOINTS.recovery, window),
    client.paginate(ENDPOINTS.cycle, window),
  ]);

  /** @type {WhoopCache} */
  const cache = {
    fetchedAt: now.toISOString(),
    days: Number(days),
    sleep: sleep ?? [],
    recovery: recovery ?? [],
    cycle: cycle ?? [],
  };

  if (write && dataDir) {
    ensureDataDir(dataDir);
    writeJson(cachePath(dataDir), cache);
  }
  return cache;
}

/**
 * Absolute path of `cache.json`.
 *
 * @param {string} dataDir
 * @returns {string}
 */
export function cachePath(dataDir) {
  return path.join(dataDir, FILE_NAMES.cache);
}

/**
 * Read the cached WHOOP payload.
 *
 * @param {string} dataDir
 * @returns {WhoopCache|null}
 */
export function loadCache(dataDir) {
  const cache = readJson(cachePath(dataDir), null);
  if (!cache || typeof cache !== 'object' || !Array.isArray(cache.sleep)) return null;
  return /** @type {WhoopCache} */ (cache);
}

/**
 * True when the cache is missing or older than `maxAgeHours`.
 *
 * @param {WhoopCache|null} cache
 * @param {number} [maxAgeHours=DEFAULT_MAX_CACHE_AGE_HOURS]
 * @param {Date} [now]
 * @returns {boolean}
 */
export function isCacheStale(cache, maxAgeHours = DEFAULT_MAX_CACHE_AGE_HOURS, now = new Date()) {
  if (!cache) return true;
  const fetchedAt = Date.parse(cache.fetchedAt ?? '');
  if (!Number.isFinite(fetchedAt)) return true;
  return now.getTime() - fetchedAt > maxAgeHours * 60 * 60 * 1000;
}

/**
 * Age of the cache in hours (null when there is no usable cache).
 *
 * @param {WhoopCache|null} cache
 * @param {Date} [now]
 * @returns {number|null}
 */
export function cacheAgeHours(cache, now = new Date()) {
  const fetchedAt = Date.parse(cache?.fetchedAt ?? '');
  if (!Number.isFinite(fetchedAt)) return null;
  return Math.round(((now.getTime() - fetchedAt) / 3_600_000) * 10) / 10;
}

/**
 * Fetch the authenticated user's basic profile (used by `status`).
 *
 * @param {{ get: (path: string, query?: Object) => Promise<any> }} client
 * @returns {Promise<{user_id?: number, email?: string, first_name?: string, last_name?: string}>}
 */
export function fetchProfile(client) {
  return client.get(ENDPOINTS.profile);
}
