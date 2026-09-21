// HTTP + WebSocket server for the bot team chat.
//
//   npm start          build the UI and serve everything on http://localhost:3333
//   npm run dev        server with reload + Vite dev server on :5173
//
// Everything runs on your machine: the bots are Claude Code sessions started
// through the Agent SDK, using your existing `claude` login.

import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import express from "express";
import { WebSocketServer, WebSocket } from "ws";
import { chatDir, createBot, loadBots, projectRoot, readMemory, updateBot } from "./bots.js";
import { flushState, loadState, saveState } from "./store.js";
import { Team } from "./runtime.js";
import type { Approval, NewBotInput, ServerEvent, Snapshot } from "../shared/types.js";

const PORT = Number(process.env.PORT ?? 3333);
const state = loadState();
const team = new Team(state, loadBots());

const app = express();
app.use(express.json({ limit: "2mb" }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });

function broadcast(e: ServerEvent): void {
  const data = JSON.stringify(e);
  for (const c of wss.clients) if (c.readyState === WebSocket.OPEN) c.send(data);
}
team.bind(broadcast, () => saveState(state));

function snapshot(): Snapshot {
  return {
    bots: team.getBots(),
    botStates: state.botStates,
    threads: state.threads,
    messages: state.messages,
    approvals: state.approvals.filter((a) => a.status === "pending" || Date.now() - a.ts < 86_400_000),
    projectRoot,
  };
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "snapshot", snapshot: snapshot() } satisfies ServerEvent));
});

// ---------- API ----------

app.get("/api/snapshot", (_req, res) => res.json(snapshot()));

app.post("/api/threads", (req, res) => {
  try {
    const { members, title } = req.body as { members: string[]; title?: string };
    if (!Array.isArray(members) || members.length === 0) throw new Error("Pick at least one bot.");
    if (members.length === 1) {
      const t = team.thread(`dm:${members[0]}`);
      if (!t) throw new Error("No such bot.");
      return res.json(t);
    }
    res.json(team.createGroup(members, title ?? ""));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/threads/:id/messages", (req, res) => {
  try {
    const text = String((req.body as { text?: string }).text ?? "").trim();
    if (!text) throw new Error("Empty message.");
    team.humanMessage(req.params.id as string, text);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/threads/:id/read", (req, res) => {
  team.markRead(req.params.id as string);
  res.json({ ok: true });
});

app.post("/api/approvals/:id", (req, res) => {
  try {
    const decision = (req.body as { decision: Approval["status"] }).decision;
    if (!["allowed", "allowed-session", "denied"].includes(decision)) throw new Error("Bad decision.");
    team.decideApproval(req.params.id as string, decision);
    res.json({ ok: true });
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/bots", (req, res) => {
  try {
    const bot = createBot(req.body as NewBotInput);
    team.upsertBot(bot);
    res.json(bot);
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.patch("/api/bots/:id", (req, res) => {
  try {
    const bot = team.getBot(req.params.id as string);
    if (!bot) throw new Error("No such bot.");
    const body = req.body as Partial<{ role: string; charter: string; color: NewBotInput["color"]; model: string; autopilot: boolean }>;
    if (typeof body.autopilot === "boolean") team.setAutopilot(bot.id, body.autopilot);
    const patch: Record<string, string> = {};
    for (const k of ["role", "charter", "color", "model"] as const) if (typeof body[k] === "string") patch[k] = body[k] as string;
    if (Object.keys(patch).length) team.upsertBot(updateBot(bot, patch));
    res.json(team.getBot(bot.id));
  } catch (err) {
    res.status(400).json({ error: (err as Error).message });
  }
});

app.post("/api/bots/:id/interrupt", (req, res) => {
  team.interrupt(req.params.id as string);
  res.json({ ok: true });
});

app.post("/api/bots/:id/reset", (req, res) => {
  team.resetSession(req.params.id as string);
  res.json({ ok: true });
});

app.get("/api/bots/:id/memory", (req, res) => {
  res.json({ memory: readMemory(req.params.id as string) });
});

// ---------- static UI ----------

const dist = path.join(chatDir, "dist");
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.get(/^\/(?!api|ws).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
} else {
  app.get("/", (_req, res) =>
    res.type("text").send("UI not built yet. Run `npm start` (builds it) or `npm run dev` and open http://localhost:5173\n"),
  );
}

server.listen(PORT, () => {
  console.log("");
  console.log(`  Claude Bots is running:  http://localhost:${PORT}`);
  console.log(`  Project root:            ${projectRoot}`);
  console.log(`  Bots loaded:             ${team.getBots().map((b) => b.id).join(", ") || "(none)"}`);
  console.log("");
});

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    for (const b of team.getBots()) team.interrupt(b.id);
    flushState(state);
    process.exit(0);
  });
}
