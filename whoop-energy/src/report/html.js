/**
 * Single-file HTML report for Whoop Energy.
 *
 * The page is a Rise-style vertical timeline: time runs top to bottom from
 * wake (sun) to target bedtime (moon), and the curve's **x** position encodes
 * energy across three guide columns — SLEEP (low) · DIP (mid) · PEAK (high).
 * Every zone gets a marker on the curve and a label row to its right.
 *
 * The document is self-contained apart from one Google Fonts stylesheet link:
 * all CSS and every chart is inline, there is no script at all, and the page
 * reads correctly with the fonts blocked (the fallback stacks are sized for
 * it) or with scripting disabled.
 *
 * @module report/html
 */

import { minutesToClock } from './json.js';

/* ── Geometry ─────────────────────────────────────────────────────────────── */

/** Vertical-timeline geometry, in user units inside its own viewBox. */
export const TIMELINE = Object.freeze({
  width: 720,
  hourHeight: 56,
  padTop: 104,
  padBottom: 64,
  xLow: 94, // energy 0 — the SLEEP column
  xMid: 197, // energy 50 — the DIP column
  xHigh: 300, // energy 100 — the PEAK column
  labelX: 356,
  rowHeight: 110,
  markerR: 22,
  endpointR: 20,
  endpointClearance: 48,
});

/** Sleep-vs-need SVG geometry. */
export const BARS_VIEWBOX = Object.freeze({ width: 720, height: 236 });
const BARS_PLOT = Object.freeze({ x0: 40, x1: 706, y0: 22, y1: 178 });

/** Minutes covered by the modelled curve (wake to wake + 24 h). */
export const CURVE_SPAN_MIN = 1440;

/** Hours between horizontal gridlines on the timeline. */
export const GRID_STEP_HOURS = 2;

/** Characters per line before the advice text wraps. */
export const ADVICE_WRAP_CHARS = 32;

/** Recovery colour bands (shared with the terminal renderer). */
export const RECOVERY_GREEN_MIN = 67;
export const RECOVERY_YELLOW_MIN = 34;

/** Human labels for `plan[].activity`. */
export const ACTIVITY_LABELS = {
  deep_work: 'Deep work',
  workout: 'Workout',
  admin: 'Admin',
  nap: 'Nap',
  wind_down: 'Wind down',
  bed: 'Bed',
};

/** Display titles for `zones[].kind`, as shown beside the timeline. */
export const ZONE_KIND_LABELS = {
  grogginess: 'Waking Grogginess',
  morning_peak: 'First Peak',
  afternoon_dip: 'Afternoon Dip',
  evening_peak: 'Second Peak',
  wind_down: 'Bedtime Wind-down',
  melatonin_window: 'Melatonin Window',
  sleep: 'Sleep',
};

/** Which zones read as a "peak" (orange marker); everything else is blue. */
const PEAK_KINDS = new Set(['morning_peak', 'evening_peak']);

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/* ── Small helpers ────────────────────────────────────────────────────────── */

/**
 * Escape text for interpolation into HTML markup or an attribute value.
 *
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** @param {*} n @returns {number} */
function num(n) {
  return Number.isFinite(n) ? n : 0;
}

/** `410` becomes `6h50`; sub-hour values become `50m`; nullish becomes an em dash. */
function fmtDur(min) {
  if (min === null || min === undefined || !Number.isFinite(Number(min))) return '—';
  const total = Math.round(Number(min));
  const sign = total < 0 ? '−' : '';
  const abs = Math.abs(total);
  const h = Math.floor(abs / 60);
  const m = abs % 60;
  return h ? `${sign}${h}h${String(m).padStart(2, '0')}` : `${sign}${m}m`;
}

/** Signed duration, e.g. `−1h00` / `+0h20`. */
function fmtSignedDur(min) {
  const total = Math.round(num(min));
  if (total === 0) return '±0h00';
  const abs = Math.abs(total);
  return `${total < 0 ? '−' : '+'}${Math.floor(abs / 60)}h${String(abs % 60).padStart(2, '0')}`;
}

/** Hours as `2h15`. */
function fmtHours(hours) {
  return fmtDur(Math.round(num(hours) * 60));
}

/** `2025-09-12` becomes `Sep 12` without touching Date (no timezone surprises). */
function shortDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  if (!m) return String(date ?? '');
  return `${MONTHS[Number(m[2]) - 1] ?? m[2]} ${Number(m[3])}`;
}

/** `2025-09-13` becomes `Saturday, 13 September`. Computed in UTC, so stable. */
function longDate(date) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(date ?? ''));
  if (!m) return String(date ?? '');
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()] ?? '';
  return `${weekday}, ${d} ${MONTHS_LONG[mo - 1] ?? mo}`;
}

/** Clock string, wrapping past midnight, never null in markup. */
function clock(min) {
  return minutesToClock(min) ?? '—';
}

/** Round to at most `d` decimals and drop a trailing `.0`. */
function round(value, d = 0) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '—';
  const s = n.toFixed(d);
  return d > 0 ? s.replace(/\.0+$/, '') : s;
}

/** `good` / `mid` / `low` class suffix for a recovery score. */
function recoveryTone(score) {
  if (!Number.isFinite(score)) return 'none';
  if (score >= RECOVERY_GREEN_MIN) return 'good';
  if (score >= RECOVERY_YELLOW_MIN) return 'mid';
  return 'low';
}

/** Minutes since wake, wrapped into [0, 1440). */
function sinceWake(min, wakeMin) {
  return (((Math.round(num(min)) - Math.round(num(wakeMin))) % 1440) + 1440) % 1440;
}

/**
 * Greedy word wrap to at most `max` lines of roughly `width` characters. The
 * last line is ellipsised when the text does not fit.
 *
 * @param {string} text
 * @param {number} [width]
 * @param {number} [max]
 * @returns {string[]}
 */
export function wrapText(text, width = ADVICE_WRAP_CHARS, max = 2) {
  const words = String(text ?? '')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return [];
  const lines = [];
  let line = '';
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (candidate.length <= width || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
      if (lines.length === max) break;
    }
  }
  if (lines.length < max && line) lines.push(line);
  if (lines.length === max) {
    // Anything left over is signalled with an ellipsis on the final line.
    const used = lines.join(' ').split(/\s+/).length;
    if (used < words.length) {
      let last = lines[max - 1];
      while (last.length > width - 1 && last.includes(' ')) last = last.slice(0, last.lastIndexOf(' '));
      lines[max - 1] = `${last}…`;
    }
  }
  return lines;
}

