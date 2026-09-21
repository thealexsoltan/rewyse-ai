#!/bin/bash
# Rewyse AI — Installer
# Installs the Rewyse AI digital product pipeline into your Claude Code project.
# Compatible with bash 3.2+ (macOS default)

set -e

BLUE='\033[0;34m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo ""
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${BLUE}  Rewyse AI — AI Digital Product Agent${NC}"
echo -e "${BLUE}  Installing into your Claude Code project...${NC}"
echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

# Detect project root (go up from the cloned directory)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
INSTALL_DIR="$PROJECT_ROOT/rewyse-ai"

# Check if already in the right place
if [ "$(basename "$SCRIPT_DIR")" = "rewyse-ai" ]; then
  echo -e "${GREEN}[ok]${NC} Already installed at $SCRIPT_DIR"
else
  # Move the cloned repo to rewyse-ai/ in the parent directory
  if [ -d "$INSTALL_DIR" ]; then
    echo -e "${YELLOW}[!]${NC} rewyse-ai/ already exists at $INSTALL_DIR"
    echo "    Remove it first or install manually."
    exit 1
  fi
  mv "$SCRIPT_DIR" "$INSTALL_DIR"
  SCRIPT_DIR="$INSTALL_DIR"
  echo -e "${GREEN}[ok]${NC} Moved to $INSTALL_DIR"
fi

# Create output and scripts directories (gitignored, needed at runtime)
mkdir -p "$INSTALL_DIR/output"
mkdir -p "$INSTALL_DIR/scripts"
echo -e "${GREEN}[ok]${NC} Created output/ and scripts/ directories"

# Register all slash commands in .claude/skills/
SKILLS_DIR="$PROJECT_ROOT/.claude/skills"
SKILL_COUNT=0

# Helper function: create a skill stub if it doesn't exist
create_skill() {
  local name="$1"
  local desc="$2"
  local arg_hint="$3"
  local body="$4"

  local skill_dir="$SKILLS_DIR/$name"
  local skill_file="$skill_dir/SKILL.md"

  if [ -f "$skill_file" ]; then
    return
  fi

  mkdir -p "$skill_dir"

  if [ -n "$arg_hint" ]; then
    printf "%s\n" "---" "name: $name" "description: $desc" "$arg_hint" "---" "" > "$skill_file"
  else
    printf "%s\n" "---" "name: $name" "description: $desc" "---" "" > "$skill_file"
  fi

  printf "%b\n" "$body" >> "$skill_file"
  SKILL_COUNT=$((SKILL_COUNT + 1))
}

create_skill "build-product" \
  "Build a complete digital product in Notion — orchestrates 10 phases from idea to polished delivery." \
  "argument-hint: [project-name]" \
  "Read and follow the full instructions in \`rewyse-ai/build-product/SKILL.md\`.\n\nBefore starting, also read:\n- \`rewyse-ai/build-product/reference.md\`\n- \`rewyse-ai/shared/notion-api-reference.md\`\n- \`rewyse-ai/shared/product-types-reference.md\`"

