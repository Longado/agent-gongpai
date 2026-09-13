// Google Takeout 里的 Gemini 数据，两种：
// 1. “我的活动 → Gemini Apps”（MyActivity.json）：网页版 gemini.google.com 的活动日志，每条记录一问一答。
//    字段结构按公开资料写成（details、userInteractions、Prompted 标题加 safeHtmlItem），没有用真实导出验证过。
// 2. “Gemini in Workspace → Conversation History”（conversation_<编号>.txt，内容是 JSON）：Gmail、Docs 侧边栏的对话。
//    结构照 2026-09-13 的一份真实导出写成。
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import type { Message, Role } from '../contracts.ts';
import type { Db } from '../db.ts';
import { redact } from '../redact.ts';

export interface TakeoutTurn {
  role: Role;
  text: string;
  ts: string;
}

export interface TakeoutConversation {
  key: string;
  source: 'Gemini 网页' | 'Gemini in Workspace';
  url: string | null;
  title: string;
  start: string;
  turns: TakeoutTurn[];
  missingResponse: boolean; // 有提问没有回复：导出里常见，按“部分”处理
}

type Rec = Record<string, unknown>;

const ENTITIES: Record<string, string> = { '&nbsp;': ' ', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&amp;': '&' };
const stripHtml = (h: string) =>
  h.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&(nbsp|lt|gt|quot|#39|amp);/g, (m) => ENTITIES[m]).replace(/\n{3,}/g, '\n\n').trim();

/** 在嵌套对象里找第一个键名匹配的文字：值本身是字符串，或者是带 text 字段的对象。 */
function findText(obj: unknown, key: RegExp, depth = 0): string | null {
  if (!obj || typeof obj !== 'object' || depth > 6) return null;
  for (const [k, v] of Object.entries(obj as Rec)) {
    if (key.test(k)) {
      if (typeof v === 'string' && v.trim()) return v;
      if (v && typeof v === 'object' && typeof (v as Rec).text === 'string') return (v as Rec).text as string;
    }
  }
  for (const v of Object.values(obj as Rec)) {
    const hit = findText(v, key, depth + 1);
    if (hit) return hit;
  }
  return null;
}

function extract(rec: Rec): { q: string | null; a: string | null } {
  let q: string | null = null, a: string | null = null;
  if (Array.isArray(rec.details)) {
    for (const d of rec.details as Rec[]) {
      if (/request|prompt/i.test(String(d.name)) && typeof d.value === 'string') q ??= d.value;
      if (/response|answer/i.test(String(d.name)) && typeof d.value === 'string') a ??= d.value;
    }
  }
  if (Array.isArray(rec.userInteractions)) {
    for (const s of rec.userInteractions) {
      let v: unknown = s;
      if (typeof s === 'string') { try { v = JSON.parse(s); } catch { v = null; } }
      q ??= findText(v, /request|prompt|query/i);
      a ??= findText(v, /response|answer|reply/i);
    }
  }
  if (typeof rec.title === 'string' && /^Prompted\s/.test(rec.title)) q ??= rec.title.replace(/^Prompted\s+/, '');
  if (Array.isArray(rec.safeHtmlItem)) {
    const html = (rec.safeHtmlItem as Rec[]).map((x) => (typeof x.html === 'string' ? x.html : '')).join('\n');
    if (html.trim()) a ??= stripHtml(html);
  }
  return { q: q?.trim() || null, a: a?.trim() || null };
}

const dayOf = (iso: string) => new Intl.DateTimeFormat('sv-SE', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(iso));

export function parseTakeout(raw: unknown): TakeoutConversation[] {
  if (!Array.isArray(raw)) throw new Error('这不是 Takeout 的活动导出：应该是一个 JSON 数组（MyActivity.json）');
  const recs = (raw as Rec[]).filter((r) => r && typeof r.time === 'string').sort((x, y) => Date.parse(x.time as string) - Date.parse(y.time as string));
  const convs = new Map<string, TakeoutConversation>();
  for (const rec of recs) {
    const { q, a } = extract(rec);
    if (!q && !a) continue; // 只有“Used Gemini Apps”没有内容的记录
    const time = rec.time as string;
    const id = typeof rec.titleUrl === 'string' ? rec.titleUrl.match(/\/app\/(?:c\/)?([A-Za-z0-9_-]+)/)?.[1] : undefined;
    const key = id ?? `day-${dayOf(time)}`;
    const conv: TakeoutConversation = convs.get(key) ?? { key, source: 'Gemini 网页', url: id ? `https://gemini.google.com/app/${id}` : null, title: '', start: time, turns: [], missingResponse: false };
    if (q) conv.turns.push({ role: 'user', text: q, ts: time });
    if (a) conv.turns.push({ role: 'assistant', text: a, ts: time });
    if (q && !a) conv.missingResponse = true;
    if (!conv.title && q) conv.title = q.length > 40 ? `${q.slice(0, 40)}…` : q;
    convs.set(key, conv);
  }
  return [...convs.values()].map((c) => ({ ...c, title: c.title || '（没有提问的对话）' })).sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
}

/** Workspace 侧边栏的一段对话：用户轮带 prompt，Gemini 轮带 text[].data，可能有引用和图片。 */
export function parseWorkspaceConversation(raw: unknown, id: string): TakeoutConversation | null {
  const d = raw as { conversation_turns?: Rec[]; title?: string; creation_time?: string };
  if (!d || !Array.isArray(d.conversation_turns)) return null;
  const turns: TakeoutTurn[] = [];
  let unanswered = false;
  for (const t of d.conversation_turns) {
    const u = t.user_turn as Rec | undefined;
    const sys = t.system_turn as Rec | undefined;
    if (u && typeof u.prompt === 'string' && u.prompt.trim()) {
      turns.push({ role: 'user', text: u.prompt, ts: String(u.turn_last_modified ?? d.creation_time ?? '') });
      unanswered = true;
    }
    if (sys) {
      const parts = Array.isArray(sys.text) ? (sys.text as Rec[]).map((x) => (typeof x.data === 'string' ? x.data : '')).filter(Boolean) : [];
      const cites = Array.isArray(sys.citations) ? (sys.citations as Rec[]).map((c) => `引用：${c.display_text ?? ''} ${c.url ?? ''}`.trim()) : [];
      const images = Array.isArray(sys.images) ? (sys.images as string[]).map((n) => `[图片] ${n}`) : [];
      const text = [...parts, ...cites, ...images].join('\n').trim();
      if (text) { turns.push({ role: 'assistant', text, ts: String(sys.turn_last_modified ?? d.creation_time ?? '') }); unanswered = false; }
    }
  }
  if (!turns.length) return null;
  const first = turns.find((t) => t.role === 'user')?.text ?? '';
  const title = (d.title?.trim() || first || '（没有提问的对话）');
  return { key: `ws-${id}`, source: 'Gemini in Workspace', url: null, title: title.length > 60 ? `${title.slice(0, 60)}…` : title, start: turns[0].ts, turns, missingResponse: unanswered };
}

function walkFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walkFiles(p) : [p];
  });
}

