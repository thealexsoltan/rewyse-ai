---
name: whoop-energy
description: "Use when someone asks for their circadian energy schedule, sleep debt, WHOOP sleep insights, when to do deep work or train today, or how to plan their day around their sleep."
argument-hint: [today|insights|report|auth|sync]
---

## Context

- The tool is a standalone zero-dependency Node CLI at `rewyse-ai/whoop-energy/`
- Read [README.md](README.md) for the full model, every tunable constant, and troubleshooting
- Run it as `node bin/whoop-energy.js <command>` from `rewyse-ai/whoop-energy/`
- Exit codes: `0` ok · `2` usage error · `3` not authenticated · `4` API error
- **Never print the user's tokens, `.env` contents, client id or client secret** —
  not in output, not in a summary, not "to check it looks right". `status` is the
  safe way to confirm the setup works.

---

## Step 1: Check Node

```bash
node --version
```

Needs **18 or newer**. If it is older or missing, say so and stop — nothing else
will work. There is nothing to install beyond Node: the tool has zero
dependencies.

---

## Step 2: Check credentials

```bash
ls rewyse-ai/whoop-energy/.env
```

**If `.env` exists** → go to Step 3.

**If it does not**, offer the two options in one message:

> I can either walk you through connecting your WHOOP account (about 3 minutes,
> one-time), or show you the same report on demo data right now so you can see
> what it looks like. Which would you like?

- **Demo** → run the requested command with `--demo` and go to Step 3.
- **Connect** → walk through it, one step at a time, waiting for confirmation:
  1. Open <https://developer.whoop.com> → **Developer Dashboard** → sign in → **Create App**
  2. Add the redirect URI `http://localhost:8787/callback` exactly
  3. Request scopes: `read:sleep read:recovery read:cycles read:workout read:profile read:body_measurement offline`
  4. `cp .env.example .env`, then paste the Client ID and Client Secret into `.env`
     — tell them to edit the file themselves; do not ask them to paste secrets into chat
  5. `node bin/whoop-energy.js auth` (opens WHOOP, waits for the callback)
  6. `node bin/whoop-energy.js sync`
  7. `node bin/whoop-energy.js status` to confirm

---

## Step 3: Run the matching command

| They asked about | Run |
|---|---|
| Today, their schedule, their energy | `node bin/whoop-energy.js today` |
| Sleep debt, trends, what to improve | `node bin/whoop-energy.js insights` |
| A report, something to keep or share | `node bin/whoop-energy.js report --out <path>` |
| Connecting WHOOP | `node bin/whoop-energy.js auth` |
| Refreshing the data | `node bin/whoop-energy.js sync` |
| Whether it is set up | `node bin/whoop-energy.js status` |

`$ARGUMENTS`, when given, is the command to run.

Show the terminal output as-is — it is already formatted and the user should see
their own numbers. Add a one-or-two-line read on top, not a restatement of the
table.

If the command exits `3`, they are not authenticated: point at Step 2 rather
than dumping the error. If it exits `4`, read the message — see the
troubleshooting table in README.md.

---

## Step 4: Planning questions

When the question is **"when should I do deep work / train / nap / go to bed / take
a meeting"**, do not just print the report. Run:

```bash
node bin/whoop-energy.js today --format json
```

Then read `energyDay.zones` and `energyDay.plan` and answer **in prose, with
times**. Minutes are local minutes-of-day (`452` = 07:32); values above 1440 are
the next morning.

- Deep work → the `morning_peak` and `evening_peak` zones, and the `deep_work` plan blocks
- Training → the `workout` plan block; its `reason` already names the recovery
  score and the HRV comparison that chose morning over evening
- Napping → the `nap` block if there is one; if there is not, say why (the rule
  needs debt ≥ 1 h and the nap to end ≥ 8 h before target bedtime)
- Bedtime → `targetBedtimeMin`, plus `wind_down` and `melatonin_window`
- Anything "am I too tired for X" → `debt.hours`, `debt.level` and `recovery.score`

Answer the question that was asked. One sentence of "why" from the zone or plan
`reason` is enough; the full schedule is what `today` is for.

## Step 5: Optimisation questions

When the question is **"how do I sleep better / recover faster / what should I
change"**, run:

```bash
node bin/whoop-energy.js insights --format json
```

Then:
1. Walk through `recommendations` in order — each has a `title`, a `why` and a
   concrete `action`. Lead with the highest-impact one and give the action, not
   the diagnosis.
2. Bring in `correlations` where one supports the recommendation — quote the
   `reading` and the `r`/`n`. Say plainly that these are associations in a
   fortnight of their own data, not proof.
3. Mention what is *already* fine. A short recommendation list means most
   thresholds were not crossed, and the user should hear that.

---

## Step 6: Offer the report

After any `today` or `insights` answer, offer once:

> Want this as an HTML report you can keep? It is one self-contained file —
> the energy curve, your zones, the day plan, 14 days of sleep-vs-need bars and
> the recommendations.

If yes: `node bin/whoop-energy.js report --out <path>` and give them the path.
Default it somewhere outside the repo (e.g. `~/whoop-energy-report.html`);
`whoop-energy/*.html` is git-ignored if they want it alongside the code.

---

## Notes

- Add `--demo` to any command to answer with synthetic data — useful for showing
  what the tool does before the user has connected an account. Always say when
  the numbers are demo numbers.
- `--now HH:MM` re-answers for a different time of day; `--need 7h30m` overrides
  sleep need; `--tz=-05:00` (the `=` form is required for negative offsets)
  overrides the timezone.
- `today` and `report` sync automatically when the cache is over 6 hours old.
  `insights` does not — run `sync` first if freshness matters.
- The model is a heuristic, and the tool is not medical advice. If the user
  describes persistent insomnia, daytime sleepiness or fatigue that the numbers
  do not explain, say that a doctor is the right next step.
