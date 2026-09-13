# Rewyse AI — AI Digital Product Agent

Build complete digital products in Notion using AI. Describe your product idea, and Rewyse AI handles everything — database creation, writing voice, content structure, AI-powered content generation, homepage design, and quality assurance.

**10 phases. One command. A finished product.**

---

## What It Builds

Rewyse AI creates Notion-based digital products with dozens to hundreds of AI-generated pages. Each page is written by a custom expert persona, structured to a content blueprint, and quality-checked before delivery.

**Supported product types:**

| Type | Example |
|------|---------|
| Ebook | "The Hyrox Nutrition Playbook" — 20 chapters on race-day fueling |
| SOP | "Agency Onboarding SOPs" — 50 step-by-step procedures |
| Workbook | "The Brand Strategy Workbook" — 30 interactive exercises |
| Template | "100 Email Templates for Real Estate Agents" |
| Checklist | "The Product Launch Checklist Library" — 40 checklists |
| Guide / Playbook | "Growth Channel Playbooks" — 25 marketing guides |
| Prompt Pack | "200 ChatGPT Prompts for Content Creators" |
| Swipe File | "High-Converting Landing Page Swipe File" — 75 examples |
| Scripts | "50 Sales Call Scripts for Coaches" |
| Online Course | "Complete Pinterest Marketing Course" — 30 lessons |

---

## Quick Install

**One command** — run this in your Claude Code project directory:

```bash
git clone https://github.com/thealexsoltan/rewyse-ai && bash rewyse-ai/install.sh
```

No GitHub account or access token needed — just paste and run.

---

## Staying Up To Date

When a new version ships, run this to update:

```bash
cd rewyse-ai && bash update.sh
```

That's the whole update flow. The script:

- Saves any local edits you've made (stashed automatically)
- Pulls the latest version from GitHub
- Registers any new slash commands
- Restores your local edits
- Prints a summary of what's new

Your products in `output/` and your existing slash commands are never touched.

You can also paste this into Claude Code chat and it'll do it for you:

```
Update Rewyse AI to the latest version.
```

---

## Prerequisites

| Requirement | Why |
|---|---|
| **Claude Code** | The AI assistant that runs Rewyse AI |
| **Node.js 18+** | Runs scripts that interact with the Notion API |
| **Notion account** | Where your products are created and delivered |
| **Notion integration** | Gives Rewyse AI permission to read/write your Notion workspace |

Don't worry about setting these up manually — run `/rewyse-onboard` after install and it walks you through everything step by step.

---

## Getting Started

1. **Install** using the command above
2. **Run `/rewyse-onboard`** — guided setup for prerequisites (Node.js, Notion integration, API token)
3. **Run `/build-product`** — start building your first digital product

That's it. The pipeline guides you through every decision with approval gates at each phase.

---

## How It Works

Rewyse AI runs 10 sequential phases, each handled by a specialized AI agent:

| Phase | What Happens |
|-------|-------------|
| 1. **Product Idea** | Define what to build — product type, niche, audience, variables |
| 2. **Build Database** | Create a Notion database with properties and sample entries |
| 3. **Expert Profile** | Build a writing persona — voice, tone, vocabulary, expertise |
| 4. **Content Blueprint** | Define page structure — sections, word counts, formatting |
| 5. **Write Prompt** | Combine expert + blueprint into a generation prompt |
| 6. **Test Content** | Generate 2-3 sample pages for review (quality gate) |
| 7. **Generate Content** | Batch-generate all content in parallel, write to Notion |
| 7.5. **Generate Images** *(optional)* | Generate AI cover images for entries — or full magazine layouts with cover + inline section images — via OpenAI or kie.ai. Your API key, your spend. See [IMAGES-QUICKSTART.md](IMAGES-QUICKSTART.md) for the full how-to. |
| 8. **Design Product** | Create homepage with navigation, icons, shareable link |
| 9. **Product QA** | Scan every page for quality issues |
| 10. **Product Expand** | Suggest complementary products to build next |

**Time to build:** 45-120 minutes depending on product size.

Every phase pauses for your approval. You can go back, revise, or skip ahead. If you close mid-build, run `/build-product {project-name}` to resume exactly where you left off.

---

## All Commands

| Command | What It Does |
|---------|-------------|
| `/build-product` | Start or resume a full product build |
| `/product-idea` | Define a product idea (standalone) |
| `/build-database` | Create a Notion database |
| `/expert-profile` | Build an expert writing persona |
| `/content-blueprint` | Define page content structure |
| `/write-prompt` | Assemble the generation prompt |
| `/test-content` | Generate test samples |
| `/generate-content` | Batch-generate all content |
| `/generate-images` | *(Optional)* Generate AI cover images via OpenAI or kie.ai |
| `/design-product` | Create homepage and navigation |
| `/product-qa` | Run quality assurance scan |
| `/product-expand` | Suggest complementary products |
| `/rewyse-help` | Ask questions, troubleshoot, check status |
| `/rewyse-onboard` | First-time setup walkthrough |
| `/whoop-energy` | *(Standalone)* Circadian energy schedule from your WHOOP data |

---

## Whoop Energy

A standalone tool that ships alongside the pipeline. Point it at your WHOOP band and it
turns your sleep, recovery and strain data into a Rise-style circadian energy schedule —
when you will be sharp, when you will dip, when to train, and what time to go to bed
tonight — plus a 14-day sleep-debt report and a self-contained HTML export.

Node 18+, zero dependencies, and `--demo` mode runs the whole thing without an account.
See **[whoop-energy/README.md](whoop-energy/README.md)**, or just run `/whoop-energy`.

---

## Tips for Best Results

1. **Be specific about your niche.** "Fitness" is too broad. "Hyrox race nutrition for beginner athletes" is perfect.
2. **The expert profile matters most.** Phase 3 defines the writing voice — take time to review the voice sample.
3. **Phase 6 is your safety net.** Review test samples carefully before committing to full generation.
4. **Start small.** 30-50 entries for your first build. You can always expand later.
5. **Run `/rewyse-help` anytime.** It reads your project state and gives context-aware answers.

---

## Support

Run `/rewyse-help` inside Claude Code for instant answers about any phase, error, or question.

---

Built with Claude Code.
