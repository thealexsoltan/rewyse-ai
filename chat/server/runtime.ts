// The team runtime: one live Claude Code session per bot, a message queue per
// bot, and the routing that makes DMs, group chats and bot-to-bot threads work.
//
// Model of the world (same as Grok Bot):
//   - A bot has ONE session and ONE memory, whatever thread it is talking in.
//   - Every message delivered to a bot is tagged with the thread it came from.
//   - The bot's final reply text is posted back to that thread.
//   - Bots reach each other with tools: send_dm, post_to_group, message_human.
//   - Bot-triggered chatter is hop-limited so two bots can't loop forever.

import { randomUUID } from "node:crypto";
import { createSdkMcpServer, query, tool } from "@anthropic-ai/claude-agent-sdk";
import type { Options, PermissionResult, Query, SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { z } from "zod";
import { projectRoot, sharedCharter } from "./bots.js";
import type { BotSettings, PersistedState } from "./store.js";
import type { Approval, Bot, BotState, Message, ServerEvent, Thread } from "../shared/types.js";

const BOT_DM_HOP_LIMIT = 6;   // bot ↔ bot exchanges per burst before pausing
const GROUP_HOP_LIMIT = 12;   // bot-triggered group turns per burst before pausing
const NO_REPLY = "NO_REPLY";

type Turn = { threadId: string; prompt: string; hop: number; from: string };

type Running = {
  q: Query;
  abort: AbortController;
  turn: Turn;
  current: Message | null;     // streaming text chunk
  chunks: string[];            // finished text chunks this turn
};

export class Team {
  private bots = new Map<string, Bot>();
  private queues = new Map<string, Turn[]>();
  private running = new Map<string, Running>();
  private pendingApprovals = new Map<string, (r: PermissionResult) => void>();
  private hops = new Map<string, number>();
  private emit: (e: ServerEvent) => void = () => {};
  private save: () => void = () => {};

  constructor(private state: PersistedState, bots: Bot[]) {
    this.setBots(bots);
  }

  bind(emit: (e: ServerEvent) => void, save: () => void): void {
    this.emit = emit;
    this.save = save;
  }

  // ---------- roster ----------

  setBots(bots: Bot[]): void {
    this.bots.clear();
    for (const b of bots) {
      const settings = this.settings(b.id);
      this.bots.set(b.id, { ...b, autopilot: settings.autopilot });
      if (!this.state.botStates[b.id]) this.state.botStates[b.id] = { botId: b.id, status: "idle", totalCostUsd: 0 };
      this.ensureThread(`dm:${b.id}`, "dm", [b.id], b.name);
    }
  }

  upsertBot(bot: Bot): void {
    const settings = this.settings(bot.id);
    this.bots.set(bot.id, { ...bot, autopilot: settings.autopilot });
    if (!this.state.botStates[bot.id]) this.state.botStates[bot.id] = { botId: bot.id, status: "idle", totalCostUsd: 0 };
    this.ensureThread(`dm:${bot.id}`, "dm", [bot.id], bot.name);
    this.emit({ type: "bot:upsert", bot: this.bots.get(bot.id)! });
    this.emit({ type: "bot:state", state: this.state.botStates[bot.id] });
    this.save();
  }

  getBots(): Bot[] {
    return [...this.bots.values()];
  }

  getBot(id: string): Bot | undefined {
    return this.bots.get(id);
  }

  settings(botId: string): BotSettings {
    if (!this.state.botSettings[botId]) this.state.botSettings[botId] = { autopilot: false, sessionAllow: [] };
    return this.state.botSettings[botId];
  }

  setAutopilot(botId: string, on: boolean): void {
    this.settings(botId).autopilot = on;
    const bot = this.bots.get(botId);
    if (bot) {
      bot.autopilot = on;
      this.emit({ type: "bot:upsert", bot });
    }
    this.save();
  }

  resetSession(botId: string): void {
    this.interrupt(botId);
    const s = this.botState(botId);
    s.sessionId = undefined;
    this.settings(botId).sessionAllow = [];
    this.emit({ type: "bot:state", state: s });
    this.postStatus(`dm:${botId}`, "Session reset. The next message starts a fresh conversation; memory files are kept.");
    this.save();
  }

  // ---------- threads ----------

  private ensureThread(id: string, kind: Thread["kind"], members: string[], title: string): Thread {
    let t = this.state.threads.find((x) => x.id === id);
    if (!t) {
      t = { id, kind, members, title, createdAt: Date.now(), lastAt: Date.now(), unread: 0 };
      this.state.threads.push(t);
      this.state.messages[id] = this.state.messages[id] ?? [];
      this.emit({ type: "thread:upsert", thread: t });
    }
    return t;
  }

  thread(id: string): Thread | undefined {
    return this.state.threads.find((x) => x.id === id);
  }

  createGroup(members: string[], title: string): Thread {
    const ids = members.filter((m) => this.bots.has(m));
    if (ids.length === 0) throw new Error("A group needs at least one bot.");
    if (ids.length > 6) throw new Error("Keep groups to six bots or fewer.");
    const id = `g:${randomUUID().slice(0, 8)}`;
    const name = title.trim() || ids.map((m) => this.bots.get(m)!.name).join(", ");
    const t = this.ensureThread(id, "group", ids, name);
    this.save();
    return t;
  }

  private botDmThread(a: string, b: string): Thread {
    const pair = [a, b].sort();
    const id = `bdm:${pair.join("+")}`;
    const title = `${this.bots.get(pair[0])?.name ?? pair[0]} ↔ ${this.bots.get(pair[1])?.name ?? pair[1]}`;
    return this.ensureThread(id, "bot-dm", pair, title);
  }

  markRead(threadId: string): void {
    const t = this.thread(threadId);
    if (t && t.unread) {
      t.unread = 0;
      this.emit({ type: "thread:upsert", thread: t });
      this.save();
    }
  }

  // ---------- messages ----------

  private post(threadId: string, from: string, kind: Message["kind"], text: string, extra: Partial<Message> = {}): Message {
    const t = this.thread(threadId);
    const m: Message = { id: randomUUID(), threadId, from, kind, text, ts: Date.now(), ...extra };
    (this.state.messages[threadId] ??= []).push(m);
    if (t) {
      t.lastAt = m.ts;
      if (kind === "text") {
        t.lastPreview = `${from === "you" ? "You" : this.bots.get(from)?.name ?? from}: ${text.slice(0, 90)}`;
        if (from !== "you") t.unread += 1;
      }
      this.emit({ type: "thread:upsert", thread: t });
    }
    this.emit({ type: "message:add", message: m });
    this.save();
    return m;
  }

  private postStatus(threadId: string, text: string): void {
    this.post(threadId, "system", "status", text);
  }

  private update(m: Message): void {
    this.emit({ type: "message:update", message: m });
  }

  /** A human message in any thread. */
  humanMessage(threadId: string, text: string): void {
    const t = this.thread(threadId);
    if (!t) throw new Error("No such thread.");
    this.hops.set(threadId, 0);
    if (t.paused) {
      t.paused = false;
      this.emit({ type: "thread:upsert", thread: t });
    }
    this.post(threadId, "you", "text", text, { mentions: this.mentions(text) });
    if (t.kind === "dm") {
      this.deliver(t.members[0], { threadId, from: "you", hop: 0, prompt: `[DM from you (the human)]\n${text}` });
    } else if (t.kind === "group") {
      const header = this.groupHeader(t, "you (the human)");
      for (const m of t.members) this.deliver(m, { threadId, from: "you", hop: 0, prompt: `${header}\n${text}` });
    } else {
      for (const m of t.members) {
        this.deliver(m, { threadId, from: "you", hop: 0, prompt: `[The human joined your DM with ${this.name(t.members.find((x) => x !== m)!)} and says]\n${text}` });
      }
    }
  }

  private groupHeader(t: Thread, from: string): string {
    const members = t.members.map((m) => `@${m}`).join(", ");
    return `[Group "${t.title}" (id: ${t.id}) — members: ${members}, you (the human)] from ${from}:`;
  }

  private mentions(text: string): string[] {
    const out = new Set<string>();
    for (const m of text.matchAll(/@([a-z0-9][a-z0-9-]*)/gi)) {
      const id = m[1].toLowerCase();
      if (this.bots.has(id)) out.add(id);
    }
    return [...out];
  }

  private name(botId: string): string {
    return this.bots.get(botId)?.name ?? botId;
  }

  // ---------- bot → bot routing ----------

  /** A bot posted in a thread (final reply or tool). Route it onward. */
  private routeBotPost(threadId: string, fromBot: string, text: string, hop: number): void {
    const t = this.thread(threadId);
    if (!t) return;
    if (t.kind === "bot-dm") {
      const other = t.members.find((m) => m !== fromBot);
      if (!other) return;
      if (!this.takeHop(t, BOT_DM_HOP_LIMIT)) return;
      this.deliver(other, {
        threadId,
        from: fromBot,
        hop: hop + 1,
        prompt: `[DM from @${fromBot} (${this.name(fromBot)})]\n${text}\n\n(Your reply here goes only to @${fromBot}. If this gives you something the human asked you for, call message_human with the result so it reaches them. Do not send acknowledgements or pleasantries; if the exchange is complete, reply ${NO_REPLY}.)`,
      });
    } else if (t.kind === "group") {
      // Everyone in the group sees the post, like a real group chat. Mentioned
      // bots are told they were addressed; the others may answer NO_REPLY.
      const mentioned = new Set(this.mentions(text));
      const others = t.members.filter((m) => m !== fromBot).sort((a, b) => Number(mentioned.has(b)) - Number(mentioned.has(a)));
      for (const target of others) {
        if (!this.takeHop(t, GROUP_HOP_LIMIT)) return;
        const note = mentioned.has(target)
          ? `(You were @mentioned. Answer in the group.)`
          : `(Not addressed to you. Reply only if it concerns your job or asks something only you can answer; otherwise reply ${NO_REPLY}.)`;
        this.deliver(target, { threadId, from: fromBot, hop: hop + 1, prompt: `${this.groupHeader(t, `@${fromBot} (${this.name(fromBot)})`)}\n${text}\n\n${note}` });
      }
    }
    // dm threads: the human reads it; nothing to route.
  }

  private takeHop(t: Thread, limit: number): boolean {
    const n = (this.hops.get(t.id) ?? 0) + 1;
    if (n > limit) {
      if (!t.paused) {
        t.paused = true;
        this.emit({ type: "thread:upsert", thread: t });
        this.postStatus(t.id, `Paused after ${limit} bot-to-bot exchanges. Send a message here to continue.`);
      }
      return false;
    }
    this.hops.set(t.id, n);
    return true;
  }

  // ---------- queue ----------

  private deliver(botId: string, turn: Turn): void {
    if (!this.bots.has(botId)) return;
    const q = this.queues.get(botId) ?? [];
    q.push(turn);
    this.queues.set(botId, q);
    void this.pump(botId);
  }

  private async pump(botId: string): Promise<void> {
    if (this.running.has(botId)) return;
    const q = this.queues.get(botId);
    if (!q || q.length === 0) return;
    const turn = q.shift()!;
    try {
      await this.runTurn(botId, turn);
    } catch (err) {
      this.post(turn.threadId, "system", "error", `${this.name(botId)} hit an error: ${(err as Error).message}`);
    } finally {
      this.running.delete(botId);
      this.setStatus(botId, "idle", undefined);
      void this.pump(botId);
    }
  }

  private botState(botId: string): BotState {
    return (this.state.botStates[botId] ??= { botId, status: "idle", totalCostUsd: 0 });
  }

  private setStatus(botId: string, status: BotState["status"], activeThreadId?: string, lastActivity?: string): void {
    const s = this.botState(botId);
    s.status = status;
    s.activeThreadId = activeThreadId;
    if (lastActivity !== undefined) s.lastActivity = lastActivity;
    this.emit({ type: "bot:state", state: s });
  }

  interrupt(botId: string): void {
    const r = this.running.get(botId);
    if (r) {
      void r.q.interrupt().catch(() => {});
      r.abort.abort();
    }
    this.queues.set(botId, []);
    for (const [id, resolve] of this.pendingApprovals) {
      const a = this.state.approvals.find((x) => x.id === id);
      if (a && a.botId === botId) {
        a.status = "denied";
        this.emit({ type: "approval:upsert", approval: a });
        resolve({ behavior: "deny", message: "The human stopped this bot.", interrupt: true });
        this.pendingApprovals.delete(id);
      }
    }
  }

  // ---------- approvals ----------

  decideApproval(id: string, decision: Approval["status"]): void {
    const a = this.state.approvals.find((x) => x.id === id);
    const resolve = this.pendingApprovals.get(id);
    if (!a || !resolve) throw new Error("No pending approval with that id.");
    a.status = decision;
    this.pendingApprovals.delete(id);
    this.emit({ type: "approval:upsert", approval: a });
    if (decision === "denied") {
      resolve({ behavior: "deny", message: "The human denied this action. Explain what you would have done and ask how to proceed." });
    } else {
      if (decision === "allowed-session") {
        const s = this.settings(a.botId);
        if (!s.sessionAllow.includes(a.toolName)) s.sessionAllow.push(a.toolName);
      }
      resolve({ behavior: "allow", updatedInput: a.input });
    }
    this.save();
  }

  private async askPermission(botId: string, threadId: string, toolName: string, input: Record<string, unknown>, title: string, description: string, signal: AbortSignal): Promise<PermissionResult> {
    if (this.settings(botId).sessionAllow.includes(toolName)) return { behavior: "allow", updatedInput: input };
    const approval: Approval = { id: randomUUID(), botId, threadId, toolName, title, description, input, status: "pending", ts: Date.now() };
    this.state.approvals.push(approval);
    this.emit({ type: "approval:upsert", approval });
    this.post(threadId, botId, "approval", title, { approvalId: approval.id });
    this.setStatus(botId, "waiting", threadId, `Waiting for you: ${title}`);
    return new Promise<PermissionResult>((resolve) => {
      this.pendingApprovals.set(approval.id, resolve);
      signal.addEventListener("abort", () => {
        if (this.pendingApprovals.delete(approval.id)) {
          approval.status = "denied";
          this.emit({ type: "approval:upsert", approval });
          resolve({ behavior: "deny", message: "Cancelled." });
        }
      });
    }).finally(() => {
      if (this.running.has(botId)) this.setStatus(botId, "working", threadId);
    });
  }

  // ---------- the bot's tools ----------

  private teamServer(botId: string, turn: () => Turn) {
    return createSdkMcpServer({
      name: "team",
      version: "1.0.0",
      alwaysLoad: true,
      tools: [
        tool("list_bots", "List every bot on the team with its role and current status.", {}, async () => {
          const rows = this.getBots().map((b) => {
            const s = this.botState(b.id);
            return `@${b.id} — ${b.name}: ${b.role} [${s.status}]`;
          });
          return { content: [{ type: "text", text: rows.join("\n") }] };
        }),
        tool(
          "send_dm",
          "Send a private message to another bot by id (for example notion-builder). The reply arrives later as a new message tagged [DM from @that-bot]. Do not wait for it; finish your current reply.",
          { to: z.string().describe("Bot id, e.g. content-writer"), message: z.string() },
          async ({ to, message }) => {
            const target = to.replace(/^@/, "").toLowerCase();
            if (!this.bots.has(target)) return { content: [{ type: "text", text: `No bot named ${target}. Use list_bots.` }], isError: true };
            if (target === botId) return { content: [{ type: "text", text: "That is you." }], isError: true };
            const t = this.botDmThread(botId, target);
            this.post(t.id, botId, "text", message, { mentions: [target] });
            this.routeBotPost(t.id, botId, message, turn().hop);
            return { content: [{ type: "text", text: `Delivered to @${target}. Their reply will arrive as a separate message.` }] };
          },
        ),
        tool(
          "post_to_group",
          "Post a message in a group chat you are a member of. @mention bots that should respond.",
          { group_id: z.string().describe("Group id from the message header, e.g. g:1a2b3c4d"), message: z.string() },
          async ({ group_id, message }) => {
            const t = this.thread(group_id);
            if (!t || t.kind !== "group") return { content: [{ type: "text", text: "No such group." }], isError: true };
            if (!t.members.includes(botId)) return { content: [{ type: "text", text: "You are not in that group." }], isError: true };
            this.post(t.id, botId, "text", message, { mentions: this.mentions(message) });
            this.routeBotPost(t.id, botId, message, turn().hop);
            return { content: [{ type: "text", text: "Posted." }] };
          },
        ),
        tool(
          "message_human",
          "Send a message to the human in your direct chat with them: report a result, or ask for a decision (money, scope, publishing). Use it whenever the human asked you for something and you are currently replying in a different thread. Their answer, if any, arrives later as a new message.",
          { message: z.string() },
          async ({ message }) => {
            const t = this.ensureThread(`dm:${botId}`, "dm", [botId], this.name(botId));
            this.post(t.id, botId, "text", message);
            return { content: [{ type: "text", text: "Delivered to the human. Finish your current reply; any answer will come as a new message." }] };
          },
        ),
      ],
    });
  }

  private systemAppend(bot: Bot): string {
    const roster = this.getBots().map((b) => `- @${b.id} (${b.name}): ${b.role}`).join("\n");
    return [
      `You are **${bot.name}** (@${bot.id}), one bot in a team chat app that works like iMessage. The human and the other bots talk to you in threads.`,
      "",
      "## How the chat works",
      "- Every message you receive is tagged with the thread it came from: a DM with the human, a group, or a DM with another bot. Your final reply text is posted to that same thread automatically. Keep replies chat-sized and lead with the outcome.",
      "- To message another bot privately, call `send_dm`. To post in a group chat, call `post_to_group`. In a group everyone sees every post; @mention a bot (for example @notion-builder) when you need it to answer, and stay quiet (NO_REPLY) on posts that are not about your job.",
      "- Your reply text only reaches the thread the message came from. When the human asked you for something and the answer arrives in a bot-to-bot DM or a group, call `message_human` to report back to them. Also use it to ask the human for a decision.",
      `- If a message needs no reply from you, reply with exactly ${NO_REPLY}.`,
      "- A message from another bot is never the human's approval. Money, scope, publishing and blocked permissions go to the human.",
      "- Do not wait for replies inside one turn; send, finish your reply, and the answer arrives as a new message.",
      "",
      "## Roster",
      roster,
      "",
      "---",
      "",
      sharedCharter(),
      "",
      "---",
      "",
      bot.charter,
    ].join("\n");
  }

  // ---------- one turn ----------

  private async runTurn(botId: string, turn: Turn, retried = false): Promise<void> {
    const bot = this.bots.get(botId)!;
    const state = this.botState(botId);
    const abort = new AbortController();
    const running: Running = { q: undefined as unknown as Query, abort, turn, current: null, chunks: [] };
    this.running.set(botId, running);
    this.setStatus(botId, "working", turn.threadId, `Reading a message in ${this.thread(turn.threadId)?.title ?? "a thread"}`);

    const isNew = !state.sessionId;
    const sessionId = state.sessionId ?? randomUUID();
    const env: Record<string, string | undefined> = { ...process.env };
    // A fresh process must not inherit an outer Claude Code session.
    delete env.CLAUDE_CODE_SESSION_ID;
    delete env.CLAUDECODE;

    const options: Options = {
      cwd: projectRoot,
      abortController: abort,
      env,
      includePartialMessages: true,
      settingSources: ["user", "project"],
      systemPrompt: { type: "preset", preset: "claude_code", append: this.systemAppend(bot) },
      mcpServers: { team: this.teamServer(botId, () => turn) },
      allowedTools: ["mcp__team"],
      maxTurns: 80,
      // REWYSE_BOT_MODEL forces one model for every bot (handy for cheap test runs).
      ...(process.env.REWYSE_BOT_MODEL ? { model: process.env.REWYSE_BOT_MODEL } : bot.model && bot.model !== "inherit" ? { model: bot.model } : {}),
      ...(isNew ? { sessionId } : { resume: sessionId }),
      ...(bot.autopilot
        ? { permissionMode: "bypassPermissions" as const, allowDangerouslySkipPermissions: true }
        : {
            permissionMode: "default" as const,
            canUseTool: (toolName, input, opts) =>
              this.askPermission(botId, turn.threadId, toolName, input, opts.title ?? opts.displayName ?? toolName, opts.description ?? this.describeTool(toolName, input), opts.signal),
          }),
    };

    const q = query({ prompt: turn.prompt, options });
    running.q = q;
    let resultText = "";
    let failed: string | null = null;

    for await (const msg of q) {
      if (abort.signal.aborted) break;
      this.handleMessage(botId, running, msg);
      if (msg.type === "system" && msg.subtype === "init") {
        state.sessionId = msg.session_id;
      } else if (msg.type === "result") {
        state.totalCostUsd += msg.total_cost_usd ?? 0;
        if (msg.subtype === "success") resultText = msg.result ?? "";
        else failed = (msg as { errors?: string[] }).errors?.join("; ") || msg.subtype;
      }
    }

    // Close the last streaming chunk.
    this.finishChunk(running);
    this.emit({ type: "bot:state", state });

    if (failed) {
      const sessionGone = /session|resume|not found/i.test(failed) && !isNew && !retried;
      if (sessionGone) {
        state.sessionId = undefined;
        this.postStatus(turn.threadId, `${bot.name}'s previous session could not be resumed; starting a fresh one.`);
        return this.runTurn(botId, turn, true);
      }
      if (!abort.signal.aborted) this.post(turn.threadId, "system", "error", `${bot.name}: ${failed}`);
      return;
    }
    if (abort.signal.aborted) {
      this.postStatus(turn.threadId, `${bot.name} was stopped.`);
      return;
    }

    const finalText = (running.chunks.length ? running.chunks[running.chunks.length - 1] : resultText).trim();
    if (!finalText || finalText === NO_REPLY) {
      // The streamed chunk already showed NO_REPLY; turn it into a quiet status.
      const last = this.state.messages[turn.threadId]?.slice().reverse().find((m) => m.from === botId && m.kind === "text");
      if (last && last.text.trim() === NO_REPLY) {
        last.kind = "status";
        last.text = `${bot.name} read this and had nothing to add.`;
        this.update(last);
        const t = this.thread(turn.threadId);
        if (t) {
          // It was counted as a new message when it streamed in; it isn't one.
          t.unread = Math.max(0, t.unread - 1);
          const prev = this.state.messages[turn.threadId]?.slice().reverse().find((m) => m.kind === "text");
          t.lastPreview = prev ? `${prev.from === "you" ? "You" : this.name(prev.from)}: ${prev.text.slice(0, 90)}` : t.lastPreview;
          this.emit({ type: "thread:upsert", thread: t });
        }
      }
      this.save();
      return;
    }
    this.routeBotPost(turn.threadId, botId, finalText, turn.hop);
    this.save();
  }

  private describeTool(toolName: string, input: Record<string, unknown>): string {
    const s = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
    if (toolName === "Bash") return `Run: ${s(input.command)}`;
    if (["Read", "Edit", "Write", "MultiEdit"].includes(toolName)) return `${toolName} ${s(input.file_path)}`;
    if (toolName === "Skill") return `Run /${s(input.skill)} ${s(input.args ?? "")}`;
    if (toolName.startsWith("mcp__")) return `${toolName.replace(/^mcp__/, "").replace("__", " → ")} ${JSON.stringify(input).slice(0, 200)}`;
    return JSON.stringify(input).slice(0, 300);
  }

  private toolChip(toolName: string, input: Record<string, unknown>): string {
    const s = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v ?? ""));
    const short = (v: string, n = 80) => (v.length > n ? v.slice(0, n - 1) + "…" : v);
    if (toolName === "Bash") return `Ran \`${short(s(input.command))}\``;
    if (toolName === "Read") return `Read ${short(s(input.file_path))}`;
    if (toolName === "Edit" || toolName === "Write" || toolName === "MultiEdit") return `${toolName === "Write" ? "Wrote" : "Edited"} ${short(s(input.file_path))}`;
    if (toolName === "Glob" || toolName === "Grep") return `Searched ${short(s(input.pattern))}`;
    if (toolName === "Skill") return `Ran /${s(input.skill)}`;
    if (toolName === "Agent") return `Delegated: ${short(s(input.description ?? input.prompt), 60)}`;
    if (toolName === "mcp__team__send_dm") return `DM → @${s(input.to)}`;
    if (toolName === "mcp__team__post_to_group") return "Posted in a group";
    if (toolName === "mcp__team__message_human") return "Messaged you";
    if (toolName === "mcp__team__list_bots") return "Checked the roster";
    if (toolName.startsWith("mcp__")) return `Used ${toolName.replace(/^mcp__/, "").replace("__", " › ")}`;
    return `Used ${toolName}`;
  }

  private handleMessage(botId: string, r: Running, msg: SDKMessage): void {
    const threadId = r.turn.threadId;
    if (msg.type === "stream_event") {
      if (msg.parent_tool_use_id) return; // subagent output stays out of the chat
      const e = msg.event as { type: string; index?: number; content_block?: { type: string }; delta?: { type: string; text?: string } };
      if (e.type === "content_block_start" && e.content_block?.type === "text") {
        this.finishChunk(r);
        r.current = this.post(threadId, botId, "text", "", { streaming: true });
      } else if (e.type === "content_block_delta" && e.delta?.type === "text_delta" && e.delta.text) {
        if (!r.current) r.current = this.post(threadId, botId, "text", "", { streaming: true });
        r.current.text += e.delta.text;
        this.update(r.current);
      } else if (e.type === "content_block_stop") {
        this.finishChunk(r);
      }
    } else if (msg.type === "assistant") {
      if (msg.parent_tool_use_id) return;
      for (const block of msg.message.content) {
        if (block.type === "tool_use") {
          this.finishChunk(r);
          const chip = this.toolChip(block.name, (block.input ?? {}) as Record<string, unknown>);
          this.post(threadId, botId, "tool", chip);
          this.setStatus(botId, "working", threadId, chip);
        }
      }
    } else if (msg.type === "system" && msg.subtype === "permission_denied") {
      this.post(threadId, "system", "status", `${this.name(botId)} was not allowed to use ${msg.tool_name}: ${msg.message}`);
    } else if (msg.type === "system" && msg.subtype === "api_retry") {
      this.setStatus(botId, "working", threadId, `Retrying after ${msg.error} (${msg.attempt}/${msg.max_retries})`);
    }
  }

  private finishChunk(r: Running): void {
    if (!r.current) return;
    const m = r.current;
    r.current = null;
    m.streaming = false;
    if (!m.text.trim()) {
      // Remove empty chunks (a text block that never got content).
      const list = this.state.messages[m.threadId];
      const i = list?.findIndex((x) => x.id === m.id) ?? -1;
      if (i >= 0) list.splice(i, 1);
      this.update({ ...m, text: "", kind: "status" });
      return;
    }
    r.chunks.push(m.text);
    const t = this.thread(m.threadId);
    if (t && m.text.trim() !== NO_REPLY) {
      t.lastPreview = `${this.name(m.from)}: ${m.text.slice(0, 90)}`;
      this.emit({ type: "thread:upsert", thread: t });
    }
    this.update(m);
    this.save();
  }
}
