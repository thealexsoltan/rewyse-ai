/**
 * Single-file HTML report for Whoop Energy.
 *
 * The output is a complete document with inline CSS and inline SVG only: no
 * external stylesheets, fonts, images or script libraries, so the file works
 * offline and can be mailed around as one attachment. A tiny inline script
 * adds a hover read-out on the energy curve; every number is also present in
 * the markup, so the page is fully readable with scripting disabled.
 *
 * @module report/html
 */

import { minutesToClock } from './json.js';

/** Energy-curve SVG geometry (user units inside `viewBox="0 0 960 260"`). */
export const CURVE_VIEWBOX = { width: 960, height: 260 };
const CURVE_PLOT = { x0: 46, x1: 944, y0: 34, y1: 218 };

/** Sleep-vs-need SVG geometry. */
export const BARS_VIEWBOX = { width: 960, height: 240 };
const BARS_PLOT = { x0: 46, x1: 944, y0: 28, y1: 190 };

/** Minutes covered by the energy curve (wake to wake + 24 h). */
export const CURVE_SPAN_MIN = 1440;

/** Hours between labels on the energy-curve x axis. */
export const AXIS_LABEL_STEP_HOURS = 3;

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

/** Human labels for `zones[].kind`. */
export const ZONE_KIND_LABELS = {
  grogginess: 'Grogginess',
  morning_peak: 'Morning peak',
  afternoon_dip: 'Afternoon dip',
  evening_peak: 'Evening peak',
  wind_down: 'Wind-down',
  melatonin_window: 'Melatonin window',
  sleep: 'Sleep',
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

/* ── Sections ─────────────────────────────────────────────────────────────── */

/** Stat tiles row. */
function renderTiles(energyDay) {
  const debt = energyDay.debt || {};
  const rec = energyDay.recovery || (energyDay.lastNight && energyDay.lastNight.recovery) || {};
  const night = energyDay.lastNight || {};
  const tiles = [
    {
      label: 'Sleep debt',
      value: fmtHours(debt.hours),
      sub: [debt.level, debt.trend7d ? `${debt.trend7d} vs last week` : null].filter(Boolean).join(' · '),
      tone: null,
    },
    {
      label: 'Recovery',
      value: Number.isFinite(rec.score) ? `${Math.round(rec.score)}%` : '—',
      sub: rec.calibrating ? 'still calibrating' : 'this morning',
      tone: recoveryTone(rec.score),
    },
    {
      label: 'HRV',
      value: Number.isFinite(rec.hrvMs) ? `${Math.round(rec.hrvMs)} ms` : '—',
      sub: 'rMSSD overnight',
      tone: null,
    },
    {
      label: 'Resting HR',
      value: Number.isFinite(rec.rhr) ? `${Math.round(rec.rhr)} bpm` : '—',
      sub: 'overnight low',
      tone: null,
    },
    {
      label: 'Last night',
      value: fmtDur(night.asleepMin),
      sub: `asleep of ${fmtDur(night.needTotalMin)} needed`,
      tone: null,
    },
    {
      label: 'Efficiency',
      value: Number.isFinite(night.efficiencyPct) ? `${Math.round(night.efficiencyPct)}%` : '—',
      sub: Number.isFinite(night.inBedMin) ? `${fmtDur(night.inBedMin)} in bed` : 'asleep vs in bed',
      tone: null,
    },
  ];
  const items = tiles
    .map(
      (t) => `      <div class="tile${t.tone ? ` tone-${t.tone}` : ''}">
        <div class="tile-label">${escapeHtml(t.label)}</div>
        <div class="tile-value">${escapeHtml(t.value)}</div>
        <div class="tile-sub">${escapeHtml(t.sub || '')}</div>
      </div>`,
    )
    .join('\n');
  return `    <section class="tiles" aria-label="Key numbers">\n${items}\n    </section>`;
}

/** The energy curve, as inline SVG. */
function renderCurve(energyDay) {
  const curve = Array.isArray(energyDay.curve) ? energyDay.curve : [];
  const wakeMin = num(energyDay.wakeMin);
  const { x0, x1, y0, y1 } = CURVE_PLOT;
  const xOfElapsed = (e) => x0 + (Math.max(0, Math.min(CURVE_SPAN_MIN, e)) / CURVE_SPAN_MIN) * (x1 - x0);
  const xOfMin = (min) => xOfElapsed(sinceWake(min, wakeMin));
  const yOfEnergy = (e) => y1 - (Math.max(0, Math.min(100, num(e))) / 100) * (y1 - y0);

  const pts = curve.map((p, i) => ({ x: xOfElapsed(i * 15), y: yOfEnergy(p && p.energy) }));
  const line = smoothPath(pts);
  const area = pts.length ? `${line} L ${round(pts[pts.length - 1].x, 1)} ${y1} L ${round(pts[0].x, 1)} ${y1} Z` : '';

  // Translucent zone bands with a label along the top.
  const zones = Array.isArray(energyDay.zones) ? energyDay.zones : [];
  const bands = zones
    .map((zone) => {
      const startE = sinceWake(zone.startMin, wakeMin);
      let endE = sinceWake(zone.endMin, wakeMin);
      if (endE <= startE) endE += 1440;
      const bx = xOfElapsed(startE);
      const bw = Math.max(1, xOfElapsed(endE) - bx);
      const label = String(zone.label || ZONE_KIND_LABELS[zone.kind] || zone.kind || '');
      const kind = escapeHtml(zone.kind || 'sleep');
      const text =
        bw >= 62
          ? `\n        <text class="band-label" x="${round(bx + bw / 2, 1)}" y="24" text-anchor="middle">${escapeHtml(
              label.length > Math.floor(bw / 6.2) ? `${label.slice(0, Math.max(3, Math.floor(bw / 6.2) - 1))}…` : label,
            )}</text>`
          : '';
      return `        <rect class="band band-${kind}" x="${round(bx, 1)}" y="${y0 - 16}" width="${round(bw, 1)}" height="${
        y1 - y0 + 16
      }" rx="3"><title>${escapeHtml(label)} ${escapeHtml(clock(zone.startMin))}-${escapeHtml(
        clock(zone.endMin),
      )}</title></rect>${text}`;
    })
    .join('\n');

  // Y grid.
  const grid = [0, 25, 50, 75, 100]
    .map((v) => {
      const y = yOfEnergy(v);
      return `        <line class="grid" x1="${x0}" y1="${round(y, 1)}" x2="${x1}" y2="${round(y, 1)}" />
        <text class="axis" x="${x0 - 8}" y="${round(y + 4, 1)}" text-anchor="end">${v}</text>`;
    })
    .join('\n');

  // X axis: hour ticks every 3 h from wake, wrapping past midnight.
  const ticks = [];
  for (let h = 0; h <= 24; h += AXIS_LABEL_STEP_HOURS) {
    const x = xOfElapsed(h * 60);
    ticks.push(`        <line class="tick" x1="${round(x, 1)}" y1="${y1}" x2="${round(x, 1)}" y2="${y1 + 6}" />
        <text class="axis" x="${round(x, 1)}" y="${y1 + 20}" text-anchor="middle">${escapeHtml(
          clock(wakeMin + h * 60),
        )}</text>`);
  }

  // Markers: melatonin window bracket, target bedtime, now.
  const markers = [];
  const melatonin = zones.find((z) => z.kind === 'melatonin_window');
  if (melatonin) {
    const mx0 = xOfMin(melatonin.startMin);
    const mx1 = xOfMin(melatonin.endMin);
    markers.push(`        <rect class="melatonin" x="${round(mx0, 1)}" y="${y0 - 16}" width="${round(
      Math.max(2, mx1 - mx0),
      1,
    )}" height="${y1 - y0 + 16}" rx="3" />
        <text class="marker-label" x="${round((mx0 + mx1) / 2, 1)}" y="${y1 + 34}" text-anchor="middle">melatonin</text>`);
  }
  if (Number.isFinite(energyDay.targetBedtimeMin)) {
    const bx = xOfMin(energyDay.targetBedtimeMin);
    markers.push(`        <line class="bedline" x1="${round(bx, 1)}" y1="${y0 - 16}" x2="${round(bx, 1)}" y2="${y1}" />
        <text class="marker-label" x="${round(bx, 1)}" y="${y0 - 22}" text-anchor="middle">bed ${escapeHtml(
          clock(energyDay.targetBedtimeMin),
        )}</text>`);
  }
  if (Number.isFinite(energyDay.now) && energyDay.now !== null) {
    const nx = xOfMin(energyDay.now);
    markers.push(`        <line class="nowline" x1="${round(nx, 1)}" y1="${y0 - 16}" x2="${round(nx, 1)}" y2="${
      y1 + 4
    }" />
        <text class="marker-label now" x="${round(nx, 1)}" y="${y0 - 22}" text-anchor="middle">now ${escapeHtml(
          clock(energyDay.now),
        )}</text>`);
  }

  return `    <section class="card" aria-label="Energy curve">
      <div class="card-head"><h2>Energy through the day</h2><p class="hint">From wake at ${escapeHtml(
        clock(wakeMin),
      )} to wake tomorrow. 0-100 is relative to your own waking range.</p></div>
      <div class="chart-wrap">
        <svg id="energy-svg" class="chart" viewBox="0 0 ${CURVE_VIEWBOX.width} ${CURVE_VIEWBOX.height}" width="100%" role="img" aria-label="Predicted energy for the day">
${bands}
${grid}
${ticks.join('\n')}
        <path class="curve-area" d="${area}" />
        <path class="curve-line" d="${line}" />
${markers.join('\n')}
        </svg>
        <div id="energy-tip" class="tip" hidden></div>
      </div>
    </section>`;
}

/** Zones list with advice. */
function renderZones(energyDay) {
  const zones = Array.isArray(energyDay.zones) ? energyDay.zones : [];
  if (!zones.length) return '';
  const rows = zones
    .map((zone) => {
      const label = String(zone.label || ZONE_KIND_LABELS[zone.kind] || zone.kind || '');
      return `        <li class="zone zone-${escapeHtml(zone.kind || 'sleep')}">
          <span class="zone-time">${escapeHtml(clock(zone.startMin))}–${escapeHtml(clock(zone.endMin))}</span>
          <span class="zone-name">${escapeHtml(label)}</span>
          <span class="zone-advice">${escapeHtml(zone.advice || '')}</span>
        </li>`;
    })
    .join('\n');
  return `    <section class="card" aria-label="Energy zones">
      <div class="card-head"><h2>Zones</h2></div>
      <ul class="zones">
${rows}
      </ul>
    </section>`;
}

/** "Your day" plan as a timeline list. */
function renderPlan(energyDay) {
  const plan = Array.isArray(energyDay.plan) ? energyDay.plan : [];
  if (!plan.length) return '';
  const rows = plan
    .map(
      (entry) => `        <li class="step step-${escapeHtml(entry.activity || 'admin')}">
          <span class="step-time">${escapeHtml(clock(entry.startMin))}–${escapeHtml(clock(entry.endMin))}</span>
          <span class="step-body">
            <span class="step-name">${escapeHtml(ACTIVITY_LABELS[entry.activity] || entry.activity || '')}</span>
            <span class="step-reason">${escapeHtml(entry.reason || '')}</span>
          </span>
        </li>`,
    )
    .join('\n');
  return `    <section class="card" aria-label="Plan for the day">
      <div class="card-head"><h2>Your day</h2><p class="hint">Target bedtime ${escapeHtml(
        clock(energyDay.targetBedtimeMin),
      )} · target wake ${escapeHtml(clock(energyDay.targetWakeMin))}</p></div>
      <ol class="timeline">
${rows}
      </ol>
    </section>`;
}

/** 14-day sleep-vs-need bar chart. */
function renderDebtBars(insights) {
  const byDay = Array.isArray(insights && insights.debt && insights.debt.byDay)
    ? insights.debt.byDay
    : [];
  if (!byDay.length) return '';
  const { x0, x1, y0, y1 } = BARS_PLOT;
  const maxMin = Math.max(...byDay.map((d) => Math.max(num(d.needMin), num(d.asleepMin))), 60);
  const scaleTop = Math.ceil(maxMin / 60) * 60;
  const yOf = (m) => y1 - (Math.max(0, num(m)) / scaleTop) * (y1 - y0);
  const slot = (x1 - x0) / byDay.length;
  const barW = Math.min(38, slot * 0.62);

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
      const short = num(day.deltaMin) < 0;
      return `        <g class="bar-group">
          <title>${escapeHtml(shortDate(day.date))}: ${escapeHtml(fmtDur(day.asleepMin))} asleep of ${escapeHtml(
            fmtDur(day.needMin),
          )} needed (${escapeHtml(fmtSignedDur(day.deltaMin))})</title>
          <rect class="bar${short ? ' bar-short' : ''}" x="${round(bx, 1)}" y="${round(top, 1)}" width="${round(
            barW,
            1,
          )}" height="${round(Math.max(1, y1 - top), 1)}" rx="3" />
          <line class="need-mark" x1="${round(bx - 3, 1)}" y1="${round(needY, 1)}" x2="${round(
            bx + barW + 3,
            1,
          )}" y2="${round(needY, 1)}" />
          <text class="bar-delta${short ? ' short' : ''}" x="${round(cx, 1)}" y="${round(
            Math.min(top, needY) - 7,
            1,
          )}" text-anchor="middle">${escapeHtml(fmtSignedDur(day.deltaMin))}</text>
          <text class="axis" x="${round(cx, 1)}" y="${y1 + 18}" text-anchor="middle">${escapeHtml(
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
          num(day.deltaMin) < 0 ? 'neg' : 'pos'
        }">${escapeHtml(fmtSignedDur(day.deltaMin))}</td></tr>`,
    )
    .join('\n');

  return `    <section class="card" aria-label="Sleep versus need">
      <div class="card-head"><h2>Sleep vs need</h2><p class="hint">Bars are time asleep; the thin marker is that night's need. Shortfalls are highlighted.</p></div>
      <svg class="chart" viewBox="0 0 ${BARS_VIEWBOX.width} ${BARS_VIEWBOX.height}" width="100%" role="img" aria-label="Time asleep against sleep need for each of the last nights">
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
  const H = 64;
  const px = 6;
  const coords = values.map((v, i) => ({
    x: px + (i / Math.max(1, values.length - 1)) * (W - px * 2),
    y: Number.isFinite(v) ? H - 12 - ((v - min) / span) * (H - 26) : null,
  }));
  const usable = coords.filter((c) => c.y !== null);
  const path = smoothPath(usable);
  const last = usable[usable.length - 1];
  return `        <figure class="mini">
          <figcaption><span class="mini-title">${escapeHtml(title)}</span><span class="mini-last">${escapeHtml(
            formatValue(pts[pts.length - 1]),
          )}${unit === '%' ? '' : ' '}${escapeHtml(unit)}</span></figcaption>
          <svg class="chart" viewBox="0 0 ${W} ${H}" width="100%" role="img" aria-label="${escapeHtml(
            title,
          )} per night, from ${escapeHtml(formatValue(min))} to ${escapeHtml(formatValue(max))} ${escapeHtml(unit)}">
            <path class="mini-line" d="${path}" />
            <circle class="mini-dot" cx="${round(last.x, 1)}" cy="${round(last.y, 1)}" r="3.2" />
          </svg>
          <div class="mini-range"><span>low ${escapeHtml(formatValue(min))}</span><span>high ${escapeHtml(
            formatValue(max),
          )}</span></div>
        </figure>`;
}

/** Recovery / HRV / RHR mini sparklines built from the raw nights. */
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
  return `    <section class="card" aria-label="Recovery trends">
      <div class="card-head"><h2>Recovery, HRV and resting heart rate</h2><p class="hint">One point per night, oldest on the left (${escapeHtml(
        shortDate(list[0].date),
      )} to ${escapeHtml(shortDate(list[list.length - 1].date))}).</p></div>
      <div class="minis">
