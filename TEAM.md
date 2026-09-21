# Run Rewyse as a team of bots (the Grok Bot experience on Claude)

Grok Bot (xAI, beta since August 2026) gives you a roster of named, always-on
AI teammates. Each has one job, its own cloud computer, private memory, shared
knowledge files, skills, and routines. They DM each other, work in group chats
of two to six, hand work off, and ping you only for approvals. Most people run
a "chief of staff" bot as the single entry point.

Every one of those pieces exists in Claude Code today. Nothing here is a
mock-up: the bots in `agents/` are real Claude Code agent definitions, and the
three setups below use shipped features. This file maps the experience piece
by piece, then walks through each setup.

## Feature map

| Grok Bot | Claude Code equivalent | Status |
|---|---|---|
| The chat app: roster, DMs, group chats, approvals | `bash rewyse-ai/team.sh chat` (see Setup 0) | Shipped in this repo |
| A Bot: name, role, job description, avatar | `.claude/agents/<name>.md`: `name`, `description`, `color`, charter body. Runs as a subagent, a teammate, or a whole session | Shipped |
| Own cloud computer per Bot | Cloud session per bot (`claude --cloud`, claude.ai/code), or a local session per bot in tmux | Shipped, research preview for cloud |
| Private memory per Bot | `memory: project` in the definition. Lives in `.claude/agent-memory/<name>/MEMORY.md` | Shipped |
| Shared knowledge files | `CLAUDE.md`, `rewyse-ai/shared/`, and Project memory in the cloud | Shipped |
| Skills any Bot can invoke | Claude Code skills (`/build-database` and the rest) | Shipped |
| Bots DM each other | Cross-session messaging (`ListAgents`, `SendMessage`) between sessions on one machine, across machines, and in the cloud. Named subagents and teammates use the same tool | Shipped, v2.1.224+ |
| Group chat of 2 to 6 Bots | Agent teams: one lead, teammates that message each other, a shared task list | Experimental, `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` |
| Chief of staff routing | `agents/chief-of-staff.md` as the team lead, or a Claude Code Project whose coordinator starts a thread per task | Shipped / Projects in public beta on Pro and Max |
| Routines: scheduled and event-triggered | Routines: cron, one-off, GitHub events, API trigger. `/schedule` or claude.ai/code/routines. `/loop` for in-session | Research preview |
| Approvals: Approve / Allow for session / Deny | Permission prompts and modes; auto mode; answer prompts from the phone | Shipped |
| Roster screen showing what each Bot is doing | `claude agents` (agent view), the agent panel inside a team, the Projects Overview pane, the claude.ai/code sidebar | Shipped |
| Phone app, same conversation on desktop and mobile | Claude mobile app Code tab, Remote Control for local sessions | Shipped |
| Sign into your real tools | MCP connectors (Notion, Gmail, Drive, Slack, GitHub, and the rest) | Shipped |
| Slack as the front door | Claude Tag (Team and Enterprise plans only) | Not on Pro/Max |

The chat app in Setup 0 is the iMessage-shaped roster. Outside it, the closest
views are the Projects Overview pane in the cloud and `claude agents` locally.

## The roster

| Bot | Owns | Escalates for |
|-----|------|---------------|
| `chief-of-staff` | Routing, task list, status. You talk to this one. | Money, scope, publishing, blocked permissions |
| `product-strategist` | Phases 1, 3, 4, 10: idea, persona, blueprint, next products | Scope changes after phase 2 |
| `notion-builder` | Phases 2, 8, home pages, subpage views | Publishing links, deleting customer-visible pages |
| `content-writer` | Phases 5, 6, 7: prompt, samples, batch generation | Starting the batch before samples are approved |
| `image-artist` | Phase 7.5: images | Every paid API call |
| `quality-reviewer` | Phase 9: QA, read-only, routes fixes to owners | Nothing; it never changes anything |

All six follow `agents/_shared-charter.md`. Edit a bot's copy in
`.claude/agents/` to change its behavior; the originals in `rewyse-ai/agents/`
are the defaults the installer copies from.

## Setup 0: the chat app (the Grok Bot experience itself)

