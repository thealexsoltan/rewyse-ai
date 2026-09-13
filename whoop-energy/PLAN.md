# Whoop Energy — Plan

A zero-dependency Node.js (18+) CLI that pulls sleep, recovery and strain data from a
**WHOOP** band via the official WHOOP Developer API (v2), and turns it into a
**Rise-style Circadian Energy Schedule** for the day plus a 14-day insights report
that says what to optimize.

Lives in `rewyse-ai/whoop-energy/`, standalone (own `package.json`, no npm deps), and
registers a `/whoop-energy` slash command like the other Rewyse skills.

---

## 1. Goals

1. **Auth + sync**: OAuth 2.0 against WHOOP, store tokens locally (never in the repo),
   fetch the last N days of sleep / recovery / cycle records, cache them as JSON.
2. **Energy schedule for today** (Rise-style): grogginess window, morning peak,
   afternoon dip, evening peak, wind-down, melatonin window, target bedtime and wake.
3. **Insights**: sleep debt (Rise definition), consistency, efficiency, recovery / HRV /
   RHR trends, simple correlations, and a ranked "what to optimize" list.
4. **Day plan**: concrete windows for deep work, workouts (gated by recovery), admin,
   a nap window, and the bedtime to aim for tonight.
5. **Outputs**: terminal (default), JSON (for other tools / Notion), and a single-file
   HTML report with an inline SVG energy curve.
6. **Demo mode** (`--demo`): 21 days of deterministic synthetic WHOOP v2 records so the
   tool runs end-to-end with no credentials, and so tests are hermetic.

Non-goals for v1: writing to Notion, calendar integration, workouts detail, a web UI.

---

## 2. Directory layout

```
whoop-energy/
  PLAN.md                 this file
  README.md               install, WHOOP developer app setup, usage, model explanation
  SKILL.md                slash-command instructions (same style as sibling skills)
  package.json            {"type":"module", "bin": {"whoop-energy":"bin/whoop-energy.js"}, "scripts": {"test":"node --test test/"}}
  .env.example            WHOOP_CLIENT_ID, WHOOP_CLIENT_SECRET, WHOOP_REDIRECT_URI, WHOOP_ENERGY_HOME
  bin/whoop-energy.js     CLI entry (arg parsing with node:util parseArgs, dispatch)
  src/
    config.js             env + paths. Data dir = $WHOOP_ENERGY_HOME || ~/.whoop-energy (tokens.json, cache.json, settings.json)
    time.js               local-time helpers: minutes-of-day, circular mean, tz-offset parsing ("+02:00"), fmt HH:MM
    whoop/auth.js         OAuth2 auth-code flow via local callback server, token store, refresh
    whoop/client.js       fetch wrapper: base URL, bearer, pagination (limit 25, next_token), 401→refresh once, 429→Retry-After backoff
    whoop/sync.js         pull sleep + recovery + cycle for N days → cache.json ({fetchedAt, days, sleep[], recovery[], cycle[]})
    model/normalize.js    WHOOP records → SleepNight[] (canonical shape below)
    model/sleepDebt.js    sleep need + 14-day weighted debt
    model/circadian.js    two-process model → 24h energy curve (15-min steps) + phase anchors
    model/zones.js        curve → Rise-style zones + day plan
    model/insights.js     14-day stats, trends, correlations, ranked recommendations
    report/terminal.js    ANSI report (sparkline curve, zone table, stat lines, insights)
    report/html.js        self-contained HTML report (inline CSS + SVG; theme-aware; no external assets)
    report/json.js        stable JSON envelope
    demo/fixtures.js      deterministic synthetic WHOOP v2 records (seeded PRNG), 21 days, realistic variance
  test/
    normalize.test.js, sleepDebt.test.js, circadian.test.js, zones.test.js, insights.test.js,
    client.test.js (pagination/refresh against a stubbed fetch), cli.test.js (--demo smoke, all formats)
```

Also touched at repo root: `.gitignore` (add `whoop-energy/.env`, `whoop-energy/data/`),
`install.sh` (one `create_skill "whoop-energy" ...` line), `CLAUDE.md` (skill entry).

---

