# Whoop Energy

A **Rise-style circadian energy schedule** built from your own WHOOP data.

It pulls your sleep, recovery and strain records from the WHOOP Developer API,
runs them through a two-process sleep model, and tells you — in local clock
times — when you will be sharp, when you will crash, when to train, and when to
go to bed tonight.

**Node 18+ only. Zero dependencies.** No npm install, no build step, no
telemetry. Everything runs on the machine in front of you.

```
whoop-energy today          # today's energy curve, zones and day plan
whoop-energy insights       # 14-day sleep debt, trends and what to fix
whoop-energy report         # a single-file HTML report you can keep
whoop-energy today --demo   # all of the above with synthetic data, no account
```

---

## 3-minute setup

You need a free WHOOP developer app. It is yours, private, and only ever reads
your own data.

1. **Create the app.** Go to <https://developer.whoop.com> → **Developer
   Dashboard** → sign in with your WHOOP account → **Create App**.
2. **Add the redirect URI.** In the app's settings, add exactly:

   ```
   http://localhost:8787/callback
   ```

   This is the tiny local server `whoop-energy auth` starts to catch the OAuth
   callback. It must match character for character.
3. **Request the scopes** `read:sleep`, `read:recovery`, `read:cycles`,
   `read:workout`, `read:profile`, `read:body_measurement` and `offline`.
   (`offline` is what lets the tool refresh its token without re-asking you.)
4. **Copy the credentials.**

   ```bash
   cd rewyse-ai/whoop-energy
   cp .env.example .env
   # then paste your Client ID and Client Secret into .env
   ```
5. **Authorize and sync.**

   ```bash
   node bin/whoop-energy.js auth     # opens WHOOP, waits for the callback
   node bin/whoop-energy.js sync     # pulls the last 30 days
   node bin/whoop-energy.js today
   ```