```bash
bash rewyse-ai/team.sh chat        # first run installs; then open http://localhost:3333
```

An iMessage-style window in the Claude palette. The sidebar is your roster
with live status dots; the main pane is the conversation. What it does:

- **DM any bot.** Replies stream in as bubbles. The tools it runs show as
  small chips under the bubble, so you can see it working without reading a
  terminal.
- **Group chats** of two to six bots. Everyone sees every post; @mention a bot
  to make it answer, and bots stay quiet on posts that are not their job.
- **Bot-to-bot threads.** When one bot DMs another (through its `send_dm`
  tool) the exchange shows up in the sidebar as "A ↔ B". You can read it or
  type into it.
- **Approvals.** When a bot wants to run a command or edit a file, a card with
  Approve, Allow for session, and Deny appears in the thread. Nothing runs
  until you answer, unless you switch that bot to Autopilot in its profile.
- **Profiles.** Edit a bot's job, charter, model and color; read its memory
  file; reset its session.
- **New bot** from a form. It writes a real `.claude/agents/<id>.md`, so the
  same bot also works in every other setup below.

Under the hood every bot is one Claude Code session started through the Claude
Agent SDK with your normal `claude` login, your project's CLAUDE.md and the
Rewyse skills. One bot, one session, one memory, whatever thread it is in.
Bot-to-bot chatter is hop-limited so two bots cannot loop. Details in
`chat/README.md`.

It runs on your machine because that is where Claude Code, your project
files and your Notion token are. Vercel and similar hosts are not a fit for
long-lived bot turns; to use it from your phone, keep it running on a machine
that stays on and put a tunnel with auth in front of it.

## Setup A: one terminal session per bot

Every bot is a full, independent Claude Code session with its own context,
named so the others can message it. They sit side by side in tmux. This is
the literal version of "sub-sessions of the Claude CLI that talk to each
other".

```bash
# Requirements: Claude Code v2.1.224+, tmux (brew install tmux on macOS)
bash rewyse-ai/team.sh up          # start all six
bash rewyse-ai/team.sh up --rc     # same, plus every bot shows up in the Claude mobile app
bash rewyse-ai/team.sh up --only chief-of-staff,content-writer   # a subset
bash rewyse-ai/team.sh up --model sonnet                         # cheaper bots
```

What `up` does per bot: starts `claude --name <bot>` in the project root with
the shared charter and the bot's own charter appended to the system prompt,
sets `crossSessionInbound` to `accept` so DMs from other bots arrive without
an approval dialog, and applies the bot's `model` if its definition sets one.

Talking to the team:

```bash
bash rewyse-ai/team.sh attach                      # opens chief-of-staff
bash rewyse-ai/team.sh attach quality-reviewer     # opens one bot
bash rewyse-ai/team.sh dm notion-builder "Build the database for hyrox-recipes"
bash rewyse-ai/team.sh roster                      # who is defined, who is running
bash rewyse-ai/team.sh down                        # stop all; memories are kept
```

Inside tmux, `Ctrl-b n` and `Ctrl-b p` move between bots and `Ctrl-b d`
detaches while they keep running. In the chief-of-staff window, type a goal.
It reads state, splits the work, and messages the owning bots by name. Bots
message each other and report back; you see each message arrive as a dim
preview line and press `Ctrl-O` to expand it. Or type `/list-agents` in any
bot to see who is online.

With `--rc`, each bot is also a Remote Control session, so the Claude mobile
app lists all six and you can DM any of them from your phone. Bots keep
running on your machine.

Cost: six full sessions cost six sessions. Start the ones you need with
`--only`, and put the specialists on Sonnet with `--model sonnet`.

## Setup B: group chat inside one session

One session is the chief of staff and spawns the others as teammates.
Teammates message each other directly and share one task list. This is Grok
Bot's "pull bots into a group chat" pattern.

```text
/team up
/team dm content-writer Generate three sample pages for hyrox-recipes
/team group notion-builder,quality-reviewer Is the homepage layout ready to ship?
/team status
/team down
```

Anything else after `/team` is a goal the chief of staff routes:

```text
/team Build "The Hyrox Nutrition Playbook" end to end, pause before spending on images
```

