#!/bin/bash
# Rewyse AI — Team launcher
# Runs every Rewyse bot as its own named Claude Code session, side by side in
# tmux, so they can message each other and you can talk to any of them.
# This is the terminal equivalent of a Grok Bot roster.
#
# Usage (run from anywhere inside your project):
#   bash rewyse-ai/team.sh up [--rc] [--model <model>] [--only bot,bot]
#   bash rewyse-ai/team.sh attach [bot]
#   bash rewyse-ai/team.sh dm <bot> "<message>"
#   bash rewyse-ai/team.sh roster
#   bash rewyse-ai/team.sh cloud <bot> "<task>"
#   bash rewyse-ai/team.sh chat            (iMessage-style app at http://localhost:3333)
#   bash rewyse-ai/team.sh down
#
# Compatible with bash 3.2+ (macOS default). Requires tmux for `up`.

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
AGENTS_DIR="$SCRIPT_DIR/agents"
SESSION="rewyse-team"
ROSTER="chief-of-staff product-strategist notion-builder content-writer image-artist quality-reviewer"

usage() {
  sed -n '2,15p' "$0" | sed 's/^# \{0,1\}//'
  exit 1
}

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo -e "${RED}[x]${NC} '$1' is required. $2"
    exit 1
  fi
}

# Frontmatter value for a bot, e.g. field "model"
fm() {
  awk -v key="$2" '
    NR==1 && $0=="---" {infm=1; next}
    infm && $0=="---" {exit}
    infm && index($0, key":")==1 {sub("^"key":[ ]*", ""); print; exit}
  ' "$AGENTS_DIR/$1.md"
}

# Body (everything after the frontmatter) for a bot
body() {
  awk '
    NR==1 && $0=="---" {infm=1; next}
    infm && $0=="---" {infm=0; started=1; next}
    started {print}
  ' "$AGENTS_DIR/$1.md"
}

bot_exists() {
  [ -f "$AGENTS_DIR/$1.md" ]
}

# The charter a bot session runs with: shared rules + its own definition body.
charter() {
  printf '%s\n\n---\n\n%s\n\n---\n\nYour session name is "%s". Other bots on this machine can message you by that name, and you reach them with ListAgents and SendMessage. Project root: %s\n' \
    "$(cat "$AGENTS_DIR/_shared-charter.md")" "$(body "$1")" "$1" "$PROJECT_ROOT"
}

cmd_up() {
  need tmux "Install it with 'brew install tmux' (macOS) or your package manager."
  need claude "Install Claude Code first: https://code.claude.com/docs/en/quickstart"

  local rc=0 model="" only=""
  while [ $# -gt 0 ]; do
    case "$1" in
      --rc) rc=1 ;;
      --model) model="$2"; shift ;;
      --only) only="$2"; shift ;;
      *) echo -e "${RED}[x]${NC} Unknown option: $1"; usage ;;
    esac
    shift
  done

  if tmux has-session -t "$SESSION" 2>/dev/null; then
    echo -e "${YELLOW}[!]${NC} Team is already running. Use 'attach' or 'down'."
    exit 1
  fi

  local bots="$ROSTER"
  if [ -n "$only" ]; then
    bots="$(echo "$only" | tr ',' ' ')"
  fi

  echo ""
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${BLUE}  Rewyse AI — starting the bot team${NC}"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  local first=1 bot
  for bot in $bots; do
    if ! bot_exists "$bot"; then
      echo -e "${RED}[x]${NC} No such bot: $bot (see $AGENTS_DIR)"
      continue
    fi

    local tmpdir="${TMPDIR:-/tmp}/rewyse-team"
    mkdir -p "$tmpdir"
    local charter_file="$tmpdir/$bot.md"
    charter "$bot" > "$charter_file"

    local bot_model="$model"
    [ -z "$bot_model" ] && bot_model="$(fm "$bot" model)"
    [ "$bot_model" = "inherit" ] && bot_model=""

    # Build the claude command. Each bot:
    #  --name                 addressable by name from every other session
    #  --append-system-prompt keeps Claude Code's default prompt, adds the charter
    #  --settings             deliver peer messages without an approval dialog
    local cmd="claude --name '$bot' --append-system-prompt-file '$charter_file' --settings '{\"crossSessionInbound\":\"accept\"}'"
    [ -n "$bot_model" ] && cmd="$cmd --model '$bot_model'"
    [ "$rc" = "1" ] && cmd="$cmd --remote-control '$bot'"

    if [ "$first" = "1" ]; then
      tmux new-session -d -s "$SESSION" -n "$bot" -c "$PROJECT_ROOT" "$cmd"
      first=0
    else
      tmux new-window -t "$SESSION" -n "$bot" -c "$PROJECT_ROOT" "$cmd"
    fi
    echo -e "${GREEN}[ok]${NC} $bot"
  done

  tmux select-window -t "$SESSION:chief-of-staff" 2>/dev/null || true

  echo ""
  echo -e "${GREEN}Team is up.${NC} Each bot is a full Claude Code session in its own tmux window."
  echo ""
  echo "  Talk to the team:   bash rewyse-ai/team.sh attach          (opens chief-of-staff)"
  echo "  Talk to one bot:    bash rewyse-ai/team.sh attach content-writer"
  echo "  Send a DM:          bash rewyse-ai/team.sh dm notion-builder \"Build the database for hyrox-recipes\""
  echo "  Who is online:      bash rewyse-ai/team.sh roster"
  echo "  Shut down:          bash rewyse-ai/team.sh down"
  echo ""
  echo "  Inside tmux: Ctrl-b n / Ctrl-b p switch bots, Ctrl-b d detaches (bots keep running)."
  if [ "$rc" = "1" ]; then
    echo ""
    echo "  Remote Control is on: every bot appears as its own session at claude.ai/code"
    echo "  and in the Claude mobile app, so you can DM any of them from your phone."
  fi
  echo ""
}

