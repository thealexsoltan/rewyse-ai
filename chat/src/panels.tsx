import { useEffect, useState } from "react";
import type { Bot, BotColor, BotState, NewBotInput } from "../shared/types";
import { Avatar, colorVar } from "./components";
import { api } from "./store";

const COLORS: BotColor[] = ["purple", "blue", "green", "orange", "pink", "red", "cyan", "yellow"];
const MODELS = [
  ["inherit", "Default (your session model)"],
  ["opus", "Opus"],
  ["sonnet", "Sonnet"],
  ["haiku", "Haiku (cheapest)"],
];

// ---------- bot profile ----------

export function Profile(props: { bot: Bot; state?: BotState; onClose: () => void; onToast: (level: "info" | "error", text: string) => void }) {
  const { bot, state, onClose, onToast } = props;
  const [role, setRole] = useState(bot.role);
  const [charter, setCharter] = useState(bot.charter);
  const [model, setModel] = useState(bot.model);
  const [color, setColor] = useState<BotColor>(bot.color);
  const [memory, setMemory] = useState<string>("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRole(bot.role);
    setCharter(bot.charter);
    setModel(bot.model);
    setColor(bot.color);
    void api<{ memory: string }>("GET", `/api/bots/${bot.id}/memory`).then((r) => setMemory(r.memory)).catch(() => setMemory(""));
  }, [bot.id, bot.role, bot.charter, bot.model, bot.color]);

  const dirty = role !== bot.role || charter !== bot.charter || model !== bot.model || color !== bot.color;

  const save = async () => {
    setSaving(true);
    try {
      await api("PATCH", `/api/bots/${bot.id}`, { role, charter, model, color });
      onToast("info", `${bot.name} updated. Takes effect on its next message.`);
    } catch (err) {
      onToast("error", (err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const toggleAutopilot = async () => {
    try {
      await api("PATCH", `/api/bots/${bot.id}`, { autopilot: !bot.autopilot });
    } catch (err) {
      onToast("error", (err as Error).message);
    }
  };

  return (
    <aside className="profile">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span className="head" style={{ fontSize: 13, color: "var(--ink-3)" }}>Profile</span>
        <button className="pill-btn" onClick={onClose}>Close</button>
      </div>
      <div className="center">
        <Avatar bot={{ ...bot, color }} size="lg" status={state?.status} />
        <h2>{bot.name}</h2>
        <span className="id">@{bot.id} · {state?.status ?? "idle"}</span>
      </div>

      <div className="toggle">
        <div>
          <div className="t">Autopilot</div>
          <div className="d">{bot.autopilot ? "Runs tools without asking. Use for bots you trust unattended." : "Asks you before running commands or editing files."}</div>
        </div>
        <button className={`switch ${bot.autopilot ? "on" : ""}`} onClick={toggleAutopilot} aria-label="Toggle autopilot" />
      </div>

      <div className="field">
        <label>Job</label>
        <input value={role} onChange={(e) => setRole(e.target.value)} />
      </div>
      <div className="field">
        <label>Model</label>
        <select value={model} onChange={(e) => setModel(e.target.value)}>
          {MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {!MODELS.some(([v]) => v === model) ? <option value={model}>{model}</option> : null}
        </select>
      </div>
      <div className="field">
        <label>Color</label>
        <div className="color-row">
          {COLORS.map((c) => <button key={c} className={`swatch ${c === color ? "on" : ""}`} style={{ background: colorVar(c) }} onClick={() => setColor(c)} aria-label={c} />)}
        </div>
      </div>
      <div className="field">
        <label>Charter (the bot's instructions)</label>
        <textarea value={charter} onChange={(e) => setCharter(e.target.value)} />
      </div>
      <div className="actions">
        <button className="pill-btn on" disabled={!dirty || saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
        <button className="pill-btn" disabled={!dirty} onClick={() => { setRole(bot.role); setCharter(bot.charter); setModel(bot.model); setColor(bot.color); }}>Revert</button>
      </div>

      <div className="field">
        <label>Memory (what this bot has learned)</label>
        <div className="memory">{memory || "Nothing saved yet. The bot writes here as it works."}</div>
      </div>

      <div className="stat"><span>Spent this run</span><span>${(state?.totalCostUsd ?? 0).toFixed(2)}</span></div>
      <div className="stat"><span>Session</span><span style={{ fontFamily: "var(--font-mono)", fontSize: 11 }}>{state?.sessionId ? state.sessionId.slice(0, 8) : "none yet"}</span></div>
      <div className="actions">
        <button className="pill-btn danger" onClick={async () => { if (confirm(`Reset ${bot.name}'s session? Chat history stays, the bot forgets this conversation (memory files are kept).`)) { await api("POST", `/api/bots/${bot.id}/reset`); onToast("info", "Session reset."); } }}>Reset session</button>
      </div>
      <div className="d" style={{ fontSize: 12, color: "var(--ink-3)" }}>Definition file: <code style={{ fontSize: 11 }}>{bot.file}</code></div>
    </aside>
  );
}

// ---------- new chat ----------

export function NewChatModal(props: { bots: Bot[]; onClose: () => void; onCreated: (threadId: string) => void; onToast: (level: "info" | "error", text: string) => void }) {
  const { bots, onClose, onCreated, onToast } = props;
  const [picked, setPicked] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const create = async () => {
    try {
      const t = await api<{ id: string }>("POST", "/api/threads", { members: picked, title });
      onCreated(t.id);
      onClose();
    } catch (err) {
      onToast("error", (err as Error).message);
    }
  };
  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>New chat</h2>
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Pick one bot for a DM, or two to six for a group chat where they can talk to each other.</div>
        <div className="check-list">
          {bots.map((b) => (
            <label key={b.id} className={picked.includes(b.id) ? "on" : ""}>
              <input type="checkbox" checked={picked.includes(b.id)} onChange={() => toggle(b.id)} />
              <Avatar bot={b} size="sm" />
              <span style={{ minWidth: 0 }}>
                <span className="head" style={{ fontSize: 14 }}>{b.name}</span>
                <div className="role">{b.role}</div>
              </span>
            </label>
          ))}
        </div>
        {picked.length > 1 ? (
          <div className="field">
            <label>Group name (optional)</label>
            <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Launch plan" />
          </div>
        ) : null}
        <div className="foot">
          <button className="pill-btn" onClick={onClose}>Cancel</button>
          <button className="pill-btn on" disabled={!picked.length || picked.length > 6} onClick={create}>{picked.length > 1 ? "Create group" : "Open chat"}</button>
        </div>
      </div>
    </div>
  );
}

// ---------- new bot ----------

export function NewBotModal(props: { onClose: () => void; onCreated: (botId: string) => void; onToast: (level: "info" | "error", text: string) => void }) {
  const { onClose, onCreated, onToast } = props;
  const [name, setName] = useState("");
  const [role, setRole] = useState("");
  const [charter, setCharter] = useState("");
  const [color, setColor] = useState<BotColor>("blue");
  const [model, setModel] = useState("inherit");
  const [err, setErr] = useState("");
  const id = name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

  const create = async () => {
    setErr("");
    try {
      const input: NewBotInput = { id, name: name.trim(), role: role.trim(), charter, color, model };
      const b = await api<Bot>("POST", "/api/bots", input);
      onToast("info", `${b.name} joined the team.`);
      onCreated(b.id);
      onClose();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <div className="backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <h2>New bot</h2>
        <div style={{ color: "var(--ink-3)", fontSize: 13 }}>Name it after the job. One bot, one job, a clear description of how it should work. This writes a Claude Code agent file, so the same bot also works from the terminal.</div>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Email Outreach" autoFocus />
          {id ? <div style={{ fontSize: 12, color: "var(--ink-3)", marginTop: 4 }}>id: <code>@{id}</code></div> : null}
        </div>
        <div className="field">
          <label>Job (one line)</label>
          <input value={role} onChange={(e) => setRole(e.target.value)} placeholder="Drafts and sends launch emails for each finished product" />
        </div>
        <div className="field">
          <label>How it should work (optional, Markdown)</label>
          <textarea value={charter} onChange={(e) => setCharter(e.target.value)} placeholder={"## You own\n- ...\n\n## Hand-offs\n- ...\n\n## Never\n- ..."} />
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          <div className="field">
            <label>Model</label>
            <select value={model} onChange={(e) => setModel(e.target.value)}>
              {MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Color</label>
            <div className="color-row">
              {COLORS.map((c) => <button key={c} className={`swatch ${c === color ? "on" : ""}`} style={{ background: colorVar(c) }} onClick={() => setColor(c)} aria-label={c} />)}
            </div>
          </div>
        </div>
        {err ? <div className="err">{err}</div> : null}
        <div className="foot">
          <button className="pill-btn" onClick={onClose}>Cancel</button>
          <button className="pill-btn on" disabled={!id || !role.trim()} onClick={create}>Create bot</button>
        </div>
      </div>
    </div>
  );
}