## 3. WHOOP API facts to build against (network is unavailable in the build sandbox; keep every URL/field in `src/whoop/*` and `README.md` so they are easy to correct)

- Authorize: `GET https://api.prod.whoop.com/oauth/oauth2/auth` with
  `response_type=code&client_id&redirect_uri&scope&state`.
  Scopes: `read:sleep read:recovery read:cycles read:workout read:profile read:body_measurement offline`.
- Token: `POST https://api.prod.whoop.com/oauth/oauth2/token` (form-encoded).
  Code grant: `grant_type=authorization_code, code, client_id, client_secret, redirect_uri`.
  Refresh: `grant_type=refresh_token, refresh_token, client_id, client_secret, scope=offline`.
  Response: `{access_token, refresh_token, expires_in, scope, token_type}`.
- Default redirect URI: `http://localhost:8787/callback` (must be registered in the WHOOP developer dashboard).
- REST base: `https://api.prod.whoop.com/developer/v2`. Collections accept `start`, `end` (ISO 8601),
  `limit` (max 25), `nextToken`; respond `{records: [...], next_token: string|null}`.
  - `GET /activity/sleep` → sleep records
  - `GET /recovery` → recovery records
  - `GET /cycle` → physiological cycles (strain)
  - `GET /user/profile/basic` → `{user_id, email, first_name, last_name}` (used by `status`)
- Sleep record (v2): `{id (uuid), user_id, created_at, updated_at, start, end, timezone_offset ("+02:00"),
  nap (bool), score_state ("SCORED"|"PENDING_SCORE"|"UNSCORABLE"), score: {
    stage_summary: {total_in_bed_time_milli, total_awake_time_milli, total_no_data_time_milli,
      total_light_sleep_time_milli, total_slow_wave_sleep_time_milli, total_rem_sleep_time_milli,
      sleep_cycle_count, disturbance_count},
    sleep_needed: {baseline_milli, need_from_sleep_debt_milli, need_from_recent_strain_milli, need_from_recent_nap_milli},
    respiratory_rate, sleep_performance_percentage, sleep_consistency_percentage, sleep_efficiency_percentage } }`
- Recovery record: `{cycle_id, sleep_id, user_id, created_at, updated_at, score_state, score: {
    user_calibrating, recovery_score, resting_heart_rate, hrv_rmssd_milli, spo2_percentage, skin_temp_celsius } }`
- Cycle record: `{id, user_id, created_at, updated_at, start, end (null while open), timezone_offset, score_state,
    score: {strain, kilojoule, average_heart_rate, max_heart_rate} }`
- Rate limit ~100 req/min; honour `Retry-After` on 429. Unscored records have `score` absent → skip in the model.

---

## 4. Canonical data contracts (all modules program against these; JSDoc typedefs in `src/model/types.js`)