/** 读 Takeout：zip 包、解压后的文件夹、MyActivity.json 或单个 Workspace 对话文件都行，自动识别。 */
export function readTakeoutPath(path: string): TakeoutConversation[] {
  if (path.toLowerCase().endsWith('.zip')) {
    const tmp = mkdtempSync(join(tmpdir(), 'corpus-takeout-'));
    try {
      execFileSync('unzip', ['-qq', '-o', path, '-d', tmp], { stdio: ['ignore', 'ignore', 'pipe'] });
      return readTakeoutPath(tmp);
    } catch (e) {
      throw new Error(`解压失败：${(e as Error).message.split('\n')[0]}`);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
  const files = statSync(path).isDirectory() ? walkFiles(path) : [path];
  const out: TakeoutConversation[] = [];
  for (const f of files) {
    if (!/\.(json|txt)$/i.test(f)) continue;
    let raw: unknown;
    try { raw = JSON.parse(readFileSync(f, 'utf8')); } catch { continue; } // 不是 JSON 的文件跳过
    if (Array.isArray(raw)) {
      if (raw.some((r) => r && typeof r === 'object' && /gemini/i.test(JSON.stringify((r as Rec).products ?? (r as Rec).header ?? '')))) out.push(...parseTakeout(raw));
    } else {
      const ws = parseWorkspaceConversation(raw, basename(f).match(/conversation_(\w+)/)?.[1] ?? basename(f).replace(/\.\w+$/, ''));
      if (ws) out.push(ws);
    }
  }
  return out.sort((a, b) => Date.parse(a.start) - Date.parse(b.start));
}

/** 把挑选的对话导入项目。重复导入同一份文件不会重复写入。 */
export function importConversations(db: Db, projectId: string, conversations: TakeoutConversation[], keys: string[] | 'all'): { sessions: number; newMessages: number } {
  const picked = conversations.filter((c) => keys === 'all' || keys.includes(c.key));
  const capturedAt = new Date().toISOString();
  let newMessages = 0;
  for (const c of picked) {
    const sessionId = `tk-${c.key}`;
    db.upsertSession({ id: sessionId, source: 'import', label: `${c.source}（Takeout）`, projectId, cwd: null, title: c.title, coverage: c.missingResponse ? 'partial' : 'full', url: c.url });
    const msgs: Message[] = c.turns.map((t, i) => ({
      id: `tk:${c.key}:${t.ts}:${t.role === 'user' ? 'u' : 'a'}`,
      sessionId, seq: i, role: t.role, text: redact(t.text), ts: t.ts || null, capturedAt,
    }));
    newMessages += db.insertMessages(msgs);
  }
  return { sessions: picked.length, newMessages };
}

export function importTakeout(db: Db, projectId: string, raw: unknown, keys: string[] | 'all') {
  return importConversations(db, projectId, parseTakeout(raw), keys);
}
