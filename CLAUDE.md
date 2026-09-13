# Rewyse AI — AI Digital Product Agent

A 10-phase pipeline that builds complete digital products in Notion — from idea
definition through content generation to polished delivery.

This directory is **standalone and exportable** — it contains everything needed
to run the full pipeline.

## Pipeline Phases

| Phase | Agent | What It Does |
|-------|-------|-------------|
| 0 | build-product | Orchestrates all phases, manages state |
| 1 | product-idea | Defines product type, niche, ICP, variables |
| 2 | build-database | Creates Notion database with properties, views |
| 3 | expert-profile | Builds domain expert persona for content voice |
| 4 | content-blueprint | Defines page structure, sections, word counts |
| 5 | write-prompt | Combines profile + blueprint into generation prompt |
| 6 | test-content | Generates 2-3 sample pages for review |
| 7 | generate-content | Batch processes all entries with parallel agents |
| 7.5 | generate-images | *(Optional)* Generates AI images for entries/homepage and uploads to Notion |
| 8 | design-product | Creates homepage, navigation, icons |
| 9 | product-qa | Scans for quality issues, flags for regen |
| 10 | product-expand | Suggests complementary products |

## Supporting Agents

- **home-page** — Creates Notion home pages with structured navigation
- **subpage-views** — Configures linked database views on subpages
- **prompt-generator** — Generates database creation prompts for product ideas
- **rewyse-help** — Q&A, troubleshooting, and project status for the pipeline
- **rewyse-onboard** — First-time setup guide and readiness check

## Standalone Tools

- **whoop-energy** — A zero-dependency Node CLI in `whoop-energy/` that turns WHOOP
  sleep data into a Rise-style circadian energy schedule. Not part of the 10-phase
  pipeline; runs on its own. See `whoop-energy/README.md`.

## Skills

### build-product
**Slash command:** `/build-product`
**Triggers:** "build a digital product", "create a product", "start product build",
"new product", "build a Notion product", "make a product from scratch"
**Description:** Orchestrates 10 specialized agents to build a complete digital product
in Notion — from idea definition through content generation to polished delivery.

### product-idea
**Slash command:** `/product-idea`
**Triggers:** "define a product idea", "plan a product", "choose product type",
"identify product variables", "start a new product"
**Description:** Defines product type, niche, ICP, and identifies fixed structure
vs variables for automated content generation.

### build-database
**Slash command:** `/build-database`
**Triggers:** "create a Notion database", "build product database", "set up database",
"configure content database"
**Description:** Creates a Notion database via REST API with properties, views,
status workflow (Draft → Published), and sample entries.

### expert-profile
**Slash command:** `/expert-profile`
**Triggers:** "build expert profile", "create expert persona", "define content voice",
"set writing tone for a product"
**Description:** Researches the product domain and builds a detailed expert persona
with voice, tone, vocabulary, perspective, and knowledge boundaries.

### content-blueprint
**Slash command:** `/content-blueprint`
**Triggers:** "define content structure", "create page template", "plan content blueprint",
"design page layout for a product"
**Description:** Defines the exact structure of every page — sections, order, detail level,
word counts, formatting rules, and variable dependencies.

### write-prompt
**Slash command:** `/write-prompt`
**Triggers:** "create generation prompt", "write content prompt", "build the prompt",
"assemble the AI prompt"
**Description:** Combines expert profile + content blueprint + database variables into
an optimized, parameterized content generation prompt.

### test-content
**Slash command:** `/test-content`
**Triggers:** "test content generation", "generate samples", "preview content",
"dry-run the content pipeline"
**Description:** Generates 2-3 sample pages for review and iteration before full
production. Traces quality issues to upstream artifacts.

### generate-content
**Slash command:** `/generate-content`
**Triggers:** "generate all content", "run production", "batch generate",
"fill database", "publish draft entries"
**Description:** Batch processes all Draft entries using parallel subagents, writes
content to Notion pages via API, and marks entries as Published.

### generate-images
**Slash command:** `/generate-images`
**Triggers:** "generate images for the product", "add cover art to entries", "illustrate
entries with AI", "create images for the homepage", "batch image generation",
"AI images for Notion pages"
**Description:** *(Optional Phase 7.5)* Generates AI images for the product using OpenAI
(`gpt-image-2`) or kie.ai (`gpt-image-2-text-to-image`). Three modes: cover-only (one
image per entry as page cover), multi-section (cover + N inline images placed after
target section headings — magazine layout for recipes, tutorials, case studies), or
style-batch (N images sharing a style, for the homepage). Cost-transparent — always shows
estimated spend with explicit hard-gate approval before any API call.