cmd_attach() {
  need tmux "Install it with 'brew install tmux' (macOS) or your package manager."
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo -e "${RED}[x]${NC} Team is not running. Start it with: bash rewyse-ai/team.sh up"
    exit 1
  fi
  local bot="${1:-chief-of-staff}"
  tmux select-window -t "$SESSION:$bot" 2>/dev/null || {
    echo -e "${RED}[x]${NC} No window for bot: $bot"
    exit 1
  }
  if [ -n "$TMUX" ]; then
    tmux switch-client -t "$SESSION"
  else
    tmux attach -t "$SESSION"
  fi
}

cmd_dm() {
  need tmux "Install it with 'brew install tmux' (macOS) or your package manager."
  local bot="$1"; shift || true
  local msg="$*"
  if [ -z "$bot" ] || [ -z "$msg" ]; then
    echo -e "${RED}[x]${NC} Usage: bash rewyse-ai/team.sh dm <bot> \"<message>\""
    exit 1
  fi
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo -e "${RED}[x]${NC} Team is not running. Start it with: bash rewyse-ai/team.sh up"
    exit 1
  fi
  # Type the message into that bot's prompt and submit it.
  tmux send-keys -t "$SESSION:$bot" -l "$msg"
  tmux send-keys -t "$SESSION:$bot" Enter
  echo -e "${GREEN}[ok]${NC} Sent to $bot. Read the reply with: bash rewyse-ai/team.sh attach $bot"
}

cmd_roster() {
  echo ""
  echo -e "${BLUE}Bots defined${NC} ($AGENTS_DIR):"
  local f name desc
  for f in "$AGENTS_DIR"/*.md; do
    name="$(basename "$f" .md)"
    case "$name" in _*) continue ;; esac
    desc="$(fm "$name" description | cut -c1-90)"
    printf "  %-20s %s\n" "$name" "$desc"
  done
  echo ""
  if command -v tmux >/dev/null 2>&1 && tmux has-session -t "$SESSION" 2>/dev/null; then
    echo -e "${BLUE}Bots running${NC} (tmux session '$SESSION'):"
    tmux list-windows -t "$SESSION" -F "  #{window_name}" 2>/dev/null
  else
    echo -e "${YELLOW}Team is not running.${NC} Start it with: bash rewyse-ai/team.sh up"
  fi
  echo ""
  if command -v claude >/dev/null 2>&1; then
    echo -e "${BLUE}Sessions Claude Code can see${NC} (claude agents --json):"
    claude agents --json 2>/dev/null | node -e '
      let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{
        try{const a=JSON.parse(s);if(!a.length){console.log("  (none)");return;}
          for(const x of a){console.log("  "+(x.name||x.title||x.sessionId||"?")+"  "+(x.status||x.state||""));}
        }catch(e){console.log("  (unavailable)");}
      });' 2>/dev/null || echo "  (unavailable)"
    echo ""
  fi
}

cmd_cloud() {
  need claude "Install Claude Code first: https://code.claude.com/docs/en/quickstart"
  local bot="$1"; shift || true
  local task="$*"
  if [ -z "$bot" ] || [ -z "$task" ]; then
    echo -e "${RED}[x]${NC} Usage: bash rewyse-ai/team.sh cloud <bot> \"<task>\""
    exit 1
  fi
  if ! bot_exists "$bot"; then
    echo -e "${RED}[x]${NC} No such bot: $bot"
    exit 1
  fi
  # A cloud session clones this repo's GitHub remote at the current branch,
  # so the bot definitions must be pushed first.
  echo -e "${BLUE}[..]${NC} Starting an always-on cloud session for $bot ..."
  cd "$PROJECT_ROOT"
  claude --cloud "$(printf 'You are the Rewyse bot "%s". Read rewyse-ai/agents/_shared-charter.md and rewyse-ai/agents/%s.md and follow them for this whole session.\n\nTask: %s' "$bot" "$bot" "$task")"
}

cmd_chat() {
  need node "Install Node.js 18+ first: https://nodejs.org"
  need claude "Install Claude Code first: https://code.claude.com/docs/en/quickstart"
  local chat_dir="$SCRIPT_DIR/chat"
  if [ ! -d "$chat_dir/node_modules" ]; then
    echo -e "${BLUE}[..]${NC} First run: installing the chat app's dependencies..."
    (cd "$chat_dir" && npm install --no-fund --no-audit) || exit 1
  fi
  echo -e "${BLUE}[..]${NC} Starting Claude Bots (project root: $PROJECT_ROOT)"
  cd "$chat_dir" && REWYSE_PROJECT_ROOT="$PROJECT_ROOT" npm start
}

cmd_down() {
  need tmux "Install it with 'brew install tmux' (macOS) or your package manager."
  if ! tmux has-session -t "$SESSION" 2>/dev/null; then
    echo -e "${YELLOW}[!]${NC} Team is not running."
    exit 0
  fi
  tmux kill-session -t "$SESSION"
  echo -e "${GREEN}[ok]${NC} Team shut down. Bot memories in .claude/agent-memory/ are kept."
}

case "${1:-}" in
  up)      shift; cmd_up "$@" ;;
  attach)  shift; cmd_attach "$@" ;;
  dm)      shift; cmd_dm "$@" ;;
  roster)  shift; cmd_roster "$@" ;;
  cloud)   shift; cmd_cloud "$@" ;;
  chat)    shift; cmd_chat "$@" ;;
  down)    shift; cmd_down "$@" ;;
  *)       usage ;;
esac
