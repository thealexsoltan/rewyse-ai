/**
 * Terminal renderers for the Whoop Energy reports.
 *
 * Pure string builders: nothing here touches stdout, the filesystem or the
 * clock. ANSI escapes are emitted only when `color` is true, so the plain
 * output is safe to pipe, diff and snapshot.
 *
 * @module report/terminal
 */

import { fmtHHMM } from '../time.js';

/** Block glyphs used by the energy sparkline, lowest to highest. @type {string[]} */
export const SPARK_BLOCKS = ['▁', '▂', '▃', '▄', '▅', '▆', '▇', '█'];

/** Widest sparkline we ever draw (one column per 15-min curve point). */
export const MAX_SPARK_COLUMNS = 96;

/** Hours between labels on the sparkline hour axis. */
export const AXIS_LABEL_STEP_HOURS = 3;

/** Recovery score thresholds (WHOOP colour bands). */
export const RECOVERY_GREEN_MIN = 67;
export const RECOVERY_YELLOW_MIN = 34;

/** Human labels for `plan[].activity`. @type {Record<string,string>} */
export const ACTIVITY_LABELS = {
  deep_work: 'Deep work',
  workout: 'Workout',
  admin: 'Admin',
  nap: 'Nap',
  wind_down: 'Wind down',
  bed: 'Bed',
};

/** Human labels for `zones[].kind`, used only when a zone carries no `label`. */
export const ZONE_KIND_LABELS = {
  grogginess: 'Grogginess',
  morning_peak: 'Morning peak',
  afternoon_dip: 'Afternoon dip',
  evening_peak: 'Evening peak',
  wind_down: 'Wind-down',
  melatonin_window: 'Melatonin window',
  sleep: 'Sleep',
};

const CSI = `${String.fromCharCode(27)}[`;
const ANSI = {
  reset: `${CSI}0m`,
  bold: `${CSI}1m`,
  dim: `${CSI}2m`,
  red: `${CSI}31m`,
  green: `${CSI}32m`,
  yellow: `${CSI}33m`,
  blue: `${CSI}34m`,
  magenta: `${CSI}35m`,
  cyan: `${CSI}36m`,
};

/**
 * Wrap `text` in an ANSI style when colour is enabled.
 *
 * @param {string} text
 * @param {string|null} style
 * @param {boolean} color
 * @returns {string}
 */
function paint(text, style, color) {
  if (!color || !style || !ANSI[style]) return text;
  return `${ANSI[style]}${text}${ANSI.reset}`;
}

/** @param {*} n @returns {number} */
function num(n) {
  return Number.isFinite(n) ? n : 0;
}

/**
 * Format a duration in minutes as `6h50` (or `50m` under an hour).
 *
 * @param {number|null|undefined} min
 * @returns {string}
 */
export function fmtDur(min) {
  if (min === null || min === undefined || !Number.isFinite(Number(min))) return '—';
  const total = Math.round(Number(min));
  const sign = total < 0 ? '−' : '';
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return h ? `${sign}${h}h${String(m).padStart(2, '0')}` : `${sign}${m}m`;
}

/**
 * Format a signed duration, always with an explicit sign (`+0h30`, `-1h00`).
 *
 * @param {number} min
 * @returns {string}
 */
export function fmtSignedDur(min) {
  const total = Math.round(num(min));
  if (total === 0) return '±0h00';
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return `${total < 0 ? '−' : '+'}${h}h${String(m).padStart(2, '0')}`;
}

/**
 * Format hours as `2h15`.
 *
 * @param {number} hours
 * @returns {string}
 */
export function fmtHours(hours) {
  return fmtDur(Math.round(num(hours) * 60));
}

/**
 * Clock string for a minutes-of-day value, wrapping past midnight
 * (`1500` becomes `01:00`). Delegates to {@link fmtHHMM}.
 *
 * @param {number} min
 * @returns {string}
 */
export function clock(min) {
  return fmtHHMM(((Math.round(num(min)) % 1440) + 1440) % 1440);
}

/**
 * `07:00-08:30` for a zone or plan entry.
 *
 * @param {number} startMin
 * @param {number} endMin
 * @returns {string}
 */
export function fmtRange(startMin, endMin) {
  return `${clock(startMin)}–${clock(endMin)}`;
}