/**
 * Catmull-Rom through the points, emitted as cubic beziers, so the curve is
 * smooth without pulling away from the sampled values.
 *
 * @param {{x:number,y:number}[]} pts
 * @returns {string} SVG path data
 */
function smoothPath(pts) {
  if (!pts.length) return '';
  if (pts.length < 3) return `M ${pts.map((p) => `${round(p.x, 1)} ${round(p.y, 1)}`).join(' L ')}`;
  let d = `M ${round(pts[0].x, 1)} ${round(pts[0].y, 1)}`;
  for (let i = 0; i < pts.length - 1; i += 1) {
    const p0 = pts[i - 1] || pts[i];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${round(c1x, 1)} ${round(c1y, 1)}, ${round(c2x, 1)} ${round(c2y, 1)}, ${round(p2.x, 1)} ${round(p2.y, 1)}`;
  }
  return d;
}

/** Straight-line length of a polyline — close enough to seed the draw-in. */
function polylineLength(pts) {
  let total = 0;
  for (let i = 1; i < pts.length; i += 1) {
    total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
  }
  return total;
}

/** Linear interpolation of the 15-minute energy curve at `elapsed` minutes. */
function energyAt(curve, elapsed) {
  if (!curve.length) return 0;
  const idx = num(elapsed) / 15;
  const i0 = Math.max(0, Math.min(curve.length - 1, Math.floor(idx)));
  const i1 = Math.max(0, Math.min(curve.length - 1, i0 + 1));
  const f = Math.max(0, Math.min(1, idx - i0));
  const a = num(curve[i0] && curve[i0].energy);
  const b = num(curve[i1] && curve[i1].energy);
  return a + (b - a) * f;
}

/* ── Inline icons (24 × 24 user units, centred on 12,12) ──────────────────── */

const ICONS = {
  arrow_up_right: '<path class="ic-stroke" d="M7.5 16.5 L16.5 7.5 M9.5 7.5 H16.5 V14.5" />',
  arrow_down_right: '<path class="ic-stroke" d="M7.5 7.5 L16.5 16.5 M16.5 9.5 V16.5 H9.5" />',
  arrow_down: '<path class="ic-stroke" d="M12 6 V17 M6.8 11.8 L12 17 L17.2 11.8" />',
  bolt: '<path class="ic-fill" d="M13.4 2.6 L6 13.2 H10.7 L9.9 21.4 L17.6 10.4 H12.7 Z" />',
  moon: '<path class="ic-fill" d="M16.4 4.2 A8.6 8.6 0 1 0 19.4 15.6 A6.9 6.9 0 0 1 16.4 4.2 Z" />',
  sun:
    '<circle class="ic-fill" cx="12" cy="12" r="3.6" />' +
    '<path class="ic-stroke" d="M12 3.4 V5.6 M12 18.4 V20.6 M3.4 12 H5.6 M18.4 12 H20.6 ' +
    'M5.9 5.9 L7.5 7.5 M16.5 16.5 L18.1 18.1 M18.1 5.9 L16.5 7.5 M7.5 16.5 L5.9 18.1" />',
};

/** Zone kind → icon name, following the reference design. */
const ZONE_ICONS = {
  grogginess: 'arrow_up_right',
  morning_peak: 'bolt',
  afternoon_dip: 'arrow_down_right',
  evening_peak: 'bolt',
  wind_down: 'arrow_down',
  melatonin_window: 'moon',
  sleep: 'moon',
};

/** An icon group translated so its 24×24 box is centred on (cx, cy). */
function icon(name, cx, cy, scale = 1) {
  const body = ICONS[name] || '';
  const t = `translate(${round(cx, 1)} ${round(cy, 1)}) scale(${round(scale, 3)}) translate(-12 -12)`;
  return `<g class="ic" transform="${t}">${body}</g>`;
}

/* ── Hero: the circadian vertical timeline ────────────────────────────────── */

/**
 * The vertical energy timeline. One SVG: guide columns, gridlines, the curve,
 * zone markers and the label column, so both columns line up exactly.
 *
 * @param {object} energyDay
 * @returns {string}
 */
function renderTimeline(energyDay) {
  const T = TIMELINE;
  const curve = Array.isArray(energyDay.curve) ? energyDay.curve : [];
  const wakeMin = num(energyDay.wakeMin);
  const maxElapsed = Math.max(60, (curve.length - 1) * 15);

  // The hero covers wake → target bedtime only; the overnight stretch is
  // implied by the curve arriving at the moon.
  let span = sinceWake(energyDay.targetBedtimeMin, wakeMin);
  if (!Number.isFinite(span) || span < 180) span = Math.min(960, maxElapsed);
  span = Math.min(span, maxElapsed);

  const xOfEnergy = (e) => T.xLow + (Math.max(0, Math.min(100, num(e))) / 100) * (T.xHigh - T.xLow);
  const yOf = (elapsed) => T.padTop + (Math.max(0, num(elapsed)) / 60) * T.hourHeight;

  // ── curve path ──────────────────────────────────────────────────────────
  const pts = [];
  for (let e = 0; e <= span; e += 15) pts.push({ x: xOfEnergy(energyAt(curve, e)), y: yOf(e) });
  if (pts.length && span % 15 !== 0) pts.push({ x: xOfEnergy(energyAt(curve, span)), y: yOf(span) });
  const path = smoothPath(pts);
  const pathLen = Math.round(polylineLength(pts) * 1.02) + 40;

  // ── zone markers ────────────────────────────────────────────────────────
  const zones = Array.isArray(energyDay.zones) ? energyDay.zones : [];
  const markers = zones
    .filter((z) => z && z.kind !== 'sleep')
    .map((zone) => {
      const startE = sinceWake(zone.startMin, wakeMin);
      let endE = sinceWake(zone.endMin, wakeMin);
      if (endE <= startE) endE += 1440;
      // Keep markers clear of the sun and moon endpoints, and recompute x from
      // the clamped time so the marker still sits on the curve.
      const clearance = (T.endpointClearance / T.hourHeight) * 60;
      const midE = Math.max(
        Math.min(clearance, span / 2),
        Math.min(Math.max(span - clearance, span / 2), (startE + endE) / 2),
      );
      return {
        kind: String(zone.kind || ''),
        title: ZONE_KIND_LABELS[zone.kind] || String(zone.label || zone.kind || ''),
        range: `${clock(zone.startMin)} – ${clock(zone.endMin)}`,
        advice: String(zone.advice || ''),
        y: yOf(midE),
        x: xOfEnergy(energyAt(curve, midE)),
        peak: PEAK_KINDS.has(zone.kind),
      };
    })
    .sort((a, b) => a.y - b.y);

  // ── label rows: one-pass downward collision resolver ────────────────────
  let cursor = -Infinity;
  for (const m of markers) {
    const wanted = m.y - 30;
    m.rowTop = Math.max(wanted, cursor);
    m.moved = m.rowTop - wanted;
    cursor = m.rowTop + T.rowHeight;
  }

  const timelineBottom = yOf(span);
  const labelBottom = markers.length ? markers[markers.length - 1].rowTop + T.rowHeight : 0;
  const height = Math.round(Math.max(timelineBottom + T.padBottom, labelBottom + 32));

  // ── guides and gridlines ────────────────────────────────────────────────
  const gridX0 = T.xLow - 16;
  const gridX1 = T.xHigh + 28;
  const grid = [];
  for (let h = 0; h * 60 <= span; h += GRID_STEP_HOURS) {
    const y = round(yOf(h * 60), 1);
    grid.push(`        <line class="tl-grid" x1="${gridX0}" y1="${y}" x2="${gridX1}" y2="${y}" />`);
  }
  const columns = [
    ['SLEEP', T.xLow],
    ['DIP', T.xMid],
    ['PEAK', T.xHigh],
  ]
    .map(
      ([name, x]) =>
        `        <line class="tl-guide" x1="${x}" y1="${round(yOf(0), 1)}" x2="${x}" y2="${round(
          timelineBottom,
          1,
        )}" />
        <text class="tl-col" x="${x}" y="${T.padTop - 58}" text-anchor="middle">${escapeHtml(name)}</text>`,
    )
    .join('\n');

  // ── endpoints ───────────────────────────────────────────────────────────
  const sunX = xOfEnergy(energyAt(curve, 0));
  const moonX = xOfEnergy(energyAt(curve, span));
  const endpoints = `        <g class="tl-endpoint">
          <circle class="tl-sun" cx="${round(sunX, 1)}" cy="${round(yOf(0), 1)}" r="${T.endpointR}" />
          ${icon('sun', sunX, yOf(0), 0.95)}
        </g>
        <g class="tl-endpoint">
          <circle class="tl-moon" cx="${round(moonX, 1)}" cy="${round(timelineBottom, 1)}" r="${T.endpointR}" />
          ${icon('moon', moonX, timelineBottom, 0.85)}
        </g>
        <text class="tl-edge" x="${round(sunX, 1)}" y="${round(yOf(0) - T.endpointR - 10, 1)}" text-anchor="middle">${escapeHtml(
          clock(energyDay.wakeMin),
        )} wake</text>
        <text class="tl-edge" x="${round(moonX, 1)}" y="${round(
          timelineBottom + T.endpointR + 20,
          1,
        )}" text-anchor="middle">${escapeHtml(clock(energyDay.targetBedtimeMin))} bed</text>`;

  // ── now marker ──────────────────────────────────────────────────────────
  let now = '';
  if (Number.isFinite(energyDay.now) && energyDay.now !== null) {
    const nowE = sinceWake(energyDay.now, wakeMin);
    if (nowE <= span) {
      const ny = round(yOf(nowE), 1);
      now = `        <g class="nowline">
          <line class="now-rule" x1="${gridX0}" y1="${ny}" x2="${gridX1}" y2="${ny}" />
          <rect class="now-chip" x="4" y="${round(yOf(nowE) - 12, 1)}" width="84" height="24" rx="12" />
          <text class="now-text" x="46" y="${round(yOf(nowE) + 4.5, 1)}" text-anchor="middle">NOW ${escapeHtml(
            clock(energyDay.now),
          )}</text>
        </g>`;
    }
  }

  // ── markers + labels ────────────────────────────────────────────────────
  const marks = markers
    .map((m) => {
      const cx = round(m.x, 1);
      const cy = round(m.y, 1);
      const tone = m.peak ? 'peak' : 'blue';
      const connector =
        m.moved > 12
          ? `\n          <path class="tl-connector" d="M ${round(m.x + T.markerR + 4, 1)} ${cy} H ${
              T.labelX - 22
            } V ${round(m.rowTop + 38, 1)} h 12" />`
          : '';
      const adviceLines = wrapText(m.advice)
        .map(
          (line, i) =>
            `<tspan class="tl-advice" x="${T.labelX}" y="${round(m.rowTop + 68 + i * 20, 1)}">${escapeHtml(
              line,
            )}</tspan>`,
        )
        .join('');
      return `        <g class="tl-zone">${connector}
          <circle class="tl-marker tl-${tone}" cx="${cx}" cy="${cy}" r="${T.markerR}" />
          ${icon(ZONE_ICONS[m.kind] || 'bolt', m.x, m.y, 0.92)}
          <text class="tl-label">
            <tspan class="tl-time" x="${T.labelX}" y="${round(m.rowTop + 14, 1)}">${escapeHtml(m.range)}</tspan>
            <tspan class="tl-title" x="${T.labelX}" y="${round(m.rowTop + 44, 1)}">${escapeHtml(m.title)}</tspan>
            ${adviceLines}
          </text>
        </g>`;
    })
    .join('\n');

  return `    <section class="hero" aria-label="Circadian energy levels">
      <div class="head">
        <p class="eyebrow">Today</p>
        <h2>Circadian Energy Levels</h2>
        <p class="hint">Time runs down the page from wake to bed; the curve swings right as energy rises.</p>
      </div>
      <svg class="timeline" viewBox="0 0 ${T.width} ${height}" role="img" aria-label="Energy timeline from ${escapeHtml(
        clock(energyDay.wakeMin),
      )} to ${escapeHtml(clock(energyDay.targetBedtimeMin))}" style="--curve-len:${pathLen}">
        <defs>
          <linearGradient id="energyGradient" gradientUnits="userSpaceOnUse" x1="${T.xLow}" y1="0" x2="${
            T.xHigh
          }" y2="0">
            <stop offset="0" class="stop-low" />
            <stop offset="0.5" class="stop-mid" />
            <stop offset="1" class="stop-peak" />
          </linearGradient>
        </defs>
${grid.join('\n')}
${columns}
        <path class="tl-curve" d="${path}" />
${endpoints}
${now}
${marks}
      </svg>
    </section>`;
}

