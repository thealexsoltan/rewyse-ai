// Bot definitions: read and write Claude Code agent files.
//
// A bot IS a .claude/agents/<id>.md file (or rewyse-ai/agents/<id>.md before
// install). Frontmatter gives name, description, color, model; the body is the
// charter. Nothing here is specific to the chat app, so the same bots work as
// subagents, teammates, and tmux sessions.
//
// Safety: files written from the UI only ever carry name, description, color,
// model and memory. Tool lists, hooks and permission modes are never written
// here, so a bot created in the chat cannot widen its own permissions.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Bot, BotColor, NewBotInput } from "../shared/types.js";

const here = path.dirname(fileURLToPath(import.meta.url));
export const chatDir = path.resolve(here, "..");           // rewyse-ai/chat
export const rewyseDir = path.resolve(chatDir, "..");      // rewyse-ai
export const projectRoot = process.env.REWYSE_PROJECT_ROOT
  ? path.resolve(process.env.REWYSE_PROJECT_ROOT)
  : path.resolve(rewyseDir, "..");                          // the Claude Code project

const installedAgentsDir = path.join(projectRoot, ".claude", "agents");
const bundledAgentsDir = path.join(rewyseDir, "agents");

const COLORS: BotColor[] = ["purple", "blue", "green", "orange", "pink", "red", "cyan", "yellow"];
const MANAGED_KEYS = ["name", "description", "color", "model", "memory"];

export function sharedCharter(): string {
  const p = path.join(bundledAgentsDir, "_shared-charter.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}

function parseFrontmatter(src: string): { fm: Record<string, string>; body: string } {
  const lines = src.split(/\r?\n/);
  if (lines[0] !== "---") return { fm: {}, body: src };
  const fm: Record<string, string> = {};
  let i = 1;
  for (; i < lines.length; i++) {
    if (lines[i] === "---") break;
    const m = /^([A-Za-z_][\w-]*):\s*(.*)$/.exec(lines[i]);
    if (m) fm[m[1]] = m[2].trim();
  }
  return { fm, body: lines.slice(i + 1).join("\n").trim() };
}

function titleCase(id: string): string {
  return id.split("-").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function stripQuotes(s: string): string {
  return s.replace(/^"(.*)"$/, "$1").replace(/^'(.*)'$/, "$1");
}

function readBotFile(file: string): Bot | null {
  const src = fs.readFileSync(file, "utf8");
  const { fm, body } = parseFrontmatter(src);
  if (!fm.name) return null;
  const color = (COLORS.includes(fm.color as BotColor) ? fm.color : "orange") as BotColor;
  return {
    id: fm.name,
    name: titleCase(fm.name),
    role: stripQuotes(fm.description ?? ""),
    charter: body,
    color,
    model: fm.model || "inherit",
    file,
    autopilot: false,
  };
}

/** Directory bots are read from. Installed copies win over the bundled defaults. */
export function agentsDir(): string {
  if (fs.existsSync(installedAgentsDir) && fs.readdirSync(installedAgentsDir).some((f) => f.endsWith(".md"))) {
    return installedAgentsDir;
  }
  return bundledAgentsDir;
}

export function loadBots(): Bot[] {
  const dir = agentsDir();
  if (!fs.existsSync(dir)) return [];
  const bots: Bot[] = [];
  for (const f of fs.readdirSync(dir).sort()) {
    if (!f.endsWith(".md") || f.startsWith("_")) continue;
    const bot = readBotFile(path.join(dir, f));
    if (bot) bots.push(bot);
  }
  // Chief of staff first, the rest alphabetical.
  bots.sort((a, b) => (a.id === "chief-of-staff" ? -1 : b.id === "chief-of-staff" ? 1 : a.id.localeCompare(b.id)));
  return bots;
}

function serialize(
  b: { id: string; role: string; color: BotColor; model: string; charter: string },
  preserved: Record<string, string> = {},
): string {
  const fm: string[] = [
    "---",
    `name: ${b.id}`,
    `description: ${b.role.replace(/\n/g, " ")}`,
    `color: ${b.color}`,
    `model: ${b.model || "inherit"}`,
    `memory: ${preserved.memory ?? "project"}`,
  ];
  for (const [k, v] of Object.entries(preserved)) {
    if (!MANAGED_KEYS.includes(k)) fm.push(`${k}: ${v}`);
  }
  fm.push("---", "");
  return fm.join("\n") + b.charter.trim() + "\n";
}

export function createBot(input: NewBotInput): Bot {
  const id = input.id.toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!id) throw new Error("Bot id must contain letters or digits.");
  const dir = fs.existsSync(installedAgentsDir) ? installedAgentsDir : agentsDir();
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${id}.md`);
  if (fs.existsSync(file)) throw new Error(`A bot named ${id} already exists.`);
  const color = COLORS.includes(input.color) ? input.color : "orange";
  const charter =
    input.charter.trim() ||
    `You are **${input.name}** on the Rewyse AI product team. Read\n\`rewyse-ai/agents/_shared-charter.md\` first; it applies to you.\n\n## You own\n\n${input.role}\n`;
  fs.writeFileSync(file, serialize({ id, role: input.role, color, model: input.model, charter }));
  const bot = readBotFile(file);
  if (!bot) throw new Error("Could not read the bot back after writing it.");
  return bot;
}

export function updateBot(bot: Bot, patch: Partial<Pick<Bot, "role" | "charter" | "color" | "model">>): Bot {
  const src = fs.readFileSync(bot.file, "utf8");
  const { fm } = parseFrontmatter(src);
  const next = { ...bot, ...patch };
  // Keys we don't manage (tools, skills, ...) are kept exactly as they were.
  fs.writeFileSync(bot.file, serialize(next, fm));
  const reread = readBotFile(bot.file);
  if (!reread) throw new Error("Could not read the bot back after writing it.");
  return { ...reread, autopilot: bot.autopilot };
}

export function readMemory(botId: string): string {
  const p = path.join(projectRoot, ".claude", "agent-memory", botId, "MEMORY.md");
  return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "";
}
