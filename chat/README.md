# Claude Bots — the chat app

An iMessage-style app for the Rewyse bot team. Every bot in the sidebar is a
live Claude Code session running on your machine through the Claude Agent SDK,
with your normal `claude` login, your project's `CLAUDE.md`, and the Rewyse
skills.

```
bash rewyse-ai/team.sh chat        # installs on first run, then opens http://localhost:3333
```

## What you get

- **Roster**: one row per bot with a live status dot (idle, working, waiting
  for you), the last message, and unread counts. Bots come from
  `.claude/agents/*.md`.
- **DMs**: talk to any bot directly. Its replies stream in as bubbles; the
  tools it runs show as small chips ("Ran `node scripts/...`", "Ran
  /build-database").
- **Groups**: pick two to six bots. Everyone sees every post. @mention a bot to
  make it answer; bots stay quiet on posts that are not about their job.
- **Bot to bot**: when one bot DMs another (through its `send_dm` tool) the
  conversation appears in the sidebar as "A ↔ B" and you can read it, or join
  it by typing.
- **Approvals**: when a bot wants to run a command or edit a file and you
  have not switched it to Autopilot, a card appears with Approve, Allow for
  session, Deny. Nothing runs until you answer.
- **Profile pane**: edit a bot's job, charter, model and color; read its
  memory file; toggle Autopilot; reset its session.
- **New bot**: creates a real agent file, so the same bot also works from the
  terminal, as a subagent, or as a teammate.

## How it works

```
browser  ──ws──▶  server/index.ts  ──▶  Team (server/runtime.ts)
                                          │  one queue + one session per bot
                                          ▼
                                   @anthropic-ai/claude-agent-sdk query()
                                          │  systemPrompt = Claude Code preset
                                          │    + shared charter + bot charter
                                          │  mcpServers.team = list_bots, send_dm,
                                          │    post_to_group, message_human
                                          ▼
                                     claude (your login)
```

- A bot has one session and one memory no matter which thread it is in.
  Each delivered message is tagged with its thread; the bot's final reply is
  posted back to that thread.
- Bot-to-bot chatter is hop-limited (6 exchanges in a DM, 12 turns in a group
  per burst). When the limit hits, the thread pauses and your next message
  resumes it.
- A message from another bot is never treated as your approval. Permission
  prompts always come to you unless you switch that bot to Autopilot.
- State lives in `chat/data/state.json` (gitignored). Sessions resume across
  restarts.

## Configuration

| Variable | Meaning |
|---|---|
| `PORT` | HTTP port (default 3333) |
| `REWYSE_PROJECT_ROOT` | The Claude Code project to run bots in (default: the parent of `rewyse-ai/`) |
| `REWYSE_BOT_MODEL` | Force one model for every bot, e.g. `haiku` for a cheap dry run |

## Development

```
cd rewyse-ai/chat
npm install
npm run dev          # server on :3333 with reload, Vite UI on :5173
npm run typecheck
```

## Hosting

The server must run where Claude Code, your project files and your Notion
token live, which is your machine (or a VM you own). It is not a fit for
serverless hosts such as Vercel: bot turns are long-lived processes. To reach
it from your phone, run it on a machine that stays on and put it behind a
tunnel (Tailscale, Cloudflare Tunnel, ngrok) with authentication in front.