/* ── Header, tiles, plan, tonight ─────────────────────────────────────────── */

/** Compact top header: wordmark, big date, one-line summary. */
function renderHeader(energyDay) {
  const night = energyDay.lastNight || {};
  const rec = energyDay.recovery || night.recovery || {};
  const summary = [
    Number.isFinite(energyDay.wakeMin) ? `Woke ${clock(energyDay.wakeMin)}` : null,
    Number.isFinite(night.asleepMin)
      ? `${fmtDur(night.asleepMin)} slept of ${fmtDur(night.needTotalMin)} needed`
      : null,
    Number.isFinite(rec.score) ? `Recovery ${Math.round(rec.score)}%` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  return `    <header class="top">
      <p class="wordmark">Whoop Energy</p>
      <h1>${escapeHtml(longDate(energyDay.date))}</h1>
      <p class="summary">${escapeHtml(summary)}</p>
    </header>`;
}

/** Thin recovery ring, drawn as a stroked arc. */
function recoveryRing(score) {
  const tone = recoveryTone(score);
  const r = 21;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, num(score))) / 100;
  return `<svg class="ring" viewBox="0 0 52 52" aria-hidden="true">
          <circle class="ring-track" cx="26" cy="26" r="${r}" />
          <circle class="ring-arc tone-${escapeHtml(tone)}" cx="26" cy="26" r="${r}" stroke-dasharray="${round(
            c * pct,
            1,
          )} ${round(c, 1)}" transform="rotate(-90 26 26)" />
        </svg>`;
}

