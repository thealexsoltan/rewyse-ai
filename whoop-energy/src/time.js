/**
 * @file Local-time helpers.
 *
 * WHOOP records carry an explicit `timezone_offset` string (e.g. `"+02:00"`),
 * so all "local" arithmetic here is done by shifting an absolute instant by a
 * fixed offset in minutes — no IANA timezone database, no DST guessing.
 */

/** Minutes in one day. */
export const MINUTES_PER_DAY = 1440;
/** Milliseconds in one minute. */
export const MS_PER_MINUTE = 60_000;

/**
 * Parse a WHOOP timezone offset string into minutes east of UTC.
 * Accepts `"+02:00"`, `"-05:30"`, `"+0200"`, `"+02"`, `"Z"`, or a number.
 *
 * @param {string|number|null|undefined} offset
 * @param {number} [fallback=0] returned when the input cannot be parsed
 * @returns {number} minutes (e.g. `"+02:00"` → `120`)
 */
export function parseTzOffset(offset, fallback = 0) {
  if (typeof offset === 'number' && Number.isFinite(offset)) return Math.round(offset);
  if (typeof offset !== 'string') return fallback;
  const s = offset.trim();
  if (!s) return fallback;
  if (s === 'Z' || s === 'z' || s === 'UTC') return 0;
  const m = /^([+-])(\d{1,2}):?(\d{2})?$/.exec(s);
  if (!m) return fallback;
  const sign = m[1] === '-' ? -1 : 1;
  const hours = Number(m[2]);
  const mins = m[3] ? Number(m[3]) : 0;
  if (!Number.isFinite(hours) || !Number.isFinite(mins)) return fallback;
  return sign * (hours * 60 + mins);
}

/**
 * Format minutes east of UTC back into a WHOOP-style offset string.
 *
 * @param {number} tzOffsetMin
 * @returns {string} e.g. `"+02:00"`
 */
export function formatTzOffset(tzOffsetMin) {
  const n = Math.round(Number(tzOffsetMin) || 0);
  const sign = n < 0 ? '-' : '+';
  const abs = Math.abs(n);
  return `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
}

/**
 * Convert an ISO instant to a `Date` shifted into the given local offset, so
 * its **UTC** getters read as local wall-clock values.
 *
 * @param {string|number|Date} iso
 * @param {number} tzOffsetMin
 * @returns {Date}
 */
function shifted(iso, tzOffsetMin) {
  const ms = iso instanceof Date ? iso.getTime() : new Date(iso).getTime();
  if (!Number.isFinite(ms)) throw new TypeError(`Invalid date: ${String(iso)}`);
  return new Date(ms + (Number(tzOffsetMin) || 0) * MS_PER_MINUTE);
}

/**
 * Local minutes-of-day for an instant, in `[0, 1440)`.
 *
 * @param {string|number|Date} iso
 * @param {number} tzOffsetMin
 * @returns {number}
 */
export function toLocalMinutes(iso, tzOffsetMin) {
  const d = shifted(iso, tzOffsetMin);
  const raw = d.getUTCHours() * 60 + d.getUTCMinutes() + (d.getUTCSeconds() >= 30 ? 1 : 0);
  return wrapMinutes(raw);
}

/**
 * Local calendar date (`YYYY-MM-DD`) for an instant.
 *
 * @param {string|number|Date} iso
 * @param {number} tzOffsetMin
 * @returns {string}
 */
export function localDateString(iso, tzOffsetMin) {
  const d = shifted(iso, tzOffsetMin);
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate(),
  ).padStart(2, '0')}`;
}

/**
 * Whole minutes between two instants (`b - a`).
 *
 * @param {string|number|Date} a
 * @param {string|number|Date} b
 * @returns {number}
 */
export function minutesBetween(a, b) {
  const am = a instanceof Date ? a.getTime() : new Date(a).getTime();
  const bm = b instanceof Date ? b.getTime() : new Date(b).getTime();
  return Math.round((bm - am) / MS_PER_MINUTE);
}