```js
/** One wake-date's sleep, main sleep + naps merged. Times are ISO strings; minutes are integers. */
SleepNight = {
  date: 'YYYY-MM-DD',        // local date of the WAKE (the day this sleep powers)
  start, end,                // ISO of main sleep
  tzOffsetMin,               // e.g. 120
  bedtimeMin, wakeMin,       // local minutes-of-day (bedtime may exceed 1440 → normalised to [0,1440) with a `bedtimeAfterMidnight` flag)
  inBedMin, asleepMin, awakeMin, lightMin, swsMin, remMin,
  efficiencyPct, performancePct, consistencyPct, respiratoryRate, disturbances,
  needBaselineMin, needFromDebtMin, needFromStrainMin, needFromNapMin, needTotalMin,
  naps: [{ start, end, asleepMin }],
  napMin,                    // sum of naps
  recovery: { score, hrvMs, rhr, spo2, skinTempC, calibrating } | null,
  strain: number | null,     // cycle strain of the day that PRECEDED this sleep
}

EnergyPoint = { t: minutesOfDay, iso, energy: 0..100, S, C, inertia }

EnergyDay = {
  date, tzOffsetMin, now: minutesOfDay|null,
  wakeMin, targetBedtimeMin, targetWakeMin,   // today's actual wake, tonight's target bed, tomorrow's target wake
  anchors: { cbtMin: minutesOfDay, dlmo: minutesOfDay, habitualWakeMin, habitualBedtimeMin, midsleepMin },
  need: { baselineMin, todayMin },            // baseline and today's need incl. debt payback
  debt: { hours, trend7d: 'rising'|'falling'|'flat', level: 'low'|'moderate'|'high'|'severe' },
  curve: EnergyPoint[],                       // 96 points, 15-min, from wake to wake+24h
  zones: [{ kind: 'grogginess'|'morning_peak'|'afternoon_dip'|'evening_peak'|'wind_down'|'melatonin_window'|'sleep', startMin, endMin, label, advice }],
  plan: [{ startMin, endMin, activity: 'deep_work'|'workout'|'admin'|'nap'|'wind_down'|'bed', reason }],
  recovery: SleepNight.recovery | null,
  lastNight: SleepNight | null,
}

Insights = {
  windowDays, nights: number,
  debt: { hours, level, trend7d, byDay: [{date, needMin, asleepMin, deltaMin, cumulativeDebtHours}] },
  consistency: { bedtimeSdMin, wakeSdMin, whoopConsistencyAvg },
  quality: { efficiencyAvg, disturbancesAvg, swsPctAvg, remPctAvg, performanceAvg },
  recovery: { avg, avg7d, hrvAvg, hrvAvg7d, hrvDeltaPct, rhrAvg, rhrAvg7d, calibrating },
  correlations: [{ x, y, r, n, reading }],   // only |r| >= 0.3 and n >= 7
  recommendations: [{ rank, title, why, action, impact: 'high'|'medium'|'low' }],
}
```

---

## 5. The model (Rise-style two-process, tuned heuristics — document every constant in README)

**Sleep need** = mean of `needBaselineMin` over scored nights in window; fallback 480 min if absent or
calibrating. Overridable with `--need 7.5h` or `settings.json.needMin`.

**Sleep debt** (trailing 14 nights, most recent weighted highest):
`debtHours = max(0, Σ_i w_i · (need − (asleepMin_i + napMin_i)) / 60)`, `w_i = 0.9^(i−1)` (i=1 is last night),
capped at `2 × need` hours. Levels: <1 low, 1–3 moderate, 3–5 high, >5 severe.
Trend = debt over last 7 nights vs debt over the 7 before.

**Circadian anchors** (from last 7 nights, circular means so midnight wraps):
`habitualWake`, `habitualBedtime`, `midsleep`. `cbtMin = habitualWake − 120 min`
(core body temperature minimum). `dlmo = cbtMin − 7h` (dim-light melatonin onset).

**Process C** (circadian): `C(t) = cos(θ) + 0.25·cos(2θ + π/2)` with `θ = 2π·(t − (cbtMin + 12h))/24h`,
giving a broad late-afternoon/evening peak and a post-lunch dip.

**Process S** (homeostatic pressure): simulate the actual last 14 days of sleep/wake from records.
Awake: `S ← S + (1 − S)(1 − e^(−dt/18.2h))`. Asleep: `S ← S·e^(−dt/4.2h)`. Start S = 0.5 at the window
start; the long simulation makes the initial value irrelevant. Project today from actual wake to
`targetBedtime` awake, then asleep.

**Sleep inertia**: `I(t) = 0.35·e^(−(t − wake)/30min)` for the first 2 h after wake, else 0.

**Energy**: `raw(t) = 0.6·C(t) − 0.8·S(t)·(1 + 0.15·debtHours) − I(t)`, then min-max normalised to
0–100 over the waking span (sleep span is rendered but not used for normalisation).

**Target bedtime**: `habitualBedtime − payback`, where `payback = clamp(debtHours × 15 min, 0, 45 min)`.
Never earlier than `dlmo + 90 min`. **Target wake** = `habitualWake` (anchor wake time; that's the
Rise/CBT-I advice). Both rounded to 5 min.

**Zones** (segment the curve; clock fallbacks in brackets if the curve is flat):
- grogginess: wake → first t where energy ≥ 40 and inertia < 0.05 [wake + 90 min]
- morning_peak: from end of grogginess → energy falls below 65 heading down [wake+2h → wake+5.5h]
- afternoon_dip: contiguous region around the local minimum between wake+5h and wake+10h where energy < 55 [wake+6h → wake+8h]
- evening_peak: from end of dip until energy falls below 55 [wake+9h → wake+13h]
- wind_down: `targetBedtime − 2h` → `melatonin.start`
- melatonin_window: `targetBedtime − 60min` → `targetBedtime + 30min`
- sleep: `targetBedtime` → `targetWake`