`.env` is git-ignored. Tokens never go in the repo — see
[Data and privacy](#data-and-privacy).

> **Don't want to set anything up yet?** Every command accepts `--demo` and
> runs against 21 days of deterministic synthetic data. Nothing is fetched,
> nothing is stored.

---

## Commands

| Command | What it does | Useful flags |
|---|---|---|
| `auth` | Runs the OAuth flow: prints a WHOOP URL, opens it if it can, waits on `localhost:8787` for the callback, stores the tokens. | — |
| `sync` | Fetches sleep / recovery / cycle records and caches them. | `--days 30` |
| `today` | Today's energy curve, zones and day plan. | `--format terminal\|json\|html`, `--now HH:MM`, `--need 7h30m`, `--out FILE` |
| `insights` | Sleep debt, consistency, quality, trends, correlations and a ranked list of what to fix. | `--days 14`, `--format terminal\|json` |
| `report` | The full self-contained HTML report — curve, zones, plan, 14-day bars, sparklines, correlations, recommendations. | `--out FILE`, `--format html\|json` |
| `status` | Credentials, token expiry, cache freshness, profile name. | `--format terminal\|json` |

**Global flags:** `--demo`, `--data-dir PATH`, `--tz +02:00`, `--offline`,
`--quiet`, `--help`, `--version`.

> `--tz` with a **negative** offset needs the `=` form, or the shell hands the
> value to the argument parser as a flag: `--tz=-05:00`, not `--tz -05:00`.

`today` and `report` sync automatically when the cache is more than **6 hours**
old. Pass `--offline` to work from whatever is cached.

**Exit codes:** `0` ok · `2` usage error · `3` not authenticated · `4` API error.

### `today`

```
Whoop Energy — 2026-09-13                                              now 16:04
────────────────────────────────────────────────────────────────────────────────
Last night   asleep 7h23   need 8h48   efficiency 87%   recovery 78   HRV 76 ms   RHR 51 bpm
Sleep debt   7h40   severe   rising vs last week
Sleep need   8h35 tonight   baseline 7h50

Energy
                            ▼ now 16:04
▁▃▄▆▆▆▇▇▇▇▇▇▇▇▇▆▆▆▅▅▅▅▅▅▅▅▅▅▅▆▆▆▆▇▇██████████▇▇▆▅▄▃▂▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▁▂▃▄▅
┬         ┬         ┬         ┬         ┬         ┬         ┬         ┬
07:32   10:32     13:32     16:32     19:32     22:32     01:32     04:32

Zones
  07:32–08:32  Grogginess        Sleep inertia is still clearing — light, water…
  08:32–12:47  Morning peak      Your sharpest analytical window — spend it on …
  12:47–15:32  Afternoon dip     Alertness bottoms out here — batch admin, get …
  15:32–21:05  Evening peak      A second, softer peak — good for creative work…
  21:05–22:05  Wind-down         Dim the lights, stop eating and drop screens s…
  22:05–23:35  Melatonin window  Your body is primed for sleep onset — be in be…
  23:05–07:30  Sleep             Target sleep window: 23:05 → 07:30.

Your day
  08:32–09:32  Workout    Recovery 78% is green and HRV is at or above your 7-d…
  09:32–12:47  Deep work  Energy peaks 09:32–12:47 — protect it for your hardes…
  12:47–13:07  Nap        7.7h of sleep debt and bedtime is still 10h away — a …
  13:07–15:32  Admin      Lowest alertness of the day — email, errands and a wa…
  15:32–19:00  Deep work  Second wind 15:32–19:00 — good for creative or genera…
  20:00–21:05  Deep work  Second wind 20:00–21:05 — good for creative or genera…
  21:05–22:05  Wind down  Lights down and screens off from 21:05 so you fall as…
  23:05–07:30  Bed        Lights out at 23:05; anchor tomorrow’s wake at 07:30.

Tonight      target bedtime 23:05   target wake 07:30
```

### `insights`

```
Sleep vs need
  Sep  8  ██████████████████░░   7h09 / 7h50    −0h41
  Sep  9  ███████████████████░   7h27 / 7h50    −0h23
  Sep 10  ███████████░░░░░░░░░   4h30 / 7h50    −3h20
  Sep 11  ███████████████████░   7h23 / 7h50    −0h27

Consistency  bedtime ±39 min   wake ±30 min   WHOOP 77%
Quality      efficiency 88%   performance 82%   SWS 23%   REM 23%   disturbances 9.6/night
Recovery     63 avg   7-day 62
HRV          63 ms avg   7-day 64 ms   +1.6% vs baseline
RHR          55 bpm avg   7-day 55 bpm

Correlations
  asleepMin ↔ recoveryScore  r=0.89 (n=14)
    Longer sleep tracks with better recovery (r = 0.89, n = 14).
  bedtimeLateness ↔ recoveryScore  r=-0.72 (n=14)
    Later bedtimes cost you recovery (r = -0.72, n = 14).

What to optimize
  1. [high] Pay down your sleep debt
     You are carrying 7.7h of sleep debt (severe, trend rising).
     → Go to bed 45 minutes earlier than usual for the next 11 nights — keep yo…
  2. [low] Late nights cost you recovery
     Later bedtimes cost you recovery (r = -0.72, n = 14).
     → Treat your target bedtime as a hard stop on work and screens for the nex…
```

### `report`

```bash
node bin/whoop-energy.js report --out ~/whoop-energy-report.html
```

One HTML file, no external assets, works offline, follows your system light/dark
theme, and prints. Hovering the energy curve shows the value at that minute.

---

## Demo mode

`--demo` swaps the WHOOP cache for 21 days of deterministic synthetic records
generated by a seeded PRNG in `src/demo/fixtures.js`. Same code path, same
model, same renderers — no credentials, no network, no files written. It is what
the test suite runs against, so it also doubles as a regression fixture.

```bash
node bin/whoop-energy.js today --demo
node bin/whoop-energy.js insights --demo --format json
node bin/whoop-energy.js report --demo --out /tmp/demo-report.html
```

---

## How the model works

Two things decide how alert you feel at any moment: **how long you have been
awake** (process S) and **where you are in your body clock** (process C). Energy
is a weighted difference of the two, minus a grogginess penalty just after
waking.

### Sleep need

The mean of WHOOP's own `sleep_needed.baseline_milli` across the scored nights
in the window. If WHOOP is still calibrating or the field is missing, it falls
back to 8 h. Override with `--need 7h30m` (also accepts `7.5h` or `450`) or
`needMin` in `settings.json`.

### Sleep debt

Trailing 14 nights, most recent weighted highest:

```
debtHours = max(0, Σᵢ wᵢ · (need − (asleepᵢ + napsᵢ)) / 60),   wᵢ = 0.9^(i−1)
```

where `i = 1` is last night. Capped at `2 × need` hours.

| Debt | Level |
|---|---|
| < 1 h | low |
| 1–3 h | moderate |
| 3–5 h | high |
| > 5 h | severe |

The **trend** compares the last 7 nights against the 7 before them.

### Anchors

Taken as **circular** means over the last 7 nights, so a bedtime that crosses
midnight averages correctly instead of collapsing towards noon.

| Anchor | Definition |
|---|---|
| `habitualWake`, `habitualBedtime`, `midsleep` | circular means of the last 7 nights |
| `cbtMin` (core body temperature minimum) | `habitualWake − 2 h` |
| `dlmo` (dim-light melatonin onset) | `cbtMin − 7 h` |

### Process C, process S, inertia

```
C(t)   = cos θ + 0.5·cos(2θ − 5π/8),   θ = 2π·(t − (cbtMin + 12 h)) / 24 h
S      awake:  S ← 1 − (1 − S)·e^(−dt/18.2 h)
       asleep: S ← S·e^(−dt/4.2 h)
I(t)   = 0.35·e^(−(t − wake)/30 min)  for the first 2 h after waking, else 0
raw(t) = 0.6·C(t) − 0.8·S(t)·(1 + 0.15·debtHours) − I(t)
```

`raw` is then min-max normalised to **0–100 over your waking span**, so 100 is
your own best hour today, not an absolute scale. Process S is simulated over
your real recorded sleep and wake episodes for the whole window, so a bad night
three days ago still shows up.

> The 12-hour harmonic of process C is what carves the post-lunch dip out of the
> broad late-afternoon peak. PLAN.md originally specified amplitude `0.25` and
> phase `+π/2`; that combination produced no visible dip at all, so the shipped
> values are amplitude `0.5`, phase `−5π/8`. Tune them in
> `src/model/circadian.js`.

### Target bedtime and wake

```
payback      = clamp(debtHours × 15 min, 0, 45 min)
targetBed    = habitualBedtime − payback     (floored at DLMO + 90 min*)
targetWake   = habitualWake                  (anchor the wake time — that is the CBT-I advice)
```

Both rounded to 5 minutes.

\* The DLMO floor only applies when `DLMO + 90 min` is genuinely *earlier* than
your habitual bedtime. DLMO is estimated from habitual wake alone, so for anyone
with a sleep opportunity longer than ~7.5 h it lands at or after their real
bedtime; taking it literally there would silently cancel the whole payback and
print "severe debt" next to an unchanged bedtime.

### Zones

| Zone | How it is found | Clock fallback |
|---|---|---|
| Grogginess | wake → first point with energy ≥ 40 and inertia < 0.05 | wake + 90 min (never > 3 h) |
| Morning peak | end of grogginess → start of the dip | — |
| Afternoon dip | contiguous region around the curve minimum between wake+5 h and wake+10 h. Tier 1: energy < 55. Tier 2 (the curve never gets that low): within 5 points of the local minimum, widened at most 60 min past the search window. Tier 3 (the region comes out wider than 5 h, i.e. the curve is flat): the clock fallback. | wake+6 h → wake+8 h |
| Evening peak | end of dip → wind-down, cut short if energy drops below 55 | — |
| Wind-down | `targetBed − 2 h` → melatonin window (never earlier than `targetBed − 3 h`) | — |
| Melatonin window | `targetBed − 60 min` → `targetBed + 30 min` | — |
| Sleep | `targetBed` → `targetWake` | — |

Zones are forced into a contiguous, gap-free, monotone chain: each zone ends
exactly where the next begins, so no minute of your day is unaccounted for.

### Day plan rules

| Block | Rule |
|---|---|
| Deep work | Both peaks. An evening peak spanning 19:00–20:00 is split around dinner. |
| Workout | Recovery ≥ 67 → a 60-min hard session inside a peak (morning if HRV ≥ your 7-day average, else evening). 34–66 → a 45-min light session in the evening peak. < 34 → no session; walk and mobility only. |
| Admin | The afternoon dip. |
| Nap | 20 min at the top of the dip, only when debt ≥ 1 h **and** the nap ends at least 8 h before target bedtime. |
| Wind down / Bed | The wind-down zone and target bedtime. |

### Every constant, and where to tune it

All of these are named exports — change the value, rerun, no build step.

| Constant | Value | File |
|---|---|---|
| `TAU_WAKE_H` | 18.2 h | `src/model/circadian.js` |
| `TAU_SLEEP_H` | 4.2 h | `src/model/circadian.js` |
| `C_WEIGHT` / `S_WEIGHT` | 0.6 / 0.8 | `src/model/circadian.js` |
| `DEBT_S_GAIN` | 0.15 per hour of debt | `src/model/circadian.js` |
| `C_HARMONIC_AMPLITUDE` / `C_HARMONIC_PHASE` | 0.5 / −5π/8 | `src/model/circadian.js` |
| `INERTIA_AMPLITUDE` / `INERTIA_TAU_MIN` / `INERTIA_MAX_MIN` | 0.35 / 30 min / 120 min | `src/model/circadian.js` |
| `CBT_OFFSET_MIN` / `DLMO_OFFSET_MIN` | −120 min / −420 min | `src/model/circadian.js` |
| `PAYBACK_PER_DEBT_HOUR_MIN` / `MAX_PAYBACK_MIN` | 15 min / 45 min | `src/model/circadian.js` |
| `MIN_BEDTIME_AFTER_DLMO_MIN` | 90 min | `src/model/circadian.js` |
| `ANCHOR_WINDOW_NIGHTS` | 7 nights | `src/model/circadian.js` |
| `CURVE_POINTS` / `CURVE_STEP_MIN` | 96 / 15 min | `src/model/circadian.js` |
| `ROUND_TO_MIN` | 5 min | `src/model/circadian.js` |
| `DEBT_DECAY` / `DEBT_WINDOW` | 0.9 / 14 nights | `src/model/sleepDebt.js` |
| `DEBT_CAP_MULTIPLIER` | 2 × need | `src/model/sleepDebt.js` |
| `DEBT_LEVEL_THRESHOLDS` | low 1 h, moderate 3 h, high 5 h | `src/model/sleepDebt.js` |
| `DEFAULT_NEED_MIN` | 480 min | `src/model/sleepDebt.js` |
| `TREND_WINDOW` / `TREND_EPSILON_HOURS` | 7 nights / 0.5 h | `src/model/sleepDebt.js` |
| `GROGGINESS_ENERGY` / `GROGGINESS_INERTIA` | 40 / 0.05 | `src/model/zones.js` |
| `MORNING_PEAK_EXIT_ENERGY` | 65 | `src/model/zones.js` |
| `DIP_ENERGY` / `DIP_RELATIVE_BAND` | 55 / 5 | `src/model/zones.js` |
| `DIP_SEARCH_START_MIN` / `DIP_SEARCH_END_MIN` | wake+300 / wake+600 | `src/model/zones.js` |
| `DIP_MAX_WIDTH_MIN` | 300 min | `src/model/zones.js` |
| `EVENING_PEAK_EXIT_ENERGY` | 55 | `src/model/zones.js` |
| `WIND_DOWN_LEAD_MIN` / `WIND_DOWN_MAX_LEAD_MIN` | 120 / 180 min | `src/model/zones.js` |
| `MELATONIN_LEAD_MIN` / `MELATONIN_TAIL_MIN` | 60 / 30 min | `src/model/zones.js` |
| `RECOVERY_GREEN_MIN` / `RECOVERY_YELLOW_MIN` | 67 / 34 | `src/model/zones.js` |
| `WORKOUT_HARD_MIN` / `WORKOUT_LIGHT_MIN` | 60 / 45 min | `src/model/zones.js` |
| `NAP_MIN` / `NAP_DEBT_MIN_HOURS` / `NAP_CUTOFF_BEFORE_BED_MIN` | 20 min / 1 h / 480 min | `src/model/zones.js` |
| `DINNER_START_MIN` / `DINNER_END_MIN` | 19:00 / 20:00 | `src/model/zones.js` |
| `DEFAULT_WINDOW_DAYS` / `RECENT_WINDOW_DAYS` | 14 / 7 days | `src/model/insights.js` |
| `CORR_MIN_R` / `CORR_MIN_N` | 0.3 / 7 | `src/model/insights.js` |
| `REC_DEBT_HOURS` / `PAYBACK_NIGHTLY_HOURS` | 3 h / 0.75 h | `src/model/insights.js` |
| `REC_SD_MIN` | 45 min | `src/model/insights.js` |
| `REC_EFFICIENCY_PCT` | 85 % | `src/model/insights.js` |
| `REC_HRV_DELTA_PCT` / `REC_RHR_DELTA_BPM` | −10 % / 3 bpm | `src/model/insights.js` |
| `REC_DISTURBANCES` / `REC_CONSISTENCY_PCT` | 12/night / 70 % | `src/model/insights.js` |
| `MAX_RECOMMENDATIONS` | 6 | `src/model/insights.js` |
| `DEFAULT_SYNC_DAYS` / `DEFAULT_MAX_CACHE_AGE_HOURS` | 30 days / 6 h | `src/whoop/sync.js` |
| `MAX_PAGE_LIMIT` / `MAX_RATE_LIMIT_RETRIES` | 25 / 3 | `src/whoop/client.js` |

---

## How to read the insights

**Sleep vs need** — one row per night. The bar is time asleep, the trailing
number is the gap: `−1h28` means you came up 1 h 28 min short of that night's
need. (In JSON the same field is `debt.byDay[].deltaMin` and is stored as
`need − asleep`, so it is *positive* for a shortfall; renderers flip it.)

**Consistency** — the standard deviation of your bedtimes and wake times. Under
±30 min is tight; over ±45 min triggers an "anchor your wake time"
recommendation. `WHOOP %` is WHOOP's own consistency score.

**Quality** — efficiency is asleep ÷ in-bed; under 85 % usually means time spent
awake in bed. SWS and REM are shown as a share of sleep, not minutes, so they
are comparable across nights of different lengths.

**Recovery / HRV / RHR** — each shown as a window average next to its 7-day
average. HRV trending 10 % or more below its own baseline, or RHR 3 bpm above
it, are the two classic "you are accumulating load faster than you are clearing
it" signals.

**Correlations** — Pearson `r` across the window, printed only when `|r| ≥ 0.3`
and `n ≥ 7`. Four pairs are tested: sleep duration ↔ that night's recovery,
bedtime lateness ↔ recovery, previous-day strain ↔ that night's efficiency, and
nap length ↔ main sleep length. All four are same-row joins, because in a
`SleepNight` the recovery score is the one WHOOP computed *from* that sleep and
the strain is the strain of the day that *preceded* it. These are correlations
across a couple of weeks of your own data — suggestive, not causal.

**What to optimize** — at most 6 rules fire, ranked high → low impact. A rule
only appears when its threshold is actually crossed, so a short list is good
news.

---

## Data and privacy

- Tokens live in `~/.whoop-energy/tokens.json`, written with mode **0600**
  inside a directory created **0700**. Override the location with
  `WHOOP_ENERGY_HOME` or `--data-dir`.
- The cache (`cache.json`) and your settings (`settings.json`) sit beside it.
  Nothing is written into the repository.
- `.env` holds your client id and secret and is git-ignored, along with
  `whoop-energy/data/` and any `whoop-energy/*.html` report.
- **The only network calls the tool ever makes are to `api.prod.whoop.com`.**
  No analytics, no crash reporting, no third-party hosts. The HTML report embeds
  all of its CSS and SVG and loads nothing from the internet.
- Nothing is sent to Notion, Claude, or anywhere else. `--format json` exists so
  *you* can pipe it somewhere if you want to.
- To revoke everything: delete `~/.whoop-energy/` and remove the app from your
  WHOOP account.

---

## Troubleshooting

| Symptom | Fix |
|---|---|
| **`redirect_uri_mismatch`** during `auth` | The URI in your WHOOP dashboard must equal `WHOOP_REDIRECT_URI` exactly — scheme, host, port, path, no trailing slash. Default is `http://localhost:8787/callback`. |
| **Port 8787 already in use** | Register a different callback URI in the dashboard and set `WHOOP_REDIRECT_URI` to match; the local server uses whatever port is in that URI. |
| **`Not authenticated` (exit 3)** after weeks away | Refresh tokens expire. Rerun `whoop-energy auth`. |
| **401 in the middle of a sync** | The client refreshes once and retries automatically. If it still fails, the refresh token is dead — rerun `auth`. |
| **429 / rate limited** | WHOOP allows roughly 100 requests/minute. The client honours `Retry-After` and retries up to 3 times. If you still hit it, sync a shorter window: `sync --days 14`. |
| **Last night is missing** | WHOOP scores a night some time after you wake. Records with `score_state` other than `SCORED` have no `score` object and are skipped by the model. Re-run `sync` later in the day. |
| **The numbers look stale** | `today` and `report` auto-sync after 6 h, `insights` never does. Run `sync` explicitly, or check freshness with `status`. |
| **`--tz -05:00` is rejected** | Use the `=` form: `--tz=-05:00`. |
| **Everything is empty but `status` says authenticated** | You may have synced a window with no scored nights. Try `sync --days 30`, then `status` to see the record counts. |

---

## Limitations

- **This is a heuristic model, not a measurement.** The two-process model,
  the anchors and every threshold above are tuned rules of thumb applied to your
  WHOOP summaries. Treat the output as a good default plan for the day, not as a
  reading of your actual physiology.
- **Not medical advice.** It cannot detect or diagnose anything. Persistent
  fatigue, insomnia or daytime sleepiness are worth raising with a doctor.
- **The WHOOP API details were written without live access.** Endpoints, field
  names and the OAuth flow are implemented from the published v2 documentation
  but have not been exercised against a real account. If WHOOP changes
  something, everything you need to correct is in `src/whoop/` — URLs and scopes
  in `src/config.js`, pagination and retries in `src/whoop/client.js`, the
  endpoint map in `src/whoop/sync.js`, and the record → `SleepNight` mapping in
  `src/model/normalize.js`. The rest of the tool programs against
  `SleepNight`, so a field rename is a one-file change.
- Naps are merged into the wake-date they belong to; workouts are read but not
  yet modelled; nothing is written back to WHOOP.

---

## Development

```bash
cd rewyse-ai/whoop-energy
npm test          # node --test test/*.test.js — 162 tests, no network
```

Tests are hermetic: the API client is exercised against a stubbed `fetch`, and
everything else runs on the demo fixtures. `test/cli.test.js` spawns the real
binary in `--demo` mode for every command and format.

The design notes, including the contracts every module programs against, are in
[PLAN.md](PLAN.md).
