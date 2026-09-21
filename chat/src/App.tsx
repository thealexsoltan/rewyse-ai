import { useEffect, useMemo, useState } from "react";
import { Avatar, Composer, MessageList } from "./components";
import { Sidebar } from "./components";
import { NewBotModal, NewChatModal, Profile } from "./panels";
import { api, useServer } from "./store";

export default function App() {
  const [state, dispatch] = useServer();
  const [activeId, setActiveId] = useState<string | null>(null);
  const [showProfile, setShowProfile] = useState(false);
  const [modal, setModal] = useState<"chat" | "bot" | null>(null);

  const byId = useMemo(() => new Map(state.bots.map((b) => [b.id, b])), [state.bots]);
  const thread = state.threads.find((t) => t.id === activeId) ?? null;
  const dmBot = thread?.kind === "dm" ? byId.get(thread.members[0]) : undefined;

  // Default to the chief of staff (or the first bot) once the snapshot arrives.
  useEffect(() => {
    if (activeId || !state.threads.length) return;
    const first = state.threads.find((t) => t.id === "dm:chief-of-staff") ?? state.threads.find((t) => t.kind === "dm");
    if (first) setActiveId(first.id);
  }, [state.threads, activeId]);

  useEffect(() => {
    if (thread?.unread) void api("POST", `/api/threads/${thread.id}/read`).catch(() => {});
  }, [thread?.id, thread?.unread]);

  useEffect(() => {
    const unread = state.threads.reduce((n, t) => n + t.unread, 0);
    document.title = unread ? `(${unread}) Claude Bots` : "Claude Bots";
  }, [state.threads]);

  const toast = (level: "info" | "error", text: string) => dispatch({ type: "toast", level, text });

  const send = async (text: string) => {
    if (!thread) return;
    try {
      await api("POST", `/api/threads/${thread.id}/messages`, { text });
    } catch (err) {
      toast("error", (err as Error).message);
      throw err;
    }
  };

  const working = thread ? thread.members.filter((m) => state.botStates[m]?.status === "working") : [];
  const waiting = thread ? thread.members.filter((m) => state.botStates[m]?.status === "waiting") : [];
  const subtitle = (() => {
    if (!thread) return "";
    if (thread.kind === "dm" && dmBot) {
      const st = state.botStates[dmBot.id];
      if (st?.status === "working") return st.lastActivity ?? "Working…";
      if (st?.status === "waiting") return "Waiting for your approval";
      return dmBot.role;
    }
    const names = thread.members.map((m) => byId.get(m)?.name ?? m).join(", ");
    if (working.length) return `${working.map((m) => byId.get(m)?.name).join(", ")} working…`;
    return names;
  })();

  return (
    <div className={`app ${showProfile && dmBot ? "with-profile" : ""}`}>
      <Sidebar
        bots={state.bots}
        botStates={state.botStates}
        threads={state.threads}
        activeId={activeId}
        onSelect={(id) => setActiveId(id)}
        onNewChat={() => setModal("chat")}
        onNewBot={() => setModal("bot")}
        connected={state.connected}
      />

      {thread ? (
        <main className="thread">
          <header className="thread-header">
            {dmBot ? <Avatar bot={dmBot} status={state.botStates[dmBot.id]?.status} /> : thread.kind === "group" ? <Avatar group /> : (
              <span className="stack">{thread.members.map((m) => byId.get(m)).filter(Boolean).map((b) => <Avatar key={b!.id} bot={b!} size="sm" />)}</span>
            )}
            <div className="grow">
              <div className="title head">{thread.title}</div>
              <div className="sub">{subtitle}</div>
            </div>
            {waiting.length ? <span className="pill-btn on">Needs you</span> : null}
            {working.length ? (
              <button className="pill-btn danger" onClick={() => Promise.all(working.map((m) => api("POST", `/api/bots/${m}/interrupt`))).catch(() => {})}>Stop</button>
            ) : null}
            {dmBot ? <button className={`pill-btn ${showProfile ? "on" : ""}`} onClick={() => setShowProfile((v) => !v)}>Profile</button> : null}
          </header>
          <MessageList thread={thread} messages={state.messages[thread.id] ?? []} bots={state.bots} botStates={state.botStates} approvals={state.approvals} />
          <Composer thread={thread} bots={state.bots} onSend={send} />
        </main>
      ) : (
        <main className="thread">
          <div className="blank">
            <span className="mark">✱</span>
            <h2>Claude Bots</h2>
            <span>{state.bots.length ? "Pick a bot on the left, or start a new chat." : "Add your first bot with the person icon."}</span>
          </div>
        </main>
      )}

      {showProfile && dmBot ? <Profile bot={dmBot} state={state.botStates[dmBot.id]} onClose={() => setShowProfile(false)} onToast={toast} /> : null}

      {modal === "chat" ? <NewChatModal bots={state.bots} onClose={() => setModal(null)} onCreated={(id) => setActiveId(id)} onToast={toast} /> : null}
      {modal === "bot" ? <NewBotModal onClose={() => setModal(null)} onCreated={(id) => setActiveId(`dm:${id}`)} onToast={toast} /> : null}

      {state.toast ? <div className={`toast ${state.toast.level}`}>{state.toast.text}</div> : null}
    </div>
  );
}
