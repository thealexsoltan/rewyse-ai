// Persistence: one JSON file, written on a short debounce.
// Threads and messages survive restarts; bot sessions resume by id.

import fs from "node:fs";
import path from "node:path";
import { chatDir } from "./bots.js";
import type { Approval, BotState, Message, Thread } from "../shared/types.js";

export type BotSettings = { autopilot: boolean; sessionAllow: string[] };

export type PersistedState = {
  threads: Thread[];
  messages: Record<string, Message[]>;
  botStates: Record<string, BotState>;
  approvals: Approval[];
  botSettings: Record<string, BotSettings>;
};

const dataDir = path.join(chatDir, "data");
const file = path.join(dataDir, "state.json");
const MAX_MESSAGES_PER_THREAD = 2000;

export function loadState(): PersistedState {
  const empty: PersistedState = { threads: [], messages: {}, botStates: {}, approvals: [], botSettings: {} };
  if (!fs.existsSync(file)) return empty;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8")) as Partial<PersistedState>;
    const state = { ...empty, ...parsed };
    // Nothing is mid-flight after a restart.
    for (const s of Object.values(state.botStates)) {
      s.status = "idle";
      s.activeThreadId = undefined;
    }
    for (const list of Object.values(state.messages)) for (const m of list) m.streaming = false;
    state.approvals = state.approvals.filter((a) => a.status !== "pending");
    return state;
  } catch (err) {
    console.error("[store] could not read state.json, starting fresh:", err);
    return empty;
  }
}

let timer: NodeJS.Timeout | null = null;
export function saveState(state: PersistedState): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    for (const [id, list] of Object.entries(state.messages)) {
      if (list.length > MAX_MESSAGES_PER_THREAD) state.messages[id] = list.slice(-MAX_MESSAGES_PER_THREAD);
    }
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = file + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2));
    fs.renameSync(tmp, file);
  }, 250);
}

export function flushState(state: PersistedState): void {
  if (timer) clearTimeout(timer);
  timer = null;
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(state, null, 2));
}
