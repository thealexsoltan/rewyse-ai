/**
 * Stable JSON envelope for the Whoop Energy reports.
 *
 * The envelope is what other tools (Notion, spreadsheets, scripts) consume, so
 * it is versioned and additive: `schemaVersion` only ever goes up, and clock
 * strings are added alongside the raw minute fields rather than replacing them.
 *
 * @module report/json
 */

import { fmtHHMM } from '../time.js';

/** Envelope schema version. Bump on any breaking shape change. */
export const SCHEMA_VERSION = 1;

/**
 * Human-readable clock string for a minutes-of-day value, wrapping past
 * midnight so `1500` becomes `01:00` and `1860` becomes `07:00`.
 *
 * @param {number|null|undefined} min - minutes of day, may exceed 1440
 * @returns {string|null} `HH:MM`, or null when `min` is not a finite number
 */
export function minutesToClock(min) {
  if (min === null || min === undefined || min === '') return null;
  const n = Number(min);
  if (!Number.isFinite(n)) return null;
  return fmtHHMM(((Math.round(n) % 1440) + 1440) % 1440);
}

/** Shallow clone with `startClock`/`endClock` added. Never mutates `entry`. */
function withClocks(entry) {
  if (!entry || typeof entry !== 'object') return entry;
  return {
    ...entry,
    startClock: minutesToClock(entry.startMin),
    endClock: minutesToClock(entry.endMin),
  };
}

/**
 * Copy an `EnergyDay`, decorating zones and plan entries with clock strings and
 * adding clock strings for the wake / bedtime anchors.
 *
 * @param {object|null} energyDay
 * @returns {object|null}
 */
function decorateEnergyDay(energyDay) {
  if (!energyDay || typeof energyDay !== 'object') return energyDay ?? null;
  return {
    ...energyDay,
    wakeClock: minutesToClock(energyDay.wakeMin),
    targetBedtimeClock: minutesToClock(energyDay.targetBedtimeMin),
    targetWakeClock: minutesToClock(energyDay.targetWakeMin),
    nowClock: minutesToClock(energyDay.now),
    zones: Array.isArray(energyDay.zones) ? energyDay.zones.map(withClocks) : [],
    plan: Array.isArray(energyDay.plan) ? energyDay.plan.map(withClocks) : [],
  };
}

/**
 * Build the JSON envelope. Inputs are never mutated.
 *
 * @param {object} input
 * @param {object|null} [input.energyDay]
 * @param {object|null} [input.insights]
 * @param {object[]} [input.nights]
 * @param {string} [input.generatedAt] - ISO timestamp, defaults to now
 * @returns {{schemaVersion: number, generatedAt: string, energyDay: object|null,
 *   insights: object|null, nights: object[]}}
 */
export function toJson({
  energyDay = null,
  insights = null,
  nights = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  return {
    schemaVersion: SCHEMA_VERSION,
    generatedAt,
    energyDay: decorateEnergyDay(energyDay),
    insights: insights ?? null,
    nights: Array.isArray(nights) ? nights.slice() : [],
  };
}

/**
 * Same envelope, pretty-printed with two-space indentation and a trailing
 * newline so the file is diff- and `cat`-friendly.
 *
 * @param {Parameters<typeof toJson>[0]} input
 * @returns {string}
 */
export function toJsonString(input) {
  return `${JSON.stringify(toJson(input), null, 2)}\n`;
}

export default { toJson, toJsonString, minutesToClock, SCHEMA_VERSION };