/** ANSI style name for a recovery score, or null when unknown. */
function recoveryStyle(score) {
  if (!Number.isFinite(score)) return null;
  if (score >= RECOVERY_GREEN_MIN) return 'green';
  if (score >= RECOVERY_YELLOW_MIN) return 'yellow';
  return 'red';
}

/** ANSI style name for a debt level. */
function debtStyle(level) {
  switch (level) {
    case 'low':
      return 'green';
    case 'moderate':
      return 'yellow';
    case 'high':
    case 'severe':
      return 'red';
    default:
      return null;
  }
}

/** ANSI style name for a recommendation impact. */
function impactStyle(impact) {
  switch (impact) {
    case 'high':
      return 'red';
    case 'medium':
      return 'yellow';
    default:
      return 'cyan';
  }
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * `2025-09-12` becomes `Sep 12`. Parsed by hand so no timezone can shift it.
 *
 * @param {string} date
 * @returns {string}
 */
export function shortDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  if (!m) return String(date ?? '');
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${String(Number(m[3])).padStart(2, ' ')}`;
}

/** Truncate to `n` visible characters, adding an ellipsis when cut. */
function truncate(text, n) {
  const s = String(text ?? '');
  if (n <= 1) return s.slice(0, Math.max(0, n));
  return s.length <= n ? s : `${s.slice(0, n - 1)}…`;
}

/** Minutes elapsed since wake, wrapped into [0, 1440). */
function sinceWake(min, wakeMin) {
  return (((Math.round(num(min)) - Math.round(num(wakeMin))) % 1440) + 1440) % 1440;
}

/**
 * Build the sparkline, its hour axis and the `▼` "now" marker row.
 *
 * @param {object} energyDay
 * @param {number} columns
 * @param {boolean} color
 * @returns {{marker: string|null, spark: string, axis: string}}
 */
function buildChart(energyDay, columns, color) {
  const curve = Array.isArray(energyDay.curve) ? energyDay.curve : [];
  const cols = Math.max(8, Math.min(MAX_SPARK_COLUMNS, columns));
  const wakeMin = num(energyDay.wakeMin);

  const indexAt = (i) => (curve.length <= 1 ? 0 : Math.round((i * (curve.length - 1)) / (cols - 1)));

  let spark = '';
  for (let i = 0; i < cols; i += 1) {
    const point = curve[indexAt(i)];
    const energy = Math.max(0, Math.min(100, num(point && point.energy)));
    const level = Math.min(
      SPARK_BLOCKS.length - 1,
      Math.floor((energy / 100) * SPARK_BLOCKS.length),
    );
    spark += SPARK_BLOCKS[level];
  }

  // Column for a minutes-of-day value, by elapsed minutes since wake.
  const span = curve.length > 1 ? (curve.length - 1) * 15 : 1440;
  const columnFor = (min) => {
    const elapsed = sinceWake(min, wakeMin);
    return Math.max(0, Math.min(cols - 1, Math.round((elapsed / span) * (cols - 1))));
  };

  const axisChars = new Array(cols).fill(' ');
  const labelChars = new Array(cols).fill(' ');
  for (let h = 0; h <= 24; h += AXIS_LABEL_STEP_HOURS) {
    const col = columnFor(wakeMin + h * 60);
    if (h > 0 && h < 24 && col === 0) continue;
    axisChars[col] = '┬';
    const text = clock(wakeMin + h * 60);
    // Centre the label under its tick, clamped inside the chart.
    let at = Math.max(0, Math.min(cols - text.length, col - Math.floor(text.length / 2)));
    if (labelChars.slice(Math.max(0, at - 1), at + text.length + 1).some((c) => c !== ' ')) continue;
    for (const ch of text) {
      labelChars[at] = ch;
      at += 1;
    }
  }
  const axis = `${axisChars.join('').replace(/\s+$/, '')}\n${labelChars.join('').replace(/\s+$/, '')}`;

  let marker = null;
  if (Number.isFinite(energyDay.now) && energyDay.now !== null) {
    const col = columnFor(energyDay.now);
    marker = paint(`${' '.repeat(col)}▼ now ${clock(energyDay.now)}`, 'magenta', color);
  }

  return { marker, spark: paint(spark, 'cyan', color), axis: paint(axis, 'dim', color) };
}

/**
 * Render today's circadian energy schedule for a terminal.
 *
 * @param {object} energyDay - an `EnergyDay` (see PLAN.md section 4).
 * @param {{color?: boolean, width?: number}} [opts]
 * @returns {string} plain text, no trailing newline
 */
export function renderTodayTerminal(energyDay, opts = {}) {
  const { color = Boolean(process.stdout && process.stdout.isTTY), width = 80 } = opts || {};
  if (!energyDay || typeof energyDay !== 'object') {
    throw new TypeError('renderTodayTerminal: energyDay object is required');
  }
  const w = Math.max(40, Math.floor(num(width) || 80));
  const out = [];
  const label = (text) => paint(text.padEnd(13), 'dim', color);

  // Header
  const title = `Whoop Energy — ${energyDay.date ?? 'today'}`;
  const nowText =
    Number.isFinite(energyDay.now) && energyDay.now !== null ? `now ${clock(energyDay.now)}` : '';
  const gap = Math.max(1, w - title.length - nowText.length);
  out.push(
    paint(title, 'bold', color) + (nowText ? ' '.repeat(gap) + paint(nowText, 'magenta', color) : ''),
  );
  out.push(paint('─'.repeat(w), 'dim', color));

  // Last night
  const night = energyDay.lastNight || null;
  const rec = energyDay.recovery || (night && night.recovery) || null;
  const bits = [];
  if (night) {
    bits.push(`asleep ${fmtDur(night.asleepMin)}`);
    if (Number.isFinite(night.needTotalMin)) bits.push(`need ${fmtDur(night.needTotalMin)}`);
    if (Number.isFinite(night.efficiencyPct)) {
      bits.push(`efficiency ${Math.round(night.efficiencyPct)}%`);
    }
  }
  if (rec && Number.isFinite(rec.score)) {
    bits.push(`recovery ${paint(String(Math.round(rec.score)), recoveryStyle(rec.score), color)}`);
  }
  if (rec && Number.isFinite(rec.hrvMs)) bits.push(`HRV ${Math.round(rec.hrvMs)} ms`);
  if (rec && Number.isFinite(rec.rhr)) bits.push(`RHR ${Math.round(rec.rhr)} bpm`);
  out.push(label('Last night') + (bits.length ? bits.join('   ') : 'no scored sleep'));

  // Sleep debt
  const debt = energyDay.debt || {};
  const debtBits = [fmtHours(debt.hours)];
  if (debt.level) debtBits.push(paint(String(debt.level), debtStyle(debt.level), color));
  if (debt.trend7d) debtBits.push(paint(`${debt.trend7d} vs last week`, 'dim', color));
  out.push(label('Sleep debt') + debtBits.join('   '));

  const need = energyDay.need || {};
  if (Number.isFinite(need.todayMin)) {
    out.push(
      label('Sleep need') +
        `${fmtDur(need.todayMin)} tonight` +
        (Number.isFinite(need.baselineMin) ? `   baseline ${fmtDur(need.baselineMin)}` : ''),
    );
  }

  // Energy curve
  const chart = buildChart(energyDay, w, color);
  out.push('');
  out.push(paint('Energy', 'bold', color));
  if (chart.marker) out.push(chart.marker);
  out.push(chart.spark);
  out.push(chart.axis);

  // Zones
  const zones = Array.isArray(energyDay.zones) ? energyDay.zones : [];
  if (zones.length) {
    out.push('');
    out.push(paint('Zones', 'bold', color));
    const labels = zones.map((z) => String(z.label || ZONE_KIND_LABELS[z.kind] || z.kind || ''));
    const labelW = Math.min(20, Math.max(...labels.map((l) => l.length), 4));
    zones.forEach((zone, i) => {
      const range = fmtRange(zone.startMin, zone.endMin);
      const name = truncate(labels[i], labelW).padEnd(labelW);
      const advice = truncate(zone.advice || '', Math.max(10, w - range.length - labelW - 6));
      out.push(`  ${paint(range, 'dim', color)}  ${paint(name, 'cyan', color)}  ${advice}`);
    });
  }

  // Plan
  const plan = Array.isArray(energyDay.plan) ? energyDay.plan : [];
  if (plan.length) {
    out.push('');
    out.push(paint('Your day', 'bold', color));
    const names = plan.map((p) => ACTIVITY_LABELS[p.activity] || String(p.activity || ''));
    const nameW = Math.min(16, Math.max(...names.map((n) => n.length), 4));
    plan.forEach((entry, i) => {
      const range = fmtRange(entry.startMin, entry.endMin);
      const name = truncate(names[i], nameW).padEnd(nameW);
      const reason = truncate(entry.reason || '', Math.max(10, w - range.length - nameW - 6));
      out.push(`  ${paint(range, 'dim', color)}  ${paint(name, 'blue', color)}  ${reason}`);
    });
  }

  // Targets
  out.push('');
  out.push(
    label('Tonight') +
      `target bedtime ${paint(clock(energyDay.targetBedtimeMin), 'magenta', color)}` +
      `   target wake ${paint(clock(energyDay.targetWakeMin), 'magenta', color)}`,
  );

  return out.join('\n');
}

/**
 * Horizontal bar for one night: asleep filled, the shortfall against need faint.
 *
 * @param {number} asleepMin
 * @param {number} needMin
 * @param {number} scaleMax
 * @param {number} barWidth
 * @returns {string}
 */
function debtBar(asleepMin, needMin, scaleMax, barWidth) {
  const max = scaleMax > 0 ? scaleMax : 1;
  const filled = Math.max(0, Math.min(barWidth, Math.round((num(asleepMin) / max) * barWidth)));
  const needTick = Math.max(0, Math.min(barWidth, Math.round((num(needMin) / max) * barWidth)));
  let bar = '';
  for (let i = 0; i < barWidth; i += 1) {
    if (i < filled) bar += '█';
    else if (i < needTick) bar += '░';
    else bar += ' ';
  }
  return bar;
}

/**
 * Render the multi-day insights report for a terminal.
 *
 * @param {object} insights - an `Insights` (see PLAN.md section 4).
 * @param {{color?: boolean, width?: number}} [opts]
 * @returns {string} plain text, no trailing newline
 */
export function renderInsightsTerminal(insights, opts = {}) {
  const { color = Boolean(process.stdout && process.stdout.isTTY), width = 80 } = opts || {};
  if (!insights || typeof insights !== 'object') {
    throw new TypeError('renderInsightsTerminal: insights object is required');
  }
  const w = Math.max(40, Math.floor(num(width) || 80));
  const out = [];
  const label = (text) => paint(text.padEnd(13), 'dim', color);
  const nights = num(insights.nights);

  out.push(paint(`Whoop Energy — insights (${num(insights.windowDays)} days)`, 'bold', color));
  out.push(paint('─'.repeat(w), 'dim', color));
  out.push(
    label('Window') +
      `${num(insights.windowDays)} days   ${nights} scored night${nights === 1 ? '' : 's'}`,
  );

  // Debt
  const debt = insights.debt || {};
  const debtBits = [fmtHours(debt.hours)];
  if (debt.level) debtBits.push(paint(String(debt.level), debtStyle(debt.level), color));
  if (debt.trend7d) debtBits.push(paint(`${debt.trend7d} vs last week`, 'dim', color));
  out.push(label('Sleep debt') + debtBits.join('   '));

  const byDay = Array.isArray(debt.byDay) ? debt.byDay : [];
  if (byDay.length) {
    out.push('');
    out.push(paint('Sleep vs need', 'bold', color));
    const scaleMax = Math.max(...byDay.map((d) => Math.max(num(d.needMin), num(d.asleepMin))), 1);
    const barWidth = Math.max(8, Math.min(20, w - 42));
    for (const day of byDay) {
      const bar = debtBar(day.asleepMin, day.needMin, scaleMax, barWidth);
      const delta = num(day.deltaMin);
      const styleName = delta < 0 ? 'yellow' : 'green';
      out.push(
        `  ${paint(shortDate(day.date), 'dim', color)}  ${paint(bar, styleName, color)}  ` +
          `${fmtDur(day.asleepMin).padStart(5)} / ${fmtDur(day.needMin).padEnd(5)}  ` +
          `${paint(fmtSignedDur(delta).padStart(6), styleName, color)}`,
      );
    }
  }

  // Consistency and quality
  const c = insights.consistency || {};
  out.push('');
  out.push(
    label('Consistency') +
      `bedtime ±${Math.round(num(c.bedtimeSdMin))} min   wake ±${Math.round(num(c.wakeSdMin))} min` +
      (Number.isFinite(c.whoopConsistencyAvg)
        ? `   WHOOP ${Math.round(c.whoopConsistencyAvg)}%`
        : ''),
  );

  const q = insights.quality || {};
  out.push(
    label('Quality') +
      [
        Number.isFinite(q.efficiencyAvg) ? `efficiency ${Math.round(q.efficiencyAvg)}%` : null,
        Number.isFinite(q.performanceAvg) ? `performance ${Math.round(q.performanceAvg)}%` : null,
        Number.isFinite(q.swsPctAvg) ? `SWS ${Math.round(q.swsPctAvg)}%` : null,
        Number.isFinite(q.remPctAvg) ? `REM ${Math.round(q.remPctAvg)}%` : null,
        Number.isFinite(q.disturbancesAvg)
          ? `disturbances ${q.disturbancesAvg.toFixed(1)}/night`
          : null,
      ]
        .filter(Boolean)
        .join('   '),
  );

  // Recovery / HRV / RHR
  const r = insights.recovery || {};
  if (Number.isFinite(r.avg)) {
    out.push(
      label('Recovery') +
        `${paint(String(Math.round(r.avg)), recoveryStyle(r.avg), color)} avg` +
        (Number.isFinite(r.avg7d)
          ? `   7-day ${paint(String(Math.round(r.avg7d)), recoveryStyle(r.avg7d), color)}`
          : '') +
        (r.calibrating ? paint('   (still calibrating)', 'dim', color) : ''),
    );
  }
  if (Number.isFinite(r.hrvAvg)) {
    const deltaText = Number.isFinite(r.hrvDeltaPct)
      ? `   ${r.hrvDeltaPct >= 0 ? '+' : '−'}${Math.abs(r.hrvDeltaPct).toFixed(1)}% vs baseline`
      : '';
    out.push(
      label('HRV') +
        `${Math.round(r.hrvAvg)} ms avg` +
        (Number.isFinite(r.hrvAvg7d) ? `   7-day ${Math.round(r.hrvAvg7d)} ms` : '') +
        paint(
          deltaText,
          Number.isFinite(r.hrvDeltaPct) && r.hrvDeltaPct <= -10 ? 'red' : 'dim',
          color,
        ),
    );
  }
  if (Number.isFinite(r.rhrAvg)) {
    out.push(
      label('RHR') +
        `${Math.round(r.rhrAvg)} bpm avg` +
        (Number.isFinite(r.rhrAvg7d) ? `   7-day ${Math.round(r.rhrAvg7d)} bpm` : ''),
    );
  }

  // Correlations
  const correlations = Array.isArray(insights.correlations) ? insights.correlations : [];
  if (correlations.length) {
    out.push('');
    out.push(paint('Correlations', 'bold', color));
    for (const corr of correlations) {
      const rr = Number.isFinite(corr.r) ? corr.r.toFixed(2) : '—';
      out.push(`  ${paint(`${corr.x} ↔ ${corr.y}`, 'cyan', color)}  r=${rr} (n=${num(corr.n)})`);
      if (corr.reading) out.push(`    ${truncate(corr.reading, w - 4)}`);
    }
  }

  // Recommendations
  const recs = Array.isArray(insights.recommendations) ? insights.recommendations : [];
  if (recs.length) {
    out.push('');
    out.push(paint('What to optimize', 'bold', color));
    recs.forEach((item, i) => {
      const rank = Number.isFinite(item.rank) ? item.rank : i + 1;
      const impact = paint(`[${item.impact || 'medium'}]`, impactStyle(item.impact), color);
      out.push(`  ${rank}. ${impact} ${paint(String(item.title || ''), 'bold', color)}`);
      if (item.why) out.push(`     ${truncate(item.why, w - 5)}`);
      if (item.action) out.push(`     ${paint('→', 'green', color)} ${truncate(item.action, w - 7)}`);
    });
  }

  return out.join('\n');
}

export default { renderTodayTerminal, renderInsightsTerminal };