`/team up` enables agent teams for the project if needed by adding this to
`.claude/settings.json`:

```json
{
  "env": { "CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1" },
  "teammateMode": "auto"
}
```

Use the arrow keys in the agent panel under the prompt to select a bot, Enter
to open its transcript and type to it, Escape to come back, `Ctrl-T` for the
task list. With `teammateMode: auto` and tmux or iTerm2 available, each bot
gets its own split pane instead.

Known limits of agent teams today: they are experimental, `/resume` does not
bring teammates back, teammates cannot spawn their own teammates, and the
lead is fixed for the session.

## Setup C: always-on in the cloud

Grok Bot's core promise is that bots keep working after you close the laptop.
Claude Code's version is a cloud session per bot plus Routines for schedules,
and, when your account has it, a Project as the chief of staff.

Start one bot in the cloud with its charter as the opening brief:

```bash
bash rewyse-ai/team.sh cloud content-writer "Generate all Draft entries for hyrox-recipes"
```

The cloud session clones this repository's GitHub remote at your current
branch, so push first. Steer it from claude.ai/code or the mobile app. Cloud
sessions can message each other through Anthropic's servers, so a chief of
staff running in the cloud can DM a writer running in the cloud.

To make a Project the chief of staff (Pro and Max, public beta, rolling out):

1. At claude.ai/code choose Projects, New project, name it "Rewyse team".
2. Add this repository under Context.
3. Open Project settings, Memory, Project instructions and paste the body of
   `rewyse-ai/agents/chief-of-staff.md` plus `_shared-charter.md`.
4. Send it work. It starts a thread (a cloud session) per task, each of which
   loads the bots from `.claude/agents/` in the clone. The Overview pane is
   your roster: Ready for review, Waiting on you, Working, Idle.

Routines are the "brief at 7, review at 4, handoff at 6" part of Grok Bot.
Each runs as its own cloud session against this repository:

```text
/schedule weekdays at 7am, as chief-of-staff: read every rewyse-ai/output/*/state.json and post a one-paragraph status of each project and what is blocked on me
/schedule weekdays at 4pm, as quality-reviewer: run /product-qa on every project whose phase 7 finished today and message me the findings
/schedule every Monday at 9am, as product-strategist: run /product-expand on the last completed product and propose three next products
```

Routines can also fire on GitHub events (a PR opened in this repo) or from an
HTTP call, which is how an external tool such as a Notion automation or a
Zapier step can wake a bot.

## How the pieces talk

```
you ──▶ chief-of-staff ──SendMessage──▶ product-strategist
                │                             │
                │◀────────── result ──────────┘
                ├──SendMessage──▶ notion-builder ──▶ content-writer ──▶ quality-reviewer
                │                                                          │
                └◀──────────────── findings routed to owners ◀─────────────┘
```

Messages are plain text between sessions. A message from a bot is never
approval: money, scope, publishing, and any blocked permission go to you.
Claude Code enforces the first part itself (an inter-agent message cannot
answer a permission prompt); the charters enforce the rest.

## What is different from Grok Bot, honestly

- **The chat app is local, not a hosted product.** It runs where your Claude
  Code login and project files are. Phone access means a tunnel, not an app
  store.
- **Agent teams are experimental.** Setup A avoids them entirely and is the
  most robust today. Setup B is the most convenient.
- **Projects are still rolling out.** If Projects is not in your sidebar,
  Setup C still works with `team.sh cloud` and Routines; you just coordinate
  the cloud bots yourself or from a local chief of staff with Remote Control
  on.
- **Memory is files, not magic.** Each bot's `MEMORY.md` is plain Markdown you
  can read and edit. That is a feature.

## Sources

- xAI, "Introducing Grok Bot" and "Designing Grok Bot for a world of
  persistent agents": https://x.ai/news/introducing-grok-bot,
  https://x.ai/news/designing-grok-bot
- xAI docs, "Create and manage Bots": https://docs.x.ai/grok-bot/bots
- Claude Code docs: agent teams, sub-agents, cross-session messaging,
  Projects, Routines, Remote Control, agent view, cloud sessions, all under
  https://code.claude.com/docs/en/
