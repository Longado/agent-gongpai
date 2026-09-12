// 粘贴导入：文本或 Markdown 对话。也用来代替 Gemini 浏览器扩展。
import { createHash } from 'node:crypto';
import type { Coverage, Message, Role } from '../contracts.ts';
import type { Db } from '../db.ts';
import { redact } from '../redact.ts';

const USER = '(?:你|我|用户|User|You|Me|Human)';
const AI = '(?:AI|助手|Gemini|ChatGPT|Claude|Codex|Assistant|Model|DeepSeek|Kimi|豆包|Doubao)';
// 行首标记：“你：”“User:”“**You**”“## Assistant”“You said”
const MARK = new RegExp(`^\\s*(?:#{1,4}\\s*|\\*\\*)?(${USER}|${AI})(?:\\*\\*)?(?:\\s*said)?\\s*(?:[:：]|\\*\\*|$)\\s*`, 'i');
const IS_USER = new RegExp(`^${USER}$`, 'i');

export interface Turn {
  role: Role;
  text: string;
  unsure?: boolean;
}

export function splitSpeakers(text: string): Turn[] {
  const turns: Turn[] = [];
  for (const line of text.replace(/\r\n/g, '\n').split('\n')) {
    const m = line.match(MARK);
    if (m) {
      turns.push({ role: IS_USER.test(m[1]) ? 'user' : 'assistant', text: line.slice(m[0].length) });
    } else if (turns.length > 0) {
      turns[turns.length - 1].text += `\n${line}`;
    } else if (line.trim()) {
      turns.push({ role: 'user', text: line, unsure: true });
    }
  }
  return turns.map((t) => ({ ...t, text: t.text.trim() })).filter((t) => t.text !== '');
}

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 16);

export interface ImportInput {
  projectId: string | null; // null 进待归类
  text: string;
  label: string; // 来源名，比如“Gemini 网页”
  title: string;
  coverage?: Coverage;
  date?: string; // 用户标注的大概日期 YYYY-MM-DD
}

/** 新旧两个版本逐条对齐（最长公共子序列），返回新版本每一条对应的旧消息编号。 */
function align(oldKeys: string[], newKeys: string[]): (number | null)[] {
  const n = oldKeys.length, m = newKeys.length;
  const dp = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = oldKeys[i] === newKeys[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: (number | null)[] = new Array(m).fill(null);
  for (let i = 0, j = 0; i < n && j < m; ) {
    if (oldKeys[i] === newKeys[j]) { out[j] = i; i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

export function importText(db: Db, input: ImportInput): { sessionId: string; newMessages: number; unsure: boolean } {
  const turns = splitSpeakers(input.text).map((t) => ({ ...t, text: redact(t.text) }));
  const sessionId = `im-${hash(`${input.projectId}|${input.label}|${input.title}`)}`;
  const label = input.date ? `${input.label}（日期由你标注）` : input.label;
  db.upsertSession({ id: sessionId, source: 'import', label, projectId: input.projectId, cwd: null, title: input.title, coverage: input.coverage ?? 'full' });
  db.raw.prepare('UPDATE sessions SET coverage = ?, label = ? WHERE id = ?').run(input.coverage ?? 'full', label, sessionId);

  // 再次导入同一段对话：对上的沿用旧编号，没对上的才是新消息。往前补、往后续都不会重复
  const existing = db.messagesForSession(sessionId);
  const key = (role: string, text: string) => `${role}|${text}`;
  const matched = align(existing.map((m) => key(m.role, m.text)), turns.map((t) => key(t.role, t.text)));
  const seen = new Map<string, number>();
  existing.forEach((m) => seen.set(key(m.role, m.text), (seen.get(key(m.role, m.text)) ?? 0) + 1));

  const capturedAt = new Date().toISOString();
  const base = input.date ? Date.parse(`${input.date}T09:00:00+08:00`) : NaN;
  const msgs: Message[] = turns.map((t, i) => {
    const old = matched[i];
    let id: string;
    if (old !== null) id = existing[old].id;
    else {
      const k = key(t.role, t.text);
      const nth = (seen.get(k) ?? 0) + 1; // 第几次出现同样的话
      seen.set(k, nth);
      id = `im:${hash(`${sessionId}|${k}|${nth}`)}`;
    }
    return {
      id, sessionId, seq: i, role: t.role, text: t.text,
      ts: Number.isNaN(base) ? (old !== null ? existing[old].ts : null) : new Date(base + i * 60_000).toISOString(),
      capturedAt: old !== null ? existing[old].capturedAt : capturedAt,
    };
  });
  const newMessages = db.insertMessages(msgs);
  // 顺序以最新一次导入为准
  const reseq = db.raw.prepare('UPDATE messages SET seq = ?, ts = ? WHERE id = ?');
  db.tx(() => msgs.forEach((m) => reseq.run(m.seq, m.ts, m.id)));
  return { sessionId, newMessages, unsure: turns.some((t) => t.unsure) };
}