create_skill "product-idea" \
  "Define a product idea — type, niche, ICP, variables, and delivery mode for a digital product." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/product-idea/SKILL.md\`."

create_skill "build-database" \
  "Create a Notion database with properties, views, status workflow, and sample entries." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/build-database/SKILL.md\`.\n\nAlso read \`rewyse-ai/shared/notion-api-reference.md\` for API patterns."

create_skill "expert-profile" \
  "Build a domain expert persona — voice, tone, vocabulary, and perspective for content generation." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/expert-profile/SKILL.md\`."

create_skill "content-blueprint" \
  "Define the page structure — sections, word counts, formatting rules, and variable dependencies." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/content-blueprint/SKILL.md\`."

create_skill "write-prompt" \
  "Assemble expert profile + content blueprint into an optimized generation prompt." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/write-prompt/SKILL.md\`."

create_skill "test-content" \
  "Generate 2-3 sample pages for review — the quality gate before full production." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/test-content/SKILL.md\`."

create_skill "generate-content" \
  "Batch-generate all content using parallel agents and publish to Notion." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/generate-content/SKILL.md\`.\n\nAlso read \`rewyse-ai/shared/notion-api-reference.md\` for API patterns."

create_skill "generate-images" \
  "Generate AI images for product entries or homepage via OpenAI or kie.ai. Three modes: cover-only, multi-section (cover + section images per entry), style-batch. Optional Phase 7.5." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/generate-images/SKILL.md\`.\n\nAlso read:\n- \`rewyse-ai/generate-images/reference.md\`\n- \`rewyse-ai/shared/notion-api-reference.md\`"

create_skill "design-product" \
  "Create a polished homepage with browse sections, filtered views, icons, and shareable link." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/design-product/SKILL.md\`.\n\nAlso read:\n- \`rewyse-ai/design-product/reference.md\`\n- \`rewyse-ai/shared/notion-api-reference.md\`"

create_skill "product-qa" \
  "Scan all published pages for quality issues — repetition, missing sections, tone drift." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/product-qa/SKILL.md\`."

create_skill "product-expand" \
  "Suggest 3-5 complementary products to build next for the same audience." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/product-expand/SKILL.md\`."

create_skill "home-page" \
  "Create or edit Notion home pages with structured navigation and 2-column layouts." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/home-page/SKILL.md\`.\n\nAlso read \`rewyse-ai/home-page/reference.md\`."

create_skill "subpage-views" \
  "Configure linked database views on subpages — create filtered views, delete old views, hide titles." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/subpage-views/SKILL.md\`.\n\nAlso read \`rewyse-ai/subpage-views/reference.md\`."

create_skill "prompt-generator" \
  "Generate ready-to-paste Notion database creation prompts for digital product ideas." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/prompt-generator/SKILL.md\`."

create_skill "rewyse-help" \
  "Ask questions about the Rewyse AI pipeline, troubleshoot errors, or check project status." \
  "argument-hint: [question]" \
  "Read and follow the full instructions in \`rewyse-ai/rewyse-help/SKILL.md\`.\n\nAlso read \`rewyse-ai/rewyse-help/reference.md\` for FAQ, error catalog, and phase summaries."

create_skill "rewyse-onboard" \
  "First-time setup guide — Node.js, Notion integration, NOTION_TOKEN, and pipeline walkthrough." \
  "" \
  "Read and follow the full instructions in \`rewyse-ai/rewyse-onboard/SKILL.md\`.\n\nAlso read \`rewyse-ai/rewyse-onboard/reference.md\` for setup guides and troubleshooting."

create_skill "team" \
  "Run the Rewyse bot team like a group chat — spawn named bots, DM one, start a discussion between bots, check who is online, or shut the team down." \
  "argument-hint: [up | status | dm <bot> <message> | group <bot,bot> <topic> | down]" \
  "Read and follow the full instructions in \`rewyse-ai/team/SKILL.md\`.\n\nThe bots are defined in \`rewyse-ai/agents/\` and follow \`rewyse-ai/agents/_shared-charter.md\`."

if [ "$SKILL_COUNT" -gt 0 ]; then
  echo -e "${GREEN}[ok]${NC} Registered $SKILL_COUNT new slash commands in .claude/skills/"
else
  echo -e "${GREEN}[ok]${NC} All 18 slash commands already registered in .claude/skills/"
fi

# Register the bot team in .claude/agents/ so Claude Code can spawn each bot
# by name (as a subagent, an agent-team teammate, or via --agent).
# Only files with frontmatter are bots; _shared-charter.md is their rulebook
# and stays in rewyse-ai/agents/ where the bots reference it.
AGENTS_SRC="$SCRIPT_DIR/agents"
AGENTS_DST="$PROJECT_ROOT/.claude/agents"
AGENT_COUNT=0
if [ -d "$AGENTS_SRC" ]; then
  mkdir -p "$AGENTS_DST"
  for agent_file in "$AGENTS_SRC"/*.md; do
    agent_name="$(basename "$agent_file")"
    case "$agent_name" in _*) continue ;; esac
    if [ ! -f "$AGENTS_DST/$agent_name" ]; then
      cp "$agent_file" "$AGENTS_DST/$agent_name"
      AGENT_COUNT=$((AGENT_COUNT + 1))
    fi
  done
fi
if [ "$AGENT_COUNT" -gt 0 ]; then
  echo -e "${GREEN}[ok]${NC} Registered $AGENT_COUNT bots in .claude/agents/ (edit them there to customize)"
else
  echo -e "${GREEN}[ok]${NC} All bots already registered in .claude/agents/"
fi

# Add Rewyse AI registration to root CLAUDE.md if not already present
CLAUDE_MD="$PROJECT_ROOT/CLAUDE.md"
if [ -f "$CLAUDE_MD" ]; then
  if grep -q "rewyse-ai" "$CLAUDE_MD" 2>/dev/null; then
    echo -e "${GREEN}[ok]${NC} CLAUDE.md already has Rewyse AI registration"
  else
    cat >> "$CLAUDE_MD" << 'REGISTRATION'

---

### Rewyse AI — AI Digital Product Agent (`rewyse-ai/`)

See `rewyse-ai/CLAUDE.md` for full pipeline documentation.

**Quick start:**
- `/rewyse-onboard` — First-time setup guide
- `/build-product` — Build a new digital product
- `/rewyse-help` — Q&A and troubleshooting

**All commands:** `/build-product`, `/product-idea`, `/build-database`, `/expert-profile`,
`/content-blueprint`, `/write-prompt`, `/test-content`, `/generate-content`,
`/generate-images`, `/design-product`, `/product-qa`, `/product-expand`, `/home-page`,
`/subpage-views`, `/prompt-generator`, `/rewyse-help`, `/rewyse-onboard`, `/team`

**Bot team:** `/team up` spawns named bots (chief-of-staff, product-strategist, notion-builder,
content-writer, image-artist, quality-reviewer) that message each other. Terminal roster:
`bash rewyse-ai/team.sh up`. See `rewyse-ai/TEAM.md`.
REGISTRATION
    echo -e "${GREEN}[ok]${NC} Added Rewyse AI registration to CLAUDE.md"
  fi
else
  cat > "$CLAUDE_MD" << 'NEWCLAUDE'
# Project Instructions

## Rewyse AI — AI Digital Product Agent (`rewyse-ai/`)

See `rewyse-ai/CLAUDE.md` for full pipeline documentation.

**Quick start:**
- `/rewyse-onboard` — First-time setup guide
- `/build-product` — Build a new digital product
- `/rewyse-help` — Q&A and troubleshooting

**All commands:** `/build-product`, `/product-idea`, `/build-database`, `/expert-profile`,
`/content-blueprint`, `/write-prompt`, `/test-content`, `/generate-content`,
`/generate-images`, `/design-product`, `/product-qa`, `/product-expand`, `/home-page`,
`/subpage-views`, `/prompt-generator`, `/rewyse-help`, `/rewyse-onboard`, `/team`

**Bot team:** `/team up` spawns named bots (chief-of-staff, product-strategist, notion-builder,
content-writer, image-artist, quality-reviewer) that message each other. Terminal roster:
`bash rewyse-ai/team.sh up`. See `rewyse-ai/TEAM.md`.
NEWCLAUDE
  echo -e "${GREEN}[ok]${NC} Created CLAUDE.md with Rewyse AI registration"
fi

echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}  Installation complete!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Open Claude Code in this project directory"
echo "  2. Run /rewyse-onboard to set up prerequisites"
echo "     (Notion integration, NOTION_TOKEN, Node.js)"
echo "  3. Run /build-product to create your first digital product"
echo "  4. Want a team of bots that talk to each other? Run /team up,"
echo "     or bash rewyse-ai/team.sh up for one terminal session per bot"
echo ""
echo "  Need help? Run /rewyse-help anytime."
echo ""