/**
 * Add minutes.
 *
 * - number input → treated as minutes-of-day, result wrapped into `[0, 1440)`.
 * - string / Date input → treated as an instant, result returned as an ISO string.
 *
 * @param {number|string|Date} value
 * @param {number} delta
 * @returns {number|string}
 */
export function addMinutes(value, delta) {
  const d = Number(delta) || 0;
  if (typeof value === 'number') return wrapMinutes(value + d);
  const ms = value instanceof Date ? value.getTime() : new Date(value).getTime();
  if (!Number.isFinite(ms)) throw new TypeError(`Invalid date: ${String(value)}`);
  return new Date(ms + d * MS_PER_MINUTE).toISOString();
}

/**
 * Wrap any minute value into `[0, 1440)`.
 *
 * @param {number} min
 * @returns {number}
 */
export function wrapMinutes(min) {
  const n = Math.round(Number(min) || 0);
  return ((n % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

/**
 * Clamp a minute value into an inclusive range (defaults to a single day).
 *
 * @param {number} min
 * @param {number} [lo=0]
 * @param {number} [hi=1440]
 * @returns {number}
 */
export function clampMinutes(min, lo = 0, hi = MINUTES_PER_DAY) {
  const n = Number(min) || 0;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Format minutes-of-day as `HH:MM` (24h). Values `>= 1440` wrap, so
 * `fmtHHMM(1500)` → `"01:00"`. Negative values wrap too.
 *
 * @param {number} min
 * @returns {string}
 */
export function fmtHHMM(min) {
  const m = wrapMinutes(min);
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * Format a minute *duration* as `Xh Ym` (not wrapped).
 *
 * @param {number} min
 * @returns {string}
 */
export function fmtDuration(min) {
  const total = Math.round(Number(min) || 0);
  const sign = total < 0 ? '-' : '';
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return h ? `${sign}${h}h ${m}m` : `${sign}${m}m`;
}

/**
 * Parse `"07:30"` / `"7:30"` / `"0730"` / `"7"` into minutes-of-day.
 *
 * @param {string|number} value
 * @returns {number} minutes in `[0, 1440)`
 * @throws {TypeError} when unparseable or out of range
 */
export function parseHHMM(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return wrapMinutes(value);
  const s = String(value ?? '').trim();
  let m = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (!m) m = /^(\d{2})(\d{2})$/.exec(s);
  if (!m) {
    const hOnly = /^(\d{1,2})$/.exec(s);
    if (hOnly) {
      const h = Number(hOnly[1]);
      if (h > 23) throw new TypeError(`Invalid time: ${s}`);
      return h * 60;
    }
    throw new TypeError(`Invalid time (expected HH:MM): ${s}`);
  }
  const hours = Number(m[1]);
  const mins = Number(m[2]);
  if (hours > 23 || mins > 59) throw new TypeError(`Invalid time: ${s}`);
  return hours * 60 + mins;
}

/**
 * Parse a duration written as `"7.5h"`, `"7h30m"`, `"450m"`, `"450"` or `"7:30"`
 * into minutes.
 *
 * @param {string|number} value
 * @returns {number} minutes (rounded)
 * @throws {TypeError} when unparseable
 */
export function parseHours(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
  const s = String(value ?? '').trim().toLowerCase();
  if (!s) throw new TypeError('Invalid duration: (empty)');
  const colon = /^(\d{1,2}):(\d{2})$/.exec(s);
  if (colon) return Number(colon[1]) * 60 + Number(colon[2]);
  const hm = /^(\d+(?:\.\d+)?)\s*h(?:\s*(\d+(?:\.\d+)?)\s*m(?:in)?)?$/.exec(s);
  if (hm) return Math.round(Number(hm[1]) * 60 + (hm[2] ? Number(hm[2]) : 0));
  const mOnly = /^(\d+(?:\.\d+)?)\s*m(?:in)?$/.exec(s);
  if (mOnly) return Math.round(Number(mOnly[1]));
  const bare = /^(\d+(?:\.\d+)?)$/.exec(s);
  if (bare) return Math.round(Number(bare[1]));
  throw new TypeError(`Invalid duration (expected e.g. 7.5h, 7h30m or 450): ${s}`);
}

/**
 * Circular mean of minutes-of-day — correct across midnight
 * (e.g. `[1430, 10]` → `1440`-wrapped `0`).
 *
 * @param {number[]} minutes
 * @returns {number|null} minutes in `[0, 1440)`, or `null` for an empty/undefined input
 */
export function circularMeanMinutes(minutes) {
  const vals = (minutes ?? []).filter((m) => Number.isFinite(m));
  if (vals.length === 0) return null;
  let sx = 0;
  let sy = 0;
  for (const m of vals) {
    const theta = (2 * Math.PI * wrapMinutes(m)) / MINUTES_PER_DAY;
    sx += Math.cos(theta);
    sy += Math.sin(theta);
  }
  if (Math.abs(sx) < 1e-12 && Math.abs(sy) < 1e-12) return null; // perfectly antipodal
  const angle = Math.atan2(sy / vals.length, sx / vals.length);
  return wrapMinutes(Math.round((angle * MINUTES_PER_DAY) / (2 * Math.PI)));
}

/**
 * Circular standard deviation of minutes-of-day (Mardia): `sqrt(-2 ln R)`
 * converted from radians to minutes.
 *
 * @param {number[]} minutes
 * @returns {number|null} minutes, or `null` when fewer than 2 finite samples
 */
export function circularSdMinutes(minutes) {
  const vals = (minutes ?? []).filter((m) => Number.isFinite(m));
  if (vals.length < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const m of vals) {
    const theta = (2 * Math.PI * wrapMinutes(m)) / MINUTES_PER_DAY;
    sx += Math.cos(theta);
    sy += Math.sin(theta);
  }
  const r = Math.sqrt(sx * sx + sy * sy) / vals.length;
  if (r <= 1e-12) return MINUTES_PER_DAY / 4; // maximally dispersed
  const sdRad = Math.sqrt(-2 * Math.log(Math.min(1, r)));
  return Math.round(((sdRad * MINUTES_PER_DAY) / (2 * Math.PI)) * 10) / 10;
}

/**
 * Signed shortest difference between two minutes-of-day, in `(-720, 720]`.
 *
 * @param {number} a
 * @param {number} b
 * @returns {number} `b - a` the short way round the clock
 */
export function circularDiffMinutes(a, b) {
  let d = wrapMinutes(b) - wrapMinutes(a);
  if (d > MINUTES_PER_DAY / 2) d -= MINUTES_PER_DAY;
  if (d <= -MINUTES_PER_DAY / 2) d += MINUTES_PER_DAY;
  return d;
}

/**
 * Build an ISO instant from a local date + minutes-of-day at a fixed offset.
 *
 * @param {string} dateStr `YYYY-MM-DD` (local)
 * @param {number} minutesOfDay may exceed 1440 or be negative (rolls the date)
 * @param {number} tzOffsetMin
 * @returns {string} ISO 8601 UTC string
 */
export function localToIso(dateStr, minutesOfDay, tzOffsetMin) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const baseUtc = Date.UTC(y, (m || 1) - 1, d || 1);
  const ms = baseUtc + (Number(minutesOfDay) || 0) * MS_PER_MINUTE - (Number(tzOffsetMin) || 0) * MS_PER_MINUTE;
  return new Date(ms).toISOString();
}

/**
 * Shift a `YYYY-MM-DD` string by whole days.
 *
 * @param {string} dateStr
 * @param {number} days
 * @returns {string}
 */
export function addDays(dateStr, days) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const t = Date.UTC(y, (m || 1) - 1, d || 1) + (Number(days) || 0) * MINUTES_PER_DAY * MS_PER_MINUTE;
  const dt = new Date(t);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(
    dt.getUTCDate(),
  ).padStart(2, '0')}`;
}