${figures}
      </div>
    </section>`;
}

/** Correlations, each with a magnitude bar. */
function renderCorrelations(insights) {
  const items = Array.isArray(insights && insights.correlations) ? insights.correlations : [];
  if (!items.length) return '';
  const rows = items
    .map((c) => {
      const r = Number(c.r);
      const pct = Math.min(100, Math.abs(Number.isFinite(r) ? r : 0) * 100);
      return `        <li class="corr">
          <div class="corr-head"><span class="corr-pair">${escapeHtml(c.x)} <span class="corr-vs">vs</span> ${escapeHtml(
            c.y,
          )}</span><span class="corr-r">r = ${escapeHtml(Number.isFinite(r) ? r.toFixed(2) : '—')} · n = ${escapeHtml(
            String(num(c.n)),
          )}</span></div>
          <div class="corr-bar"><span class="corr-fill${r < 0 ? ' neg' : ''}" style="width:${round(
            pct,
            0,
          )}%"></span></div>
          <p class="corr-reading">${escapeHtml(c.reading || '')}</p>
        </li>`;
    })
    .join('\n');
  return `    <section class="card" aria-label="Correlations">
      <div class="card-head"><h2>What moves with what</h2><p class="hint">Pearson correlation across the window; only associations worth a second look are listed.</p></div>
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
      return `        <li class="rec impact-${escapeHtml(impact)}">
          <div class="rec-head">
            <span class="rec-rank">${escapeHtml(String(Number.isFinite(rec.rank) ? rec.rank : i + 1))}</span>
            <h3>${escapeHtml(rec.title || '')}</h3>
            <span class="pill">${escapeHtml(impact)} impact</span>
          </div>
          <p class="rec-why">${escapeHtml(rec.why || '')}</p>
          <p class="rec-action">${escapeHtml(rec.action || '')}</p>
        </li>`;
    })
    .join('\n');
  return `    <section class="card" aria-label="Recommendations">
      <div class="card-head"><h2>What to optimize</h2></div>
      <ul class="recs">
${cards}
      </ul>
    </section>`;
}

