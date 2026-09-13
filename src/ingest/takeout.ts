// Google Takeout 的 Gemini 活动导出（My Activity → Gemini Apps → MyActivity.json）。
// 它是活动日志不是对话树：每条记录是一问一答加时间。按记录里的对话编号归回成对话，拿不到编号就按天归组。
// 注意：字段结构按公开资料写成（details、userInteractions、Prompted 标题加 safeHtmlItem 几种），没有用真实导出验证过。
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
    const conv = convs.get(key) ?? { key, url: id ? `https://gemini.google.com/app/${id}` : null, title: '', start: time, turns: [], missingResponse: false };
    if (q) conv.turns.push({ role: 'user', text: q, ts: time });
    if (a) conv.turns.push({ role: 'assistant', text: a, ts: time });
    if (q && !a) conv.missingResponse = true;
    if (!conv.title && q) conv.title = q.length > 40 ? `${q.slice(0, 40)}…` : q;
    convs.set(key, conv);
  }
  return [...convs.values()].map((c) => ({ ...c, title: c.title || '（没有提问的对话）' })).sort((x, y) => Date.parse(x.start) - Date.parse(y.start));
}

/** 把挑选的对话导入项目。重复导入同一份文件不会重复写入。 */
export function importTakeout(db: Db, projectId: string, raw: unknown, keys: string[] | 'all'): { sessions: number; newMessages: number } {
  const picked = parseTakeout(raw).filter((c) => keys === 'all' || keys.includes(c.key));
  const capturedAt = new Date().toISOString();
  let newMessages = 0;
  for (const c of picked) {
    const sessionId = `tk-${c.key}`;
    db.upsertSession({ id: sessionId, source: 'import', label: 'Gemini 网页（Takeout）', projectId, cwd: null, title: c.title, coverage: c.missingResponse ? 'partial' : 'full', url: c.url });
    const msgs: Message[] = c.turns.map((t, i) => ({
      id: `tk:${c.key}:${t.ts}:${t.role === 'user' ? 'u' : 'a'}`,
      sessionId, seq: i, role: t.role, text: redact(t.text), ts: t.ts, capturedAt,
    }));
    newMessages += db.insertMessages(msgs);
  }
  return { sessions: picked.length, newMessages };
}
