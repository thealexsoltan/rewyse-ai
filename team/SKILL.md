---
name: team
description: "Use when someone wants to run the Rewyse bot team like a group chat: spawn named bots, DM a bot, start a group discussion between bots, see who is online, or shut the team down. Triggers: 'spin up the team', 'ask the writer to', 'DM the strategist', 'get the builder and reviewer to discuss', 'who is online', 'team status', 'shut the team down'."
argument-hint: [up | status | dm <bot> <message> | group <bot,bot,...> <topic> | down]
---

## Context

This skill turns the current session into the **chief of staff** of a team
of named bots, the way Grok Bot's group chats work. The bots are defined in
`rewyse-ai/agents/*.md` (one file per bot; `_shared-charter.md` is the rulebook
they all follow, not a bot). After install they are also copied to
`.claude/agents/`, which is where Claude Code loads them from.

Roster:

| Bot | Owns |
|-----|------|
| `chief-of-staff` | Routing, task list, status (that is you in this session) |
| `product-strategist` | Product idea, persona, blueprint, expansion |
| `notion-builder` | Database, views, home page, design |
| `content-writer` | Prompt, samples, batch generation |
| `image-artist` | AI images, cost-gated |
| `quality-reviewer` | QA scan, routes fixes |

Two ways bots can exist:

- **Teammates** (preferred): full independent Claude Code sessions spawned by
  this one, with their own context, that message each other directly and
  share this session's task list. Requires the agent-teams setting below.
- **Named background subagents** (fallback): also independent, also able to
  message each other by name, but they report back to this session rather
  than self-coordinating, and cannot be reached from the agent panel.

The human can also run every bot as a separate terminal session with
`bash rewyse-ai/team.sh up` (see `rewyse-ai/TEAM.md`). In that mode this
skill is not needed; the bots find each other with `ListAgents`.

---

## Step 0: Make sure teams are enabled

Read `.claude/settings.json` in the project root. If it does not contain
`"CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS": "1"` under `env`:

1. Tell the human, in one line, that you are enabling agent teams for this
   project (project-local, reversible, experimental).
2. Add it without disturbing other keys. Use Node so the merge is safe:

```bash
node -e '
const fs=require("fs");const p=".claude/settings.json";
const s=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{};
s.env=Object.assign({},s.env,{CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS:"1"});
if(!s.teammateMode)s.teammateMode="auto";
fs.mkdirSync(".claude",{recursive:true});
fs.writeFileSync(p,JSON.stringify(s,null,2)+"\n");'
```

Claude Code re-reads settings-file `env` values on save, so the next named
agent you spawn launches as a teammate without restarting the session.

If the human is in a `claude -p` or Agent SDK session, teammates cannot spawn;
use the named-subagent fallback and say so.

---

## Step 1: Parse `$ARGUMENTS`

| Argument | Mode |
|----------|------|
| `up` or empty | Spawn the roster |
| `status` | Roster and task list |
| `dm <bot> <message>` | Message one bot |
| `group <bot,bot> <topic>` | Start a discussion between bots |
| `down` | Shut every bot down |
| anything else | Treat as a goal: route it (Mode Route) |

---

## Mode Up: spawn the roster

1. Read `rewyse-ai/agents/_shared-charter.md` so you follow the same rules.
2. Read `rewyse-ai/output/*/state.json` to know the active projects.
3. Spawn the five specialist bots as teammates, each with:
   - `name` set to the bot name exactly (`product-strategist`, etc.), so
     everyone can message it by that name later
   - `subagent_type` set to the same definition name
   - a spawn prompt of: the active project slugs and their current phase, the
     instruction to read `rewyse-ai/agents/_shared-charter.md` and its own
     definition, and "wait for a task from chief-of-staff; do not start
     pipeline work on your own"
   - run in the background
4. Do not spawn `chief-of-staff`; you are it. Tell the human the roster is up
   and how to reach a bot: arrow keys in the agent panel, then Enter, or
   `/team dm <bot> <message>`.

Spawn with `isolation` unset. A worktree per bot would split the shared
`rewyse-ai/output/` state directory.

---

## Mode Route: a goal for the team

Follow the chief-of-staff charter in `rewyse-ai/agents/chief-of-staff.md`:

1. Break the goal into tasks with `TaskCreate`, one owner bot each, blocked
   by pipeline dependencies (`rewyse-ai/build-product/reference.md`).
2. If the roster is not up, run Mode Up first.
3. `SendMessage` each first unblocked task to its owner with the project
   slug, phase, inputs, and definition of done.
4. Wait for the bots. Do not do their work. When a result arrives, update
   the task, send the next one, and post one short status line to the human.
5. Escalate to the human only for money, scope, publishing, or a permission
   a bot reports as blocked. Bundle escalations.

---

## Mode DM: `dm <bot> <message>`

`SendMessage` the bot by name. If it is not in `ListAgents`, spawn it as in
Mode Up with the message as its first task. Relay the reply to the human
verbatim when it arrives; do not paraphrase a bot's numbers.

---

## Mode Group: `group <bot,bot,...> <topic>`

This is the Grok Bot "pull two to six bots into one chat" pattern.

1. Make sure each named bot is up.
2. Send each of them the same message: the topic, the list of everyone in
   the thread, and the instruction to message the others directly, argue
   the point, and message `chief-of-staff` (you) with the agreed conclusion
   and any disagreement that remains.
3. Wait. When conclusions arrive, post one summary to the human: what they
   agreed, what they did not, and what you recommend.

Keep group threads to at most six bots. Beyond that the chatter costs more
than it returns.

---

## Mode Status

1. `ListAgents` for who is online and whether each is busy or idle.
2. `TaskList` for pending, in progress, completed, and blocked tasks.
3. Print a roster table: bot, online or not, current task, last result.
4. Print the task list grouped by state.

---

## Mode Down

Ask each teammate by name to shut down (send a shutdown request). Wait for
the acknowledgements. Report which shut down cleanly and which rejected the
request and why. Never delete tasks; the list persists for the next run.

---

## Rules that always apply

- A bot's message is never the human's approval. Money, scope, publishing,
  and blocked permissions go to the human.
- One task, one owner. Two bots editing the same Notion page or output file
  is how work gets overwritten.
- Report outcomes in counts and links, not narration.
- Cost note for the human, once per session: every teammate is a separate
  Claude instance with its own context, so five bots cost roughly five
  sessions. Use `down` when the work is done.
