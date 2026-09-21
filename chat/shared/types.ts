// Shared between server and UI.

export type BotColor = "purple" | "blue" | "green" | "orange" | "pink" | "red" | "cyan" | "yellow";

export type Bot = {
  id: string;            // agent name, e.g. "content-writer"
  name: string;          // display name, e.g. "Content Writer"
  role: string;          // one-line description from frontmatter
  charter: string;       // markdown body of the agent file
  color: BotColor;
  model: string;         // "inherit" | "sonnet" | "opus" | "haiku" | full id
  file: string;          // absolute path of the definition
  autopilot: boolean;    // true = bypass permission prompts
};

export type BotStatus = "idle" | "working" | "waiting";

export type BotState = {
  botId: string;
  status: BotStatus;
  sessionId?: string;
  activeThreadId?: string;
  lastActivity?: string;  // short text, e.g. "Ran /build-database"
  totalCostUsd: number;
};

export type ThreadKind = "dm" | "group" | "bot-dm";

export type Thread = {
  id: string;
  kind: ThreadKind;
  members: string[];     // bot ids; the human is implicitly in dm + group threads
  title: string;
  createdAt: number;
  lastAt: number;
  lastPreview?: string;
  unread: number;
  paused?: boolean;      // hop limit reached; a human message resumes it
};

export type MessageKind = "text" | "tool" | "status" | "error" | "approval";

export type Message = {
  id: string;
  threadId: string;
  from: string;          // "you" | bot id | "system"
  kind: MessageKind;
  text: string;
  ts: number;
  streaming?: boolean;
  mentions?: string[];
  approvalId?: string;
};

export type ApprovalStatus = "pending" | "allowed" | "allowed-session" | "denied";

export type Approval = {
  id: string;
  botId: string;
  threadId: string;
  toolName: string;
  title: string;
  description: string;
  input: Record<string, unknown>;
  status: ApprovalStatus;
  ts: number;
};

export type Snapshot = {
  bots: Bot[];
  botStates: Record<string, BotState>;
  threads: Thread[];
  messages: Record<string, Message[]>;   // by thread id
  approvals: Approval[];
  projectRoot: string;
};

export type ServerEvent =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "message:add"; message: Message }
  | { type: "message:update"; message: Message }
  | { type: "thread:upsert"; thread: Thread }
  | { type: "bot:upsert"; bot: Bot }
  | { type: "bot:state"; state: BotState }
  | { type: "approval:upsert"; approval: Approval }
  | { type: "toast"; level: "info" | "error"; text: string };

export type NewBotInput = {
  id: string;
  name: string;
  role: string;
  charter: string;
  color: BotColor;
  model: string;
};