/** Window summary strip for the insights half of the report. */
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
      'Trends',
      [
        Number.isFinite(r.avg) ? `recovery ${Math.round(r.avg)}% (7-day ${Math.round(num(r.avg7d))}%)` : null,
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
    .map(
      ([k, v]) =>
        `        <div class="summary-row"><dt>${escapeHtml(k)}</dt><dd>${escapeHtml(v)}</dd></div>`,
    )
    .join('\n');
  return `    <section class="card" aria-label="Window summary">
      <div class="card-head"><h2>Last ${escapeHtml(String(num(insights.windowDays)))} days</h2></div>
      <dl class="summary">
${rows}
      </dl>
    </section>`;
}

/* ── Styles and script ────────────────────────────────────────────────────── */

const STYLES = `    :root {
      color-scheme: light dark;
      --bg: #f5f6f8;
      --surface: #ffffff;
      --surface-2: #f0f2f5;
      --text: #14171c;
      --muted: #5c6472;
      --border: #dfe3e9;
      --accent: #1f6f8b;
      --accent-soft: rgba(31, 111, 139, 0.14);
      --shortfall: #9c5b4a;
      --good: #2f7d55;
      --mid: #a86a12;
      --low: #b03a2e;
      --z-grogginess: #7b8494;
      --z-morning_peak: #3f6fb5;
      --z-afternoon_dip: #8d7fae;
      --z-evening_peak: #2f8a86;
      --z-wind_down: #6a6f96;
      --z-melatonin_window: #5c4f86;
      --z-sleep: #4a5260;
      --band-alpha: 0.13;
    }
    @media (prefers-color-scheme: dark) {
      :root {
        --bg: #0f1216;
        --surface: #171b21;
        --surface-2: #1e232a;
        --text: #e8ebf0;
        --muted: #9aa3b1;
        --border: #2a313a;
        --accent: #6bc0dc;
        --accent-soft: rgba(107, 192, 220, 0.16);
        --shortfall: #d08a76;
        --good: #5fbf8a;
        --mid: #d9a441;
        --low: #e0736a;
        --z-grogginess: #97a1b2;
        --z-morning_peak: #7ea6e8;
        --z-afternoon_dip: #b0a2d4;
        --z-evening_peak: #63bab5;
        --z-wind_down: #9096c4;
        --z-melatonin_window: #9d8ede;
        --z-sleep: #8892a3;
        --band-alpha: 0.18;
      }
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      background: var(--bg);
      color: var(--text);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
      font-size: 15px;
      line-height: 1.5;
      -webkit-text-size-adjust: 100%;
    }
    .wrap { max-width: 960px; margin: 0 auto; padding-block: 28px 48px; padding-inline: 16px; }
    h1 { font-size: 1.6rem; margin: 0 0 4px; letter-spacing: -0.01em; }
    h2 { font-size: 1.05rem; margin: 0; letter-spacing: -0.005em; }
    h3 { font-size: 1rem; margin: 0; }
    .sub { margin: 0; color: var(--muted); font-size: 0.9rem; }
    .card {
      background: var(--surface);
      border: 1px solid var(--border);
      border-radius: 12px;
      padding: 16px;
      margin-top: 18px;
    }
    .card-head { margin-bottom: 12px; }
    .hint { margin: 4px 0 0; color: var(--muted); font-size: 0.82rem; }
    .tiles {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px;
      margin-top: 18px;
    }
    .tile { background: var(--surface); border: 1px solid var(--border); border-radius: 12px; padding: 12px 14px; }
    .tile-label { font-size: 0.74rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
    .tile-value { font-size: 1.35rem; font-weight: 600; margin-top: 2px; font-variant-numeric: tabular-nums; }
    .tile-sub { font-size: 0.78rem; color: var(--muted); }
    .tone-good .tile-value { color: var(--good); }
    .tone-mid .tile-value { color: var(--mid); }
    .tone-low .tile-value { color: var(--low); }
    .chart-wrap { position: relative; }
    .chart { display: block; width: 100%; height: auto; overflow: visible; }
    .grid { stroke: var(--border); stroke-width: 1; }
    .axis-line { stroke: var(--border); stroke-width: 1; }
    .tick { stroke: var(--border); stroke-width: 1; }
    .axis { fill: var(--muted); font-size: 11px; font-family: inherit; }
    .band-label { fill: var(--muted); font-size: 10.5px; font-family: inherit; letter-spacing: 0.02em; }
    .marker-label { fill: var(--muted); font-size: 11px; font-family: inherit; }
    .marker-label.now { fill: var(--accent); font-weight: 600; }
    .curve-line { fill: none; stroke: var(--accent); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
    .curve-area { fill: var(--accent-soft); stroke: none; }
    .nowline { stroke: var(--accent); stroke-width: 1.6; stroke-dasharray: 5 4; }
    .bedline { stroke: var(--z-melatonin_window); stroke-width: 1.4; stroke-dasharray: 2 3; }
    .melatonin { fill: var(--z-melatonin_window); opacity: 0.1; stroke: var(--z-melatonin_window); stroke-dasharray: 3 3; stroke-opacity: 0.5; }
    .band { opacity: var(--band-alpha); }
    .band-grogginess { fill: var(--z-grogginess); }
    .band-morning_peak { fill: var(--z-morning_peak); }
    .band-afternoon_dip { fill: var(--z-afternoon_dip); }
    .band-evening_peak { fill: var(--z-evening_peak); }
    .band-wind_down { fill: var(--z-wind_down); }
    .band-melatonin_window { fill: var(--z-melatonin_window); }
    .band-sleep { fill: var(--z-sleep); }
    .tip {
      position: absolute; top: 0; transform: translateX(-50%);
      background: var(--text); color: var(--surface);
      font-size: 0.76rem; padding: 3px 8px; border-radius: 6px;
      pointer-events: none; white-space: nowrap;
    }
    .zones { list-style: none; margin: 0; padding: 0; }
    .zone { display: grid; grid-template-columns: 108px 150px 1fr; gap: 10px; padding: 8px 0; border-top: 1px solid var(--border); align-items: baseline; }
    .zone:first-child { border-top: none; }
    .zone-time { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.86rem; }
    .zone-name { font-weight: 600; }
    .zone-advice { color: var(--muted); }
    .zone-grogginess .zone-name { color: var(--z-grogginess); }
    .zone-morning_peak .zone-name { color: var(--z-morning_peak); }
    .zone-afternoon_dip .zone-name { color: var(--z-afternoon_dip); }
    .zone-evening_peak .zone-name { color: var(--z-evening_peak); }
    .zone-wind_down .zone-name { color: var(--z-wind_down); }
    .zone-melatonin_window .zone-name { color: var(--z-melatonin_window); }
    .zone-sleep .zone-name { color: var(--z-sleep); }
    .timeline { list-style: none; margin: 0; padding: 0; }
    .step { display: grid; grid-template-columns: 108px 1fr; gap: 10px; padding: 10px 0 10px 0; border-left: 2px solid var(--border); padding-left: 14px; margin-left: 4px; position: relative; }
    .step::before { content: ""; position: absolute; left: -6px; top: 16px; width: 10px; height: 10px; border-radius: 50%; background: var(--accent); }
    .step-time { color: var(--muted); font-variant-numeric: tabular-nums; font-size: 0.86rem; }
    .step-name { font-weight: 600; display: block; }
    .step-reason { color: var(--muted); }
    .bar { fill: var(--accent); }
    .bar-short { fill: var(--shortfall); }
    .need-mark { stroke: var(--text); stroke-width: 2; opacity: 0.72; }
    .bar-delta { fill: var(--muted); font-size: 10.5px; font-family: inherit; font-variant-numeric: tabular-nums; }
    .bar-delta.short { fill: var(--shortfall); }
    .data-table { margin-top: 10px; font-size: 0.86rem; }
    .data-table summary { cursor: pointer; color: var(--muted); }
    .data-table table { border-collapse: collapse; margin-top: 8px; width: 100%; }
    .data-table th, .data-table td { text-align: right; padding: 4px 8px; border-bottom: 1px solid var(--border); font-variant-numeric: tabular-nums; }
    .data-table th[scope="row"] { text-align: left; font-weight: 500; }
    .data-table thead th { color: var(--muted); font-weight: 500; }
    td.neg { color: var(--shortfall); }
    .minis { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 14px; }
    .mini { margin: 0; background: var(--surface-2); border-radius: 10px; padding: 10px 12px; }
    .mini figcaption { display: flex; justify-content: space-between; align-items: baseline; gap: 8px; }
    .mini-title { font-weight: 600; font-size: 0.9rem; }
    .mini-last { color: var(--muted); font-size: 0.82rem; font-variant-numeric: tabular-nums; }
    .mini-line { fill: none; stroke: var(--accent); stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
    .mini-dot { fill: var(--accent); }
    .mini-range { display: flex; justify-content: space-between; color: var(--muted); font-size: 0.74rem; }
    .summary { margin: 0; }
    .summary-row { display: grid; grid-template-columns: 120px 1fr; gap: 10px; padding: 6px 0; border-top: 1px solid var(--border); }
    .summary-row:first-child { border-top: none; }
    .summary dt { color: var(--muted); font-size: 0.86rem; }
    .summary dd { margin: 0; }
    .corrs, .recs { list-style: none; margin: 0; padding: 0; display: grid; gap: 12px; }
    .corr-head { display: flex; justify-content: space-between; gap: 10px; flex-wrap: wrap; }
    .corr-pair { font-weight: 600; }
    .corr-vs { color: var(--muted); font-weight: 400; }
    .corr-r { color: var(--muted); font-size: 0.84rem; font-variant-numeric: tabular-nums; }
    .corr-bar { height: 6px; background: var(--surface-2); border-radius: 3px; margin: 6px 0; overflow: hidden; }
    .corr-fill { display: block; height: 100%; background: var(--accent); border-radius: 3px; }
    .corr-fill.neg { background: var(--shortfall); }
    .corr-reading { margin: 0; color: var(--muted); font-size: 0.9rem; }
    .rec { background: var(--surface-2); border-radius: 10px; padding: 12px 14px; border-left: 3px solid var(--border); }
    .rec.impact-high { border-left-color: var(--accent); }
    .rec.impact-medium { border-left-color: var(--z-morning_peak); }
    .rec.impact-low { border-left-color: var(--border); }
    .rec-head { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; }
    .rec-rank { width: 22px; height: 22px; border-radius: 50%; background: var(--accent); color: var(--surface); display: inline-grid; place-items: center; font-size: 0.78rem; font-weight: 700; flex: none; }
    .pill { margin-left: auto; font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); border: 1px solid var(--border); border-radius: 999px; padding: 1px 8px; }
    .rec-why { margin: 6px 0 0; color: var(--muted); }
    .rec-action { margin: 6px 0 0; font-weight: 500; }
    footer { margin-top: 22px; color: var(--muted); font-size: 0.78rem; }
    @media (max-width: 560px) {
      .zone { grid-template-columns: 1fr; gap: 2px; }
      .step { grid-template-columns: 1fr; gap: 2px; }
      .summary-row { grid-template-columns: 1fr; gap: 0; }
      .tile-value { font-size: 1.2rem; }
    }`;