### design-product
**Slash command:** `/design-product`
**Triggers:** "design the product", "create homepage", "set up navigation",
"publish product", "make it look professional"
**Description:** Creates a polished homepage with browse sections, filtered views,
emoji icons, and a shareable Notion link.

### product-qa
**Slash command:** `/product-qa`
**Triggers:** "run QA", "check quality", "scan for issues", "audit content",
"review product quality"
**Description:** Scans all published pages against expert profile and content blueprint.
Flags repetitive phrasing, missing sections, tone drift, and thin content.

### product-expand
**Slash command:** `/product-expand`
**Triggers:** "suggest next products", "expand product line", "complementary products",
"grow digital product business"
**Description:** Analyzes completed product and suggests 3-5 complementary products
serving the same audience.

### home-page
**Slash command:** `/home-page`
**Triggers:** "create a home page", "build a home page", "edit home page layout",
"restructure home page", "set up navigation page", "organize sub-pages"
**Description:** Creates or edits Notion home pages with structured navigation —
callout intro, collapsible info toggles, section headers with 2-column sub-page layouts.

### subpage-views
**Slash command:** `/subpage-views`
**Triggers:** "create filtered list views", "set up linked database views", "delete old views",
"hide database titles", "configure subpage database displays", "bulk view setup"
**Description:** Configures linked database views on subpages at scale — creates filtered
list views, deletes old views, and hides database source titles.

### prompt-generator
**Slash command:** `/prompt-generator`
**Triggers:** "generate database prompts", "create notion prompts", "build database prompts",
"generate prompt for product", "batch generate prompts"
**Description:** Generates ready-to-paste Notion database creation prompts for digital product ideas.

### rewyse-help
**Slash command:** `/rewyse-help`
**Triggers:** "how does the product builder work", "what does this phase do", "why did it fail",
"what happens next", "help with Rewyse AI", "product builder question", "what went wrong",
"diagnose this error", "explain this output", "where am I in the build"
**Description:** Answers questions about the Rewyse AI pipeline — how phases work, what outputs mean,
why something failed, and what to do next. Context-aware of active projects. Three modes:
Ask (general Q&A), Diagnose (troubleshoot issues), Status (project dashboard).

### whoop-energy
**Slash command:** `/whoop-energy`
**Triggers:** "my energy schedule", "when should I do deep work", "when should I train today",
"what's my sleep debt", "WHOOP sleep insights", "plan my day around my sleep",
"when should I go to bed", "circadian rhythm schedule"
**Description:** Turns WHOOP sleep, recovery and strain data into a Rise-style circadian
energy schedule — grogginess, morning peak, afternoon dip, evening peak, wind-down and
melatonin window — plus sleep debt, a day plan (deep work / workout / admin / nap / bed),
14-day insights with correlations and ranked recommendations, and a self-contained HTML
report. Standalone Node 18+ CLI, zero dependencies, `--demo` mode needs no account.

### rewyse-onboard
**Slash command:** `/rewyse-onboard`
**Triggers:** "set up Rewyse AI", "first time product builder", "configure Notion integration",
"Rewyse AI prerequisites", "onboard to Rewyse AI", "how do I start building products",
"verify Rewyse AI setup", "check my setup"
**Description:** Guides first-time users through complete Rewyse AI setup — Node.js installation,
Notion integration creation, NOTION_TOKEN configuration, page sharing, MCP server verification,
and a pipeline walkthrough with tips for best results.

## Shared References

- `shared/notion-api-reference.md` — Notion API patterns and helpers
- `shared/product-types-reference.md` — Product type definitions and variables

## Scripts

Rewyse AI-specific Node.js scripts live in `scripts/` within this directory.

## Output

All product build output goes to `output/{project-slug}/`.

## Prerequisites

- Notion MCP server connected (`.mcp.json` → `notion`)
- Node.js 18+ installed

## Getting Started

- **First time?** Run `/rewyse-onboard` to set up prerequisites and learn the pipeline.
- **Ready to build?** Run `/build-product` to start a new product build.
- **Need help?** Run `/rewyse-help` for Q&A, troubleshooting, or project status.
- **Planning your day?** Run `/whoop-energy` for a circadian energy schedule from your WHOOP data.