**Day plan** rules: deep_work = morning_peak and evening_peak (split evening if it spans dinner);
workout = recovery ≥ 67 → inside a peak (prefer morning if HRV ≥ 7-day avg, else evening);
34–66 → 30–45 min light session in evening peak; < 34 → "recovery day, walk/mobility only";
admin = afternoon_dip; nap = 20-min window at the start of afternoon_dip only if debt ≥ 1h and it ends ≥ 8h before targetBedtime;
wind_down = wind_down zone; bed = targetBedtime.

**Insights & recommendations** (rule engine, ranked high→low impact, at most 6):
- debt ≥ 3h → "Pay down debt: bed X min earlier for N nights" (N = ceil(debt / 0.75))
- bedtimeSd ≥ 45 min or wakeSd ≥ 45 min → "Anchor your wake time" (with the anchor time)
- efficiencyAvg < 85 → "Improve sleep efficiency" (limit time in bed awake, etc.)
- hrvDeltaPct ≤ −10 → "HRV below baseline: reduce strain 2–3 days"
- rhrAvg7d − rhrAvg ≥ 3 → "Resting HR elevated: check illness/alcohol/late meals"
- disturbancesAvg high (≥ 12) → "Reduce disturbances"
- consistency avg < 70 → "Regularise schedule"
- correlation-driven: e.g. bedtime lateness ↔ recovery negative r → "Late nights cost you recovery"
Correlations (Pearson, n ≥ 7, report only |r| ≥ 0.3): asleepMin ↔ next recovery.score;
bedtimeMin (lateness) ↔ recovery.score; strain ↔ efficiencyPct of following night; napMin ↔ asleepMin.

---

## 6. CLI

```
whoop-energy auth                       start OAuth flow (prints URL, opens browser if possible, waits for callback)
whoop-energy sync [--days 30]           fetch + cache
whoop-energy today [--format terminal|json|html] [--out FILE] [--now HH:MM] [--need 7.5h]
whoop-energy insights [--days 14] [--format terminal|json]
whoop-energy report [--out whoop-energy-report.html]   full HTML: today's curve + 14-day debt bars + insights + plan
whoop-energy status                     auth state, token expiry, cache freshness, profile name
Global: --demo (use fixtures, no auth/cache needed), --data-dir PATH, --tz +02:00 (override), --quiet
```
Exit codes: 0 ok, 2 usage, 3 not authenticated, 4 API error. All errors human-readable.
`today` and `report` auto-`sync` if cache is older than 6 h (unless `--offline`).

---

## 7. Execution split (Opus agents)

- **Agent A — data layer & CLI skeleton**: `package.json`, `.env.example`, `config.js`, `time.js`,
  `whoop/auth.js`, `whoop/client.js`, `whoop/sync.js`, `model/normalize.js`, `model/types.js`,
  `demo/fixtures.js`, `bin/whoop-energy.js` (arg parsing + dispatch, calling model/report through
  the contracts above, stubbing where modules do not exist yet), tests for client/normalize/fixtures.
- **Agent B — model**: `model/sleepDebt.js`, `model/circadian.js`, `model/zones.js`, `model/insights.js`
  + tests. Inputs are `SleepNight[]`; write a small in-test generator rather than depending on A.
- **Agent C — reports**: `report/terminal.js`, `report/html.js`, `report/json.js` + tests, driven by
  hand-built `EnergyDay` / `Insights` objects matching the contracts.
- **Agent D — integration**: wire everything, run `--demo` for every command/format, fix contract
  drift, `npm test` green, write `README.md`, `SKILL.md`, root `install.sh` / `CLAUDE.md` / `.gitignore`
  edits, produce a sample `report.html` in demo mode for review.

Constraints for all agents: Node 18+ built-ins only (no npm dependencies), ESM, no network calls in
tests, no secrets in the repo, every tunable constant named and exported, JSDoc on public functions.