const SCRIPT = `      (function () {
        var svg = document.getElementById('energy-svg');
        var tip = document.getElementById('energy-tip');
        if (!svg || !tip || !window.ENERGY_POINTS) return;
        var pts = window.ENERGY_POINTS;
        var X0 = ${CURVE_PLOT.x0};
        var X1 = ${CURVE_PLOT.x1};
        function show(evt) {
          var box = svg.getBoundingClientRect();
          if (!box.width) return;
          var vx = ((evt.clientX - box.left) / box.width) * ${CURVE_VIEWBOX.width};
          var i = Math.round(((vx - X0) / (X1 - X0)) * (pts.length - 1));
          if (i < 0) i = 0;
          if (i > pts.length - 1) i = pts.length - 1;
          tip.textContent = pts[i][0] + '  energy ' + pts[i][1];
          tip.hidden = false;
          var left = evt.clientX - box.left;
          tip.style.left = Math.max(28, Math.min(box.width - 28, left)) + 'px';
        }
        svg.addEventListener('pointermove', show);
        svg.addEventListener('pointerleave', function () { tip.hidden = true; });
      })();`;

/**
 * Render the complete, self-contained HTML report.
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
  const date = String(energyDay.date ?? '');
  const title = `Whoop Energy — ${date}`;
  const curve = Array.isArray(energyDay.curve) ? energyDay.curve : [];
  const wakeMin = num(energyDay.wakeMin);
  const points = curve.map((p, i) => [clock(wakeMin + i * 15), Math.round(num(p && p.energy))]);

  const sections = [
    renderTiles(energyDay),
    renderCurve(energyDay),
    renderZones(energyDay),
    renderPlan(energyDay),
    renderInsightsSummary(insights),
    renderDebtBars(insights),
    renderNightTrends(nights),
    renderCorrelations(insights),
    renderRecommendations(insights),
  ].filter(Boolean);

  const headline = [
    Number.isFinite(energyDay.now) && energyDay.now !== null ? `now ${clock(energyDay.now)}` : null,
    `wake ${clock(energyDay.wakeMin)}`,
    `target bed ${clock(energyDay.targetBedtimeMin)}`,
    `target wake ${clock(energyDay.targetWakeMin)}`,
  ]
    .filter(Boolean)
    .join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
${STYLES}
</style>
</head>
<body>
  <main class="wrap">
    <header>
      <h1>${escapeHtml(title)}</h1>
      <p class="sub">${escapeHtml(headline)}</p>
    </header>
${sections.join('\n')}
    <footer>Generated ${escapeHtml(generatedAt)} · circadian model from your own WHOOP sleep and recovery records.</footer>
  </main>
  <script>
      window.ENERGY_POINTS = ${JSON.stringify(points)};
${SCRIPT}
  </script>
</body>
</html>
`;
}

export default { renderHtmlReport, escapeHtml };
