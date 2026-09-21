// A small Markdown renderer for chat bubbles: paragraphs, headings, lists,
// code fences, inline code, bold, italic, links and @mentions. No HTML.

import type { ReactNode } from "react";

function inline(text: string, key = 0): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(`[^`]+`)|(\*\*[^*]+\*\*)|(\*[^*\n]+\*)|(_[^_\n]+_)|(\[[^\]]+\]\([^)\s]+\))|(@[a-z0-9][a-z0-9-]*)|(https?:\/\/[^\s<]+)/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const k = `${key}-${i++}`;
    if (m[1]) out.push(<code key={k}>{m[1].slice(1, -1)}</code>);
    else if (m[2]) out.push(<strong key={k}>{m[2].slice(2, -2)}</strong>);
    else if (m[3]) out.push(<em key={k}>{m[3].slice(1, -1)}</em>);
    else if (m[4]) out.push(<em key={k}>{m[4].slice(1, -1)}</em>);
    else if (m[5]) {
      const mm = /\[([^\]]+)\]\(([^)\s]+)\)/.exec(m[5])!;
      out.push(<a key={k} href={mm[2]} target="_blank" rel="noreferrer">{mm[1]}</a>);
    } else if (m[6]) out.push(<span key={k} className="mention">{m[6]}</span>);
    else if (m[7]) out.push(<a key={k} href={m[7]} target="_blank" rel="noreferrer">{m[7]}</a>);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let k = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) buf.push(lines[i++]);
      i++;
      blocks.push(<pre key={k++}>{buf.join("\n")}</pre>);
      continue;
    }
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const Tag = (`h${h[1].length}` as "h1" | "h2" | "h3");
      blocks.push(<Tag key={k++}>{inline(h[2], k)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*([-*•]|\d+\.)\s+/.test(line)) {
      const items: string[] = [];
      const ordered = /^\s*\d+\./.test(line);
      while (i < lines.length && /^\s*([-*•]|\d+\.)\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+\.)\s+/, ""));
      const L = ordered ? "ol" : "ul";
      blocks.push(<L key={k++}>{items.map((it, j) => <li key={j}>{inline(it, k * 100 + j)}</li>)}</L>);
      continue;
    }
    if (!line.trim()) {
      i++;
      continue;
    }
    const buf: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !/^(#{1,3})\s/.test(lines[i]) && !/^\s*([-*•]|\d+\.)\s+/.test(lines[i])) buf.push(lines[i++]);
    blocks.push(<p key={k++}>{buf.map((l, j) => <span key={j}>{inline(l, k * 100 + j)}{j < buf.length - 1 ? <br /> : null}</span>)}</p>);
  }
  return <>{blocks}</>;
}