/** Four quiet stat tiles: sleep debt, recovery, HRV, resting HR. */
function renderTiles(energyDay, insights) {
  const debt = energyDay.debt || {};
  const night = energyDay.lastNight || {};
  const rec = energyDay.recovery || night.recovery || {};
  const ins = (insights && insights.recovery) || {};
  const debtTone = { low: 'good', moderate: 'mid', high: 'low', severe: 'low' }[String(debt.level)] || 'none';
  const hrvDelta = Number.isFinite(ins.hrvDeltaPct)
    ? `${ins.hrvDeltaPct >= 0 ? '+' : '−'}${Math.abs(ins.hrvDeltaPct).toFixed(1)}% vs 7-day`
    : 'rMSSD overnight';
  const rhrSub = Number.isFinite(ins.rhrAvg7d) ? `7-day ${Math.round(ins.rhrAvg7d)} bpm` : 'overnight low';

  const tiles = [
    {
      label: 'Sleep debt',
      value: fmtHours(debt.hours),
      sub: debt.level ? `${debt.level}${debt.trend7d ? ` · ${debt.trend7d}` : ''}` : '',
      tone: debtTone,
      art: '',
    },
    {
      label: 'Recovery',
      value: Number.isFinite(rec.score) ? `${Math.round(rec.score)}%` : '—',
      sub: rec.calibrating ? 'still calibrating' : 'this morning',
      tone: recoveryTone(rec.score),
      art: recoveryRing(rec.score),
    },
    {
      label: 'HRV',
      value: Number.isFinite(rec.hrvMs) ? `${Math.round(rec.hrvMs)}<span class="unit">ms</span>` : '—',
      sub: hrvDelta,
      tone: 'none',
      art: '',
      raw: true,
    },
    {
      label: 'Resting HR',
      value: Number.isFinite(rec.rhr) ? `${Math.round(rec.rhr)}<span class="unit">bpm</span>` : '—',
      sub: rhrSub,
      tone: 'none',
      art: '',
      raw: true,
    },
  ];

  const items = tiles
    .map(
      (t) => `      <div class="tile tone-${escapeHtml(t.tone)}">
        <p class="tile-label">${escapeHtml(t.label)}</p>
        <div class="tile-main">
          <p class="tile-value">${t.raw ? t.value : escapeHtml(t.value)}</p>
          ${t.art}
        </div>
        <p class="tile-sub">${escapeHtml(t.sub || '')}</p>
      </div>`,
    )
    .join('\n');
  return `    <section class="tiles" aria-label="Key numbers">\n${items}\n    </section>`;
}

/** "Your day": time range, activity pill, reason. */
function renderPlan(energyDay) {
  const plan = Array.isArray(energyDay.plan) ? energyDay.plan : [];
  if (!plan.length) return '';
  const rows = plan
    .map((entry) => {
      const activity = String(entry.activity || 'admin');
      return `        <li class="plan-row">
          <span class="plan-time">${escapeHtml(clock(entry.startMin))} – ${escapeHtml(clock(entry.endMin))}</span>
          <span class="pill act act-${escapeHtml(activity)}">${escapeHtml(
            ACTIVITY_LABELS[activity] || activity,
          )}</span>
          <span class="plan-reason">${escapeHtml(entry.reason || '')}</span>
        </li>`;
    })
    .join('\n');
  return `    <section aria-label="Plan for the day">
      <div class="head"><p class="eyebrow">Plan</p><h2>Your day</h2></div>
      <ol class="plan">
${rows}
      </ol>
    </section>`;
}

