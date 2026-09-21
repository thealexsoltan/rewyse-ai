// Client state: one snapshot from the server, then live events over WebSocket.

import { useEffect, useReducer, useRef } from "react";
import type { Approval, Bot, BotState, Message, ServerEvent, Snapshot, Thread } from "../shared/types";

export type State = {
  connected: boolean;
  bots: Bot[];
  botStates: Record<string, BotState>;
  threads: Thread[];
  messages: Record<string, Message[]>;
  approvals: Record<string, Approval>;
  projectRoot: string;
  toast: { level: "info" | "error"; text: string; id: number } | null;
};

const initial: State = { connected: false, bots: [], botStates: {}, threads: [], messages: {}, approvals: {}, projectRoot: "", toast: null };

type Action = ServerEvent | { type: "connected"; value: boolean } | { type: "toast:clear" };

function reduce(s: State, a: Action): State {
  switch (a.type) {
    case "connected":
      return { ...s, connected: a.value };
    case "snapshot": {
      const snap: Snapshot = a.snapshot;
      const approvals: Record<string, Approval> = {};
      for (const ap of snap.approvals) approvals[ap.id] = ap;
      return { ...s, bots: snap.bots, botStates: snap.botStates, threads: snap.threads, messages: snap.messages, approvals, projectRoot: snap.projectRoot };
    }
    case "message:add": {
      const list = s.messages[a.message.threadId] ?? [];
      if (list.some((m) => m.id === a.message.id)) return s;
      return { ...s, messages: { ...s.messages, [a.message.threadId]: [...list, a.message] } };
    }
    case "message:update": {
      const list = s.messages[a.message.threadId] ?? [];
      const i = list.findIndex((m) => m.id === a.message.id);
      if (i < 0) {
        if (a.message.kind === "status" && !a.message.text) return s; // removed empty chunk
        return { ...s, messages: { ...s.messages, [a.message.threadId]: [...list, a.message] } };
      }
      if (a.message.kind === "status" && !a.message.text) {
        return { ...s, messages: { ...s.messages, [a.message.threadId]: list.filter((m) => m.id !== a.message.id) } };
      }
      const next = list.slice();
      next[i] = a.message;
      return { ...s, messages: { ...s.messages, [a.message.threadId]: next } };
    }
    case "thread:upsert": {
      const i = s.threads.findIndex((t) => t.id === a.thread.id);
      const threads = s.threads.slice();
      if (i < 0) threads.push(a.thread);
      else threads[i] = a.thread;
      return { ...s, threads, messages: s.messages[a.thread.id] ? s.messages : { ...s.messages, [a.thread.id]: [] } };
    }
    case "bot:upsert": {
      const i = s.bots.findIndex((b) => b.id === a.bot.id);
      const bots = s.bots.slice();
      if (i < 0) bots.push(a.bot);
      else bots[i] = a.bot;
      return { ...s, bots };
    }
    case "bot:state":
      return { ...s, botStates: { ...s.botStates, [a.state.botId]: a.state } };
    case "approval:upsert":
      return { ...s, approvals: { ...s.approvals, [a.approval.id]: a.approval } };
    case "toast":
      return { ...s, toast: { level: a.level, text: a.text, id: Date.now() } };
    case "toast:clear":
      return { ...s, toast: null };
    default:
      return s;
  }
}

export function useServer(): [State, (a: Action) => void] {
  const [state, dispatch] = useReducer(reduce, initial);
  const retry = useRef(1000);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let closed = false;
    const connect = () => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      ws = new WebSocket(`${proto}://${location.host}/ws`);
      ws.onopen = () => {
        retry.current = 1000;
        dispatch({ type: "connected", value: true });
      };
      ws.onmessage = (ev) => dispatch(JSON.parse(ev.data) as ServerEvent);
      ws.onclose = () => {
        dispatch({ type: "connected", value: false });
        if (!closed) setTimeout(connect, (retry.current = Math.min(retry.current * 1.5, 8000)));
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
    };
  }, []);

  useEffect(() => {
    if (!state.toast) return;
    const t = setTimeout(() => dispatch({ type: "toast:clear" }), 3500);
    return () => clearTimeout(t);
  }, [state.toast]);

  return [state, dispatch];
}

export async function api<T = unknown>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `${res.status} ${res.statusText}`);
  return data;
}
