import { useEffect, useMemo, useRef, useState } from "react";
import type { Approval, Bot, BotState, Message, Thread } from "../shared/types";
import { Markdown } from "./md";
import { api } from "./store";

// ---------- helpers ----------

export function colorVar(c: string): string {
  return `var(--c-${c})`;
}

export function initials(name: string): string {
  return name.split(/[\s-]+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join("");
}

export function fmtTime(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

function dayLabel(ts: number): string {
  const d = new Date(ts);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return "Today";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric" });
}

/**
 * The crab mascot. One per bot, tinted with the bot's color.
 * Claws wave while the bot is working; the right claw stays raised while
 * it is waiting on you; it blinks now and then when idle.
 */
export function Crab({ color, status, className }: { color: string; status?: BotState["status"]; className?: string }) {
  return (
    <svg className={`crab ${status ?? "idle"} ${className ?? ""}`} viewBox="0 0 64 64" aria-hidden="true">
      {/* legs */}
      <g className="legs" stroke={color} strokeWidth="3" strokeLinecap="round" fill="none">
        <path d="M18 44 L9 50" /><path d="M20 49 L13 57" /><path d="M46 44 L55 50" /><path d="M44 49 L51 57" />
      </g>
      {/* claws */}
      <g className="claw left" fill={color}>
        <path d="M17 33 C9 33 5 27 8 22 C10 18 15 18 17 22 L14 25 L18 27 Z" />
        <circle cx="17" cy="33" r="4" />
      </g>
      <g className="claw right" fill={color}>
        <path d="M47 33 C55 33 59 27 56 22 C54 18 49 18 47 22 L50 25 L46 27 Z" />
        <circle cx="47" cy="33" r="4" />
      </g>
      {/* eye stalks */}
      <g stroke={color} strokeWidth="3" strokeLinecap="round">
        <path d="M26 30 L25 20" /><path d="M38 30 L39 20" />
      </g>
      {/* body */}
      <ellipse cx="32" cy="38" rx="17" ry="12" fill={color} />
      <ellipse cx="32" cy="36" rx="14" ry="8" fill="rgba(250,249,245,0.16)" />
      {/* eyes */}
      <g className="eyes">
        <circle cx="25" cy="19" r="4.2" fill="#faf9f5" /><circle cx="39" cy="19" r="4.2" fill="#faf9f5" />
        <circle className="pupil" cx="26" cy="19.5" r="2" fill="#141413" /><circle className="pupil" cx="40" cy="19.5" r="2" fill="#141413" />
      </g>
      {/* smile */}
      <path d="M27 41 Q32 45 37 41" stroke="#141413" strokeWidth="1.8" strokeLinecap="round" fill="none" opacity="0.65" />
    </svg>
  );
}

export function Avatar({ bot, size, status, you, group }: { bot?: Bot; size?: "sm" | "lg"; status?: BotState["status"]; you?: boolean; group?: boolean }) {
  const cls = `avatar ${size ?? ""} ${you ? "you" : ""} ${group ? "group" : ""}`;
  if (you) return <span className={cls}>You</span>;
  if (group || !bot) {
    return (
      <span className={cls} title="Group">
        <Crab color="var(--ink-3)" className="pair a" />
        <Crab color="var(--accent)" className="pair b" />
      </span>
    );
  }
  return (
    <span className={cls} style={{ background: `color-mix(in srgb, ${colorVar(bot.color)} 18%, var(--bg-2))` }} title={`${bot.name} · ${status ?? "idle"}`}>
      <Crab color={colorVar(bot.color)} status={status} />
      {status ? <span className={`dot ${status}`} /> : null}
    </span>
  );
}

// ---------- sidebar ----------

export function Sidebar(props: {
  bots: Bot[];
  botStates: Record<string, BotState>;
  threads: Thread[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onNewChat: () => void;
  onNewBot: () => void;
  connected: boolean;
}) {
  const { bots, botStates, threads, activeId, onSelect, onNewChat, onNewBot, connected } = props;
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const match = (t: Thread) => !q || t.title.toLowerCase().includes(q.toLowerCase()) || (t.lastPreview ?? "").toLowerCase().includes(q.toLowerCase());
  const sorted = (kind: Thread["kind"]) => threads.filter((t) => t.kind === kind && match(t)).sort((a, b) => b.lastAt - a.lastAt);
  const dms = threads.filter((t) => t.kind === "dm" && match(t)).sort((a, b) => bots.findIndex((x) => x.id === a.members[0]) - bots.findIndex((x) => x.id === b.members[0]));
  const groups = sorted("group");
  const botDms = sorted("bot-dm");

  const Row = ({ t }: { t: Thread }) => {
    const bot = t.kind === "dm" ? byId.get(t.members[0]) : undefined;
    const st = bot ? botStates[bot.id] : undefined;
    const sub = t.lastPreview ?? (bot ? bot.role : t.members.map((m) => byId.get(m)?.name ?? m).join(", "));
    return (
      <button className={`row ${activeId === t.id ? "active" : ""}`} onClick={() => onSelect(t.id)}>
        {bot ? <Avatar bot={bot} status={st?.status ?? "idle"} /> : t.kind === "group" ? <Avatar group /> : (
          <span className="stack">
            {t.members.map((m) => byId.get(m)).filter(Boolean).map((b) => <Avatar key={b!.id} bot={b!} size="sm" />)}
          </span>
        )}
        <span style={{ minWidth: 0 }}>
          <span className="name">{t.title}</span>
          <span className="preview">{st?.status === "working" ? st.lastActivity ?? "Working…" : st?.status === "waiting" ? "Waiting for you" : sub}</span>
        </span>
        <span className="meta">
          <span className="muted">{t.lastPreview ? fmtTime(t.lastAt) : ""}</span>
          {t.unread ? <span className="badge">{t.unread}</span> : null}
        </span>
      </button>
    );
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-top">
        <div className="brand">
          <span className="mark">✱</span>
          <div style={{ minWidth: 0 }}>
            <h1>Claude Bots</h1>
            <small>{connected ? "Rewyse team · live" : "Reconnecting…"}</small>
          </div>
        </div>
        <button className="icon-btn" title="New bot" onClick={onNewBot} aria-label="New bot">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="8" r="4" /><path d="M4 21c0-4 4-6 8-6s8 2 8 6" /><path d="M19 3v4M17 5h4" /></svg>
        </button>
        <button className="icon-btn" title="New chat" onClick={onNewChat} aria-label="New chat">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" /></svg>
        </button>
      </div>
      <input className="search" placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="roster">
        <div className="section-title">Bots</div>
        {dms.length ? dms.map((t) => <Row key={t.id} t={t} />) : <div className="empty-roster">No bots yet. Add one with the person icon above.</div>}
        {groups.length ? <div className="section-title">Groups</div> : null}
        {groups.map((t) => <Row key={t.id} t={t} />)}
        {botDms.length ? <div className="section-title">Bot to bot</div> : null}
        {botDms.map((t) => <Row key={t.id} t={t} />)}
      </div>
    </aside>
  );
}

// ---------- approval card ----------

export function ApprovalCard({ a, bot }: { a: Approval; bot?: Bot }) {
  const [busy, setBusy] = useState(false);
  const decide = async (decision: Approval["status"]) => {
    setBusy(true);
    try {
      await api("POST", `/api/approvals/${a.id}`, { decision });
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="approval">
      <div className="head">{bot?.name ?? a.botId} wants to: {a.title}</div>
      <div className="desc">{a.description}</div>
      {a.status === "pending" ? (
        <div className="actions">
          <button className="btn primary" disabled={busy} onClick={() => decide("allowed")}>Approve</button>
          <button className="btn" disabled={busy} onClick={() => decide("allowed-session")}>Allow for session</button>
          <button className="btn deny" disabled={busy} onClick={() => decide("denied")}>Deny</button>
        </div>
      ) : (
        <div className="resolved">{a.status === "denied" ? "Denied" : a.status === "allowed-session" ? "Allowed for this session" : "Approved"}</div>
      )}
    </div>
  );
}

// ---------- messages ----------

export function MessageList(props: { thread: Thread; messages: Message[]; bots: Bot[]; botStates: Record<string, BotState>; approvals: Record<string, Approval> }) {
  const { thread, messages, bots, botStates, approvals } = props;
  const byId = useMemo(() => new Map(bots.map((b) => [b.id, b])), [bots]);
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onScroll = () => {
      stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    };
    el.addEventListener("scroll", onScroll);
    return () => el.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [messages, thread.id]);

  useEffect(() => {
    stick.current = true;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread.id]);

  const typing = thread.members.filter((m) => botStates[m]?.status === "working" && botStates[m]?.activeThreadId === thread.id);
  const lastStreaming = messages.length && messages[messages.length - 1].streaming;
  const showNames = thread.kind !== "dm";

  let lastDay = "";
  return (
    <div className="messages" ref={ref}>
      {messages.map((m, i) => {
        const day = dayLabel(m.ts);
        const sep = day !== lastDay ? <div className="day" key={`d${i}`}>{day}</div> : null;
        lastDay = day;
        const bot = byId.get(m.from);
        let node: React.ReactNode = null;
        if (m.kind === "text") {
          const me = m.from === "you";
          node = (
            <div className={`msg ${me ? "me" : "bot"}`}>
              {me ? null : <Avatar bot={bot} size="sm" />}
              <div className="body">
                {showNames && !me ? <span className="who">{bot?.name ?? m.from}</span> : null}
                <div className={`bubble ${m.streaming ? "cursor" : ""}`}><Markdown text={m.text} /></div>
              </div>
              <span className="time">{fmtTime(m.ts)}</span>
            </div>
          );
        } else if (m.kind === "tool") {
          node = <div className="chip" title={bot?.name}>⚙︎ {showNames ? <b>{bot?.name}:</b> : null} <span dangerouslySetInnerHTML={{ __html: m.text.replace(/`([^`]+)`/g, "<code>$1</code>") }} /></div>;
        } else if (m.kind === "approval") {
          const a = m.approvalId ? approvals[m.approvalId] : undefined;
          node = a ? <ApprovalCard a={a} bot={bot} /> : <div className="status-line">{m.text}</div>;
        } else {
          node = <div className={`status-line ${m.kind === "error" ? "error" : ""}`}>{m.text}</div>;
        }
        return (
          <div key={m.id} style={{ display: "contents" }}>
            {sep}
            {node}
          </div>
        );
      })}
      {typing.length && !lastStreaming ? (
        <div className="typing" title={typing.map((m) => byId.get(m)?.name).join(", ")}><i /><i /><i /></div>
      ) : null}
      {!messages.length ? <div className="blank"><span className="mark">✱</span><span>{thread.kind === "dm" ? `Say hello to ${thread.title}.` : "Start the conversation."}</span></div> : null}
    </div>
  );
}

// ---------- composer ----------

export function Composer(props: { thread: Thread; bots: Bot[]; onSend: (text: string) => Promise<void> }) {
  const { thread, bots, onSend } = props;
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [mention, setMention] = useState<{ q: string; start: number } | null>(null);
  const [sel, setSel] = useState(0);
  const ta = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setText("");
    setMention(null);
    ta.current?.focus();
  }, [thread.id]);

  useEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 180) + "px";
  }, [text]);

  const candidates = useMemo(() => {
    if (!mention) return [];
    const pool = thread.kind === "dm" ? bots : bots.filter((b) => thread.members.includes(b.id));
    return pool.filter((b) => b.id.startsWith(mention.q) || b.name.toLowerCase().startsWith(mention.q)).slice(0, 6);
  }, [mention, bots, thread]);

  const onChange = (v: string) => {
    setText(v);
    const el = ta.current;
    const pos = el?.selectionStart ?? v.length;
    const before = v.slice(0, pos);
    const m = /(^|\s)@([a-z0-9-]*)$/i.exec(before);
    if (m) {
      setMention({ q: m[2].toLowerCase(), start: pos - m[2].length - 1 });
      setSel(0);
    } else setMention(null);
  };

  const pick = (b: Bot) => {
    if (!mention) return;
    const el = ta.current;
    const pos = el?.selectionStart ?? text.length;
    const next = text.slice(0, mention.start) + `@${b.id} ` + text.slice(pos);
    setText(next);
    setMention(null);
    requestAnimationFrame(() => {
      const p = mention.start + b.id.length + 2;
      el?.setSelectionRange(p, p);
      el?.focus();
    });
  };

  const send = async () => {
    const v = text.trim();
    if (!v || sending) return;
    setSending(true);
    try {
      await onSend(v);
      setText("");
    } finally {
      setSending(false);
      ta.current?.focus();
    }
  };

  const onKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (mention && candidates.length) {
      if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => (s + 1) % candidates.length); return; }
      if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => (s - 1 + candidates.length) % candidates.length); return; }
      if (e.key === "Enter" || e.key === "Tab") { e.preventDefault(); pick(candidates[sel]); return; }
      if (e.key === "Escape") { setMention(null); return; }
    }
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  };

  const placeholder = thread.kind === "dm" ? `Message ${thread.title}` : thread.kind === "group" ? "Message the group · @mention a bot to bring it in" : "Join this conversation";

  return (
    <div className="composer">
      {mention && candidates.length ? (
        <div className="mention-pop">
          {candidates.map((b, i) => (
            <button key={b.id} className={i === sel ? "sel" : ""} onMouseDown={(e) => { e.preventDefault(); pick(b); }}>
              <Avatar bot={b} size="sm" /> <span>{b.name}</span> <span className="id">@{b.id}</span>
            </button>
          ))}
        </div>
      ) : null}
      {thread.paused ? <div className="paused">Paused after the bot-to-bot exchange limit. Your message resumes it.</div> : null}
      <div className="composer-box">
        <textarea ref={ta} rows={1} value={text} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} onKeyDown={onKey} />
        <button className="send" onClick={send} disabled={!text.trim() || sending} aria-label="Send">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M12 19V5" /><path d="m5 12 7-7 7 7" /></svg>
        </button>
      </div>
      <div className="hint">Enter to send · Shift+Enter for a new line · @ to mention a bot</div>
    </div>
  );
}