/** "Tonight": target bedtime and target wake, side by side. */
function renderTonight(energyDay) {
  const sleepZone = (Array.isArray(energyDay.zones) ? energyDay.zones : []).find((z) => z && z.kind === 'sleep');
  const glyph = (name) =>
    `<svg class="glyph" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
  const note = sleepZone && sleepZone.advice ? sleepZone.advice : '';
  return `    <section aria-label="Tonight">
      <div class="head"><p class="eyebrow">Tonight</p><h2>Sleep</h2></div>
      <div class="tonight">
        <div class="tonight-half">
          ${glyph('moon')}
          <div>
            <p class="tonight-label">Target bedtime</p>
            <p class="tonight-value">${escapeHtml(clock(energyDay.targetBedtimeMin))}</p>
          </div>
        </div>
        <div class="tonight-half">
          ${glyph('sun')}
          <div>
            <p class="tonight-label">Target wake</p>
            <p class="tonight-value">${escapeHtml(clock(energyDay.targetWakeMin))}</p>
          </div>
        </div>
      </div>
      ${note ? `<p class="tonight-note">${escapeHtml(note)}</p>` : ''}
    </section>`;
}

/* ── Charts and insights ──────────────────────────────────────────────────── */

/** 14-night sleep-vs-need bars with a need marker and a tinted shortfall. */
function renderDebtBars(insights) {
  const byDay = Array.isArray(insights && insights.debt && insights.debt.byDay) ? insights.debt.byDay : [];
  if (!byDay.length) return '';
  const { x0, x1, y0, y1 } = BARS_PLOT;
  const maxMin = Math.max(...byDay.map((d) => Math.max(num(d.needMin), num(d.asleepMin))), 60);
  const scaleTop = Math.ceil(maxMin / 60) * 60;
  const yOf = (m) => y1 - (Math.max(0, num(m)) / scaleTop) * (y1 - y0);
  const slot = (x1 - x0) / byDay.length;
  const barW = Math.min(26, slot * 0.56);

  const grid = [];
  for (let h = 0; h <= scaleTop / 60; h += 2) {
    const y = yOf(h * 60);
    grid.push(`        <line class="grid" x1="${x0}" y1="${round(y, 1)}" x2="${x1}" y2="${round(y, 1)}" />
        <text class="axis" x="${x0 - 8}" y="${round(y + 4, 1)}" text-anchor="end">${h}h</text>`);
  }

  const bars = byDay
    .map((day, i) => {
      const cx = x0 + slot * (i + 0.5);
      const bx = cx - barW / 2;
      const top = yOf(day.asleepMin);
      const needY = yOf(day.needMin);
      // `deltaMin` is need − asleep (positive = shortfall); shown flipped, so a
      // reader sees −0h39 for a night that came up short.
      const short = num(day.deltaMin) > 0;
      const shortfall = short
        ? `\n          <rect class="shortfall" x="${round(bx, 1)}" y="${round(needY, 1)}" width="${round(
            barW,
            1,
          )}" height="${round(Math.max(1, top - needY), 1)}" rx="3" />`
        : '';
      return `        <g class="bar-group">
          <title>${escapeHtml(shortDate(day.date))}: ${escapeHtml(fmtDur(day.asleepMin))} asleep of ${escapeHtml(
            fmtDur(day.needMin),
          )} needed (${escapeHtml(fmtSignedDur(-num(day.deltaMin)))})</title>${shortfall}
          <rect class="bar${short ? ' bar-short' : ''}" x="${round(bx, 1)}" y="${round(top, 1)}" width="${round(
            barW,
            1,
          )}" height="${round(Math.max(1, y1 - top), 1)}" rx="3" />
          <line class="need-mark" x1="${round(bx - 4, 1)}" y1="${round(needY, 1)}" x2="${round(
            bx + barW + 4,
            1,
          )}" y2="${round(needY, 1)}" />
          <text class="axis bar-date${i % 2 ? ' bar-date-alt' : ''}" x="${round(cx, 1)}" y="${y1 + 20}" text-anchor="middle">${escapeHtml(
            shortDate(day.date),
          )}</text>
        </g>`;
    })
    .join('\n');

  const rows = byDay
    .map(
      (day) =>
        `          <tr><th scope="row">${escapeHtml(shortDate(day.date))}</th><td>${escapeHtml(
          fmtDur(day.asleepMin),
        )}</td><td>${escapeHtml(fmtDur(day.needMin))}</td><td class="${
          num(day.deltaMin) > 0 ? 'neg' : 'pos'
        }">${escapeHtml(fmtSignedDur(-num(day.deltaMin)))}</td></tr>`,
    )
    .join('\n');

  return `    <section aria-label="Sleep versus need">
      <div class="head"><p class="eyebrow">Last ${escapeHtml(String(byDay.length))} nights</p><h2>Sleep vs need</h2>
        <p class="hint">Bars are time asleep; the thin marker is that night's need, and the gap above a short bar is tinted.</p>
      </div>
      <svg class="bars" viewBox="0 0 ${BARS_VIEWBOX.width} ${BARS_VIEWBOX.height}" role="img" aria-label="Time asleep against sleep need for each of the last nights">
${grid.join('\n')}
        <line class="axis-line" x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}" />
${bars}
      </svg>
      <details class="data-table">
        <summary>Show the numbers</summary>
        <table>
          <thead><tr><th scope="col">Night</th><th scope="col">Asleep</th><th scope="col">Need</th><th scope="col">Delta</th></tr></thead>
          <tbody>
${rows}
          </tbody>
        </table>
      </details>
    </section>`;
}

/** One mini sparkline for a per-night series. */
function miniSparkline(title, values, unit, formatValue) {
  const pts = values.filter((v) => Number.isFinite(v));
  if (pts.length < 2) return '';
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const W = 300;
  const H = 60;
  const px = 6;
  const coords = values.map((v, i) => ({
    x: px + (i / Math.max(1, values.length - 1)) * (W - px * 2),
    y: Number.isFinite(v) ? H - 10 - ((v - min) / span) * (H - 22) : null,
  }));
  const usable = coords.filter((c) => c.y !== null);
  const last = usable[usable.length - 1];
  return `        <figure class="mini">
          <figcaption><span class="mini-title">${escapeHtml(title)}</span><span class="mini-last">${escapeHtml(
            formatValue(pts[pts.length - 1]),
          )}${unit === '%' ? '' : ' '}${escapeHtml(unit)}</span></figcaption>
          <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${escapeHtml(title)} per night, from ${escapeHtml(
            formatValue(min),
          )} to ${escapeHtml(formatValue(max))} ${escapeHtml(unit)}">
            <path class="mini-line" d="${smoothPath(usable)}" />
            <circle class="mini-dot" cx="${round(last.x, 1)}" cy="${round(last.y, 1)}" r="3.2" />
          </svg>
          <p class="mini-range"><span>low ${escapeHtml(formatValue(min))}</span><span>high ${escapeHtml(
            formatValue(max),
          )}</span></p>
        </figure>`;
}

/** Recovery / HRV / RHR sparklines built from the raw nights. */
function renderNightTrends(nights) {
  const list = Array.isArray(nights) ? nights.filter((n) => n && n.recovery) : [];
  if (list.length < 2) return '';
  const figures = [
    miniSparkline('Recovery', list.map((n) => Number(n.recovery.score)), '%', (v) => String(Math.round(v))),
    miniSparkline('HRV', list.map((n) => Number(n.recovery.hrvMs)), 'ms', (v) => String(Math.round(v))),
    miniSparkline('Resting HR', list.map((n) => Number(n.recovery.rhr)), 'bpm', (v) => String(Math.round(v))),
  ]
    .filter(Boolean)
    .join('\n');
  if (!figures) return '';
  return `    <section aria-label="Recovery trends">
      <div class="head"><p class="eyebrow">Trend</p><h2>Recovery, HRV and resting heart rate</h2>
        <p class="hint">One point per night, oldest on the left (${escapeHtml(shortDate(list[0].date))} to ${escapeHtml(
          shortDate(list[list.length - 1].date),
        )}).</p>
      </div>
      <div class="minis">
${figures}
      </div>
    </section>`;
}

/** Consistency / quality / recovery as a two-column definition list. */
function renderInsightsSummary(insights) {
  if (!insights) return '';
  const c = insights.consistency || {};
  const q = insights.quality || {};
  const r = insights.recovery || {};
  const rows = [
    ['Window', `${num(insights.windowDays)} days · ${num(insights.nights)} scored nights`],
    [
      'Consistency',
      `bedtime ±${Math.round(num(c.bedtimeSdMin))} min · wake ±${Math.round(num(c.wakeSdMin))} min${
        Number.isFinite(c.whoopConsistencyAvg) ? ` · WHOOP ${Math.round(c.whoopConsistencyAvg)}%` : ''
      }`,
    ],
    [
      'Quality',
      [
        Number.isFinite(q.efficiencyAvg) ? `efficiency ${Math.round(q.efficiencyAvg)}%` : null,
        Number.isFinite(q.performanceAvg) ? `performance ${Math.round(q.performanceAvg)}%` : null,
        Number.isFinite(q.swsPctAvg) ? `SWS ${Math.round(q.swsPctAvg)}%` : null,
        Number.isFinite(q.remPctAvg) ? `REM ${Math.round(q.remPctAvg)}%` : null,
        Number.isFinite(q.disturbancesAvg) ? `${q.disturbancesAvg.toFixed(1)} disturbances/night` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ],
    [
      'Recovery',
      [
        Number.isFinite(r.avg) ? `average ${Math.round(r.avg)}% (7-day ${Math.round(num(r.avg7d))}%)` : null,
        Number.isFinite(r.hrvAvg)
          ? `HRV ${Math.round(r.hrvAvg)} ms (7-day ${Math.round(num(r.hrvAvg7d))} ms, ${
              num(r.hrvDeltaPct) >= 0 ? '+' : '−'
            }${Math.abs(num(r.hrvDeltaPct)).toFixed(1)}%)`
          : null,
        Number.isFinite(r.rhrAvg) ? `RHR ${Math.round(r.rhrAvg)} bpm (7-day ${Math.round(num(r.rhrAvg7d))} bpm)` : null,
      ]
        .filter(Boolean)
        .join(' · '),
    ],
  ]
    .map(([k, v]) => `        <div class="dl-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`)
    .join('\n');
  return `    <section aria-label="Window summary">
      <div class="head"><p class="eyebrow">Insights</p><h2>Last ${escapeHtml(
        String(num(insights.windowDays)),
      )} days</h2></div>
      <dl class="dl">
${rows}
      </dl>
    </section>`;
}

/** Correlations, as plain sentences. */
function renderCorrelations(insights) {
  const items = Array.isArray(insights && insights.correlations) ? insights.correlations : [];
  if (!items.length) return '';
  const rows = items
    .map((c) => {
      const r = Number(c.r);
      return `        <li class="corr">
          <p class="corr-pair">${escapeHtml(c.x)} <span class="corr-vs">vs</span> ${escapeHtml(c.y)}
            <span class="corr-r">r ${escapeHtml(Number.isFinite(r) ? r.toFixed(2) : '—')} · n ${escapeHtml(
              String(num(c.n)),
            )}</span></p>
          <p class="corr-reading">${escapeHtml(c.reading || '')}</p>
        </li>`;
    })
    .join('\n');
  return `    <section aria-label="Correlations">
      <div class="head"><p class="eyebrow">Insights</p><h2>What moves with what</h2>
        <p class="hint">Pearson correlation across the window; only associations worth a second look are listed.</p>
      </div>
      <ul class="corrs">
${rows}
      </ul>
    </section>`;
}

/** Ranked recommendations as cards. */
function renderRecommendations(insights) {
  const items = Array.isArray(insights && insights.recommendations) ? insights.recommendations : [];
  if (!items.length) return '';
  const cards = items
    .map((rec, i) => {
      const impact = String(rec.impact || 'medium');
      return `        <li class="rec">
          <div class="rec-head">
            <span class="rec-rank">${escapeHtml(String(Number.isFinite(rec.rank) ? rec.rank : i + 1))}</span>
            <h3>${escapeHtml(rec.title || '')}</h3>
            <span class="pill impact impact-${escapeHtml(impact)}">${escapeHtml(impact)} impact</span>
          </div>
          <p class="rec-why">${escapeHtml(rec.why || '')}</p>
          <p class="rec-action">${escapeHtml(rec.action || '')}</p>
        </li>`;
    })
    .join('\n');
  return `    <section aria-label="Recommendations">
      <div class="head"><p class="eyebrow">Insights</p><h2>What to optimize</h2></div>
      <ul class="recs">
${cards}
      </ul>
    </section>`;
}

/* ── Styles ───────────────────────────────────────────────────────────────── */

const STYLES = `    :root {
      color-scheme: dark;
      --bg: #0A0C11;
      --surface: #141822;
      --surface-2: #1B2030;
      --text: #F3F5F9;
      --muted: #8E96A8;
      --line: rgba(255, 255, 255, 0.08);
      --peak: #FF9B3D;
      --mid: #3FCF8E;
      --low: #4C7DFF;
      --marker-blue: #3D7BFF;
      --night: #5B4BE6;
      --good: #3FCF8E;
      --warn: #F5B942;
      --bad: #FF6B6B;
      --on-marker: #FFFFFF;
      --display: "Sora", "Segoe UI", system-ui, sans-serif;
      --body: "Manrope", system-ui, sans-serif;
    }
    @media (prefers-color-scheme: light) {
      :root:not([data-theme="dark"]) {
        color-scheme: light;
        --bg: #F6F7FB;
        --surface: #FFFFFF;
        --surface-2: #EEF1F7;
        --text: #121622;
        --muted: #5C6577;
        --line: rgba(10, 12, 17, 0.08);
        --peak: #E8832A;
        --mid: #22A86E;
        --low: #3566E0;
        --marker-blue: #3566E0;
        --night: #4A3BCB;
        --good: #22A86E;
        --warn: #C98A0E;
        --bad: #D9453F;
      }
    }
    :root[data-theme="light"] {
      color-scheme: light;
      --bg: #F6F7FB;
      --surface: #FFFFFF;
      --surface-2: #EEF1F7;
      --text: #121622;
      --muted: #5C6577;
      --line: rgba(10, 12, 17, 0.08);
      --peak: #E8832A;
      --mid: #22A86E;
      --low: #3566E0;
      --marker-blue: #3566E0;
      --night: #4A3BCB;
      --good: #22A86E;
      --warn: #C98A0E;
      --bad: #D9453F;
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: var(--body);
      font-size: 15px;
      line-height: 1.55;
      font-variant-numeric: tabular-nums;
      -webkit-text-size-adjust: 100%;
      -webkit-font-smoothing: antialiased;
    }
    .wrap { max-width: 760px; margin: 0 auto; padding-block: 36px 56px; padding-inline: 20px; }
    section { margin-top: 48px; }
    .head { margin-bottom: 18px; }
    .eyebrow {
      margin: 0 0 4px; color: var(--muted);
      font-size: 0.68rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.16em;
    }
    h1 { font-family: var(--display); font-size: 2.1rem; font-weight: 700; line-height: 1.15; margin: 2px 0 6px; letter-spacing: -0.02em; }
    h2 { font-family: var(--display); font-size: 1.3rem; font-weight: 600; margin: 0; letter-spacing: -0.01em; }
    h3 { font-family: var(--display); font-size: 1rem; font-weight: 600; margin: 0; }
    .hint { margin: 8px 0 0; color: var(--muted); font-size: 0.84rem; max-width: 52ch; }
    .top { margin-top: 0; }
    .wordmark {
      margin: 0; color: var(--muted);
      font-family: var(--display); font-size: 0.72rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.2em;
    }
    .summary { margin: 0; color: var(--muted); font-size: 0.95rem; }

    /* ── timeline hero ─────────────────────────────────────────────── */
    .hero { margin-top: 36px; }
    .timeline { display: block; width: 100%; height: auto; margin-top: 4px; }
    .timeline text { font-family: var(--body); }
    .tl-grid { stroke: var(--line); stroke-width: 1; }
    .tl-guide { stroke: var(--line); stroke-width: 1.5; }
    .tl-col {
      fill: var(--muted); font-family: var(--display); font-size: 14px;
      font-weight: 600; letter-spacing: 1.6px;
    }
    .stop-low { stop-color: var(--low); }
    .stop-mid { stop-color: var(--mid); }
    .stop-peak { stop-color: var(--peak); }
    .tl-curve {
      fill: none; stroke: url(#energyGradient); stroke-width: 6;
      stroke-linecap: round; stroke-linejoin: round;
    }
    .tl-sun, .tl-moon, .tl-marker { stroke: var(--bg); stroke-width: 3; }
    .tl-sun { fill: var(--marker-blue); }
    .tl-moon { fill: var(--night); }
    .tl-marker.tl-peak { fill: var(--peak); }
    .tl-marker.tl-blue { fill: var(--marker-blue); }
    .ic-stroke { fill: none; stroke: var(--on-marker); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .ic-fill { fill: var(--on-marker); }
    .tl-connector { fill: none; stroke: var(--line); stroke-width: 1.5; }
    .tl-time { fill: var(--muted); font-size: 17px; }
    .tl-title { fill: var(--text); font-family: var(--display); font-size: 24px; font-weight: 600; }
    .tl-advice { fill: var(--muted); font-size: 16px; }
    .tl-edge { fill: var(--muted); font-size: 13px; letter-spacing: 0.02em; }
    .now-rule { stroke: var(--text); stroke-width: 1.2; stroke-dasharray: 4 5; opacity: 0.55; }
    .now-chip { fill: var(--surface-2); }
    .now-text { fill: var(--text); font-size: 13px; font-weight: 600; letter-spacing: 1.1px; }

    /* ── tiles ─────────────────────────────────────────────────────── */
    .tiles { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; }
    .tile { background: var(--surface); border-radius: 16px; padding: 16px 16px 14px; }
    .tile-label {
      margin: 0; color: var(--muted); font-size: 0.66rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.13em;
    }
    .tile-main { display: flex; align-items: center; justify-content: space-between; gap: 8px; min-height: 46px; }
    .tile-value {
      margin: 4px 0 0; font-family: var(--display); font-size: 1.7rem; font-weight: 600;
      letter-spacing: -0.02em; line-height: 1.1;
    }
    .tile-value .unit { font-size: 0.9rem; font-weight: 500; color: var(--muted); margin-left: 3px; }
    .tile-sub { margin: 2px 0 0; color: var(--muted); font-size: 0.76rem; }
    .tone-good .tile-value { color: var(--good); }
    .tone-mid .tile-value { color: var(--warn); }
    .tone-low .tile-value { color: var(--bad); }
    .ring { width: 42px; height: 42px; flex: none; }
    .ring-track { fill: none; stroke: var(--surface-2); stroke-width: 4; }
    .ring-arc { fill: none; stroke-width: 4; stroke-linecap: round; stroke: var(--muted); }
    .ring-arc.tone-good { stroke: var(--good); }
    .ring-arc.tone-mid { stroke: var(--warn); }
    .ring-arc.tone-low { stroke: var(--bad); }

    /* ── plan ──────────────────────────────────────────────────────── */
    .plan { list-style: none; margin: 0; padding: 0; }
    .plan-row {
      display: grid; grid-template-columns: 124px 108px 1fr; gap: 14px;
      align-items: baseline; padding: 12px 0; border-top: 1px solid var(--line);
    }
    .plan-row:first-child { border-top: none; }
    .plan-time { color: var(--muted); font-size: 0.9rem; }
    .plan-reason { color: var(--muted); }
    .pill {
      display: inline-block; justify-self: start; border-radius: 999px;
      padding: 2px 10px; font-size: 0.72rem; font-weight: 600;
      letter-spacing: 0.04em; white-space: nowrap;
    }
    .act { color: var(--bg); }
    .act-deep_work { background: var(--peak); }
    .act-workout { background: var(--mid); }
    .act-admin { background: var(--muted); }
    .act-nap { background: var(--night); color: #fff; }
    .act-wind_down { background: var(--low); color: #fff; }
    .act-bed { background: var(--night); color: #fff; }

    /* ── tonight ───────────────────────────────────────────────────── */
    .tonight { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .tonight-half {
      display: flex; align-items: center; gap: 14px;
      background: var(--surface); border-radius: 16px; padding: 16px 18px;
    }
    .glyph { width: 26px; height: 26px; flex: none; }
    .tonight .glyph .ic-fill { fill: var(--low); }
    .tonight .glyph .ic-stroke { stroke: var(--low); }
    .tonight-half:first-child .glyph .ic-fill { fill: var(--night); }
    .tonight-label {
      margin: 0; color: var(--muted); font-size: 0.66rem; font-weight: 600;
      text-transform: uppercase; letter-spacing: 0.13em;
    }
    .tonight-value { margin: 0; font-family: var(--display); font-size: 1.6rem; font-weight: 600; letter-spacing: -0.02em; }
    .tonight-note { margin: 12px 0 0; color: var(--muted); }

    /* ── charts ────────────────────────────────────────────────────── */
    .bars { display: block; width: 100%; height: auto; }
    .bars text, .mini text { font-family: var(--body); }
    .grid { stroke: var(--line); stroke-width: 1; }
    .axis-line { stroke: var(--line); stroke-width: 1; }
    .axis { fill: var(--muted); font-size: 12px; }
    .bar { fill: var(--mid); }
    .bar-short { fill: var(--low); }
    .shortfall { fill: var(--bad); opacity: 0.26; }
    .need-mark { stroke: var(--text); stroke-width: 2; opacity: 0.6; }
    .data-table { margin-top: 14px; font-size: 0.86rem; }
    .data-table summary { cursor: pointer; color: var(--muted); }
    .data-table table { border-collapse: collapse; margin-top: 10px; width: 100%; }
    .data-table th, .data-table td { text-align: right; padding: 5px 8px; border-bottom: 1px solid var(--line); }
    .data-table th[scope="row"] { text-align: left; font-weight: 500; }
    .data-table thead th { color: var(--muted); font-weight: 500; }
    td.neg { color: var(--bad); }
    .minis { display: grid; grid-template-columns: repeat(auto-fit, minmax(210px, 1fr)); gap: 14px; }
    .mini { margin: 0; background: var(--surface); border-radius: 16px; padding: 12px 14px; }
    .mini svg { display: block; width: 100%; height: auto; }
    .mini figcaption { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .mini-title { font-family: var(--display); font-weight: 600; font-size: 0.9rem; }
    .mini-last { color: var(--muted); font-size: 0.82rem; }
    .mini-line { fill: none; stroke: var(--mid); stroke-width: 2.2; stroke-linecap: round; stroke-linejoin: round; }
    .mini-dot { fill: var(--mid); }
    .mini-range { display: flex; justify-content: space-between; margin: 0; color: var(--muted); font-size: 0.74rem; }

    /* ── insights ──────────────────────────────────────────────────── */
    .dl { margin: 0; }
    .dl-row { display: grid; grid-template-columns: 128px 1fr; gap: 14px; padding: 10px 0; border-top: 1px solid var(--line); }
    .dl-row:first-child { border-top: none; }
    .dl dt { color: var(--muted); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.1em; padding-top: 2px; }
    .dl dd { margin: 0; }
    .corrs, .recs { list-style: none; margin: 0; padding: 0; display: grid; gap: 18px; }
    .corr-pair { margin: 0; font-family: var(--display); font-weight: 600; }
    .corr-vs { color: var(--muted); font-weight: 400; }
    .corr-r { color: var(--muted); font-weight: 400; font-size: 0.8rem; margin-left: 6px; white-space: nowrap; }
    .corr-reading { margin: 2px 0 0; color: var(--muted); }
    .rec { background: var(--surface); border-radius: 16px; padding: 16px 18px; }
    .rec-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .rec-rank {
      width: 24px; height: 24px; border-radius: 50%; background: var(--surface-2);
      color: var(--text); display: inline-grid; place-items: center;
      font-family: var(--display); font-size: 0.78rem; font-weight: 700; flex: none;
    }
    .rec-head h3 { flex: 1 1 auto; }
    .impact {
      color: var(--muted); background: none; border: 1px solid var(--line);
      text-transform: uppercase; font-size: 0.64rem; letter-spacing: 0.1em;
    }
    .impact-high { color: var(--peak); }
    .impact-medium { color: var(--mid); }
    .rec-why { margin: 8px 0 0; color: var(--muted); }
    .rec-action { margin: 6px 0 0; font-weight: 600; }
    footer { margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--line); color: var(--muted); font-size: 0.78rem; }

    @media (max-width: 620px) {
      .wrap { padding-block: 26px 40px; }
      h1 { font-size: 1.7rem; }
      .tiles { grid-template-columns: 1fr 1fr; }
      .plan-row { grid-template-columns: 1fr; gap: 4px; }
      .dl-row { grid-template-columns: 1fr; gap: 2px; }
      .tonight { grid-template-columns: 1fr; }
      /* The bars viewBox is 720 wide; at phone width its 12px text lands near
         6px, so scale the type up and thin out the date labels instead of
         putting the chart in a sideways scroller. */
      .axis { font-size: 17px; }
      .bar-date-alt { display: none; }
    }`;

/* ── Document ─────────────────────────────────────────────────────────────── */

/**
 * Render the complete HTML report.
 *
 * @param {object} input
 * @param {object} input.energyDay - an `EnergyDay` (PLAN.md section 4)
 * @param {object|null} [input.insights] - an `Insights`
 * @param {object[]} [input.nights] - `SleepNight[]`, oldest first
 * @param {string} [input.generatedAt] - ISO timestamp shown in the footer
 * @returns {string} a complete HTML document
 */
export function renderHtmlReport({
  energyDay,
  insights = null,
  nights = [],
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!energyDay || typeof energyDay !== 'object') {
    throw new TypeError('renderHtmlReport: energyDay object is required');
  }
  const title = `Whoop Energy — ${String(energyDay.date ?? '')}`;

  const sections = [
    renderHeader(energyDay),
    renderTimeline(energyDay),
    renderTiles(energyDay, insights),
    renderPlan(energyDay),
    renderTonight(energyDay),
    renderDebtBars(insights),
    renderNightTrends(nights),
    renderInsightsSummary(insights),
    renderCorrelations(insights),
    renderRecommendations(insights),
  ].filter(Boolean);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600&amp;family=Sora:wght@500;600;700&amp;display=swap">
<style>
${STYLES}
</style>
</head>
<body>
  <main class="wrap">
${sections.join('\n')}
    <footer>Generated ${escapeHtml(
      generatedAt,
    )} · circadian model from your own WHOOP sleep and recovery records. Heuristic model, not medical advice.</footer>
  </main>
</body>
</html>
`;
}

export default { renderHtmlReport, escapeHtml, wrapText };
