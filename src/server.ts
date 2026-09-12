// 本地网页服务。只监听 127.0.0.1。
import http from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { z } from 'zod';
import type { Db } from './db.ts';
import type { StoredEvidence } from './contracts.ts';
import { buildProjectView } from './engine/view.ts';
import { buildContext } from './engine/context.ts';
import { syncClaudeCode, type SyncResult } from './ingest/claude-code.ts';
import { syncCodex } from './ingest/codex.ts';
import { importText } from './ingest/paste.ts';
import { extractProject } from './extract/run.ts';
import { deepseek } from './extract/model.ts';

const WEB = new URL('../web/', import.meta.url);
const STATIC: Record<string, string> = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
const TYPES: Record<string, string> = { html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8' };

const Status = z.enum(['pending_confirm', 'todo', 'doing', 'to_verify', 'done', 'blocked', 'cancelled']);
const Name = z.string().trim().min(1).max(60);
const CorrectionBody = z.discriminatedUnion('type', [
  z.object({ type: z.literal('rename'), taskId: z.string(), name: Name }),
  z.object({ type: z.literal('merge'), from: z.string(), into: z.string() }),
  z.object({ type: z.literal('set_status'), taskId: z.string(), status: Status, note: z.string().max(200).optional() }),
  z.object({ type: z.literal('assign'), evidenceId: z.string(), taskId: z.string() }),
  z.object({ type: z.literal('confirm_condition'), taskId: z.string(), condition: z.string().trim().min(1).max(300) }),
  z.object({ type: z.literal('dismiss_next'), key: z.string() }),
  z.object({ type: z.literal('ack'), evidenceId: z.string() }),
  z.object({ type: z.literal('set_role'), messageId: z.string(), role: z.enum(['user', 'assistant']) }),
  z.object({ type: z.literal('backfill_plan'), taskIds: z.array(z.string()).default([]), names: z.array(Name).max(30).default([]) }),
  z.object({ type: z.literal('new_task'), name: Name, evidenceId: z.string().optional() }),
]);
const ImportBody = z.object({ text: z.string().min(1).max(2_000_000), label: Name, title: Name, partial: z.boolean().default(false), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal('')) });
const ProjectBody = z.object({ name: Name, goal: z.string().trim().max(300).optional(), dirs: z.array(z.string().trim().min(1)).max(20).default([]) });

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 5_000_000) throw new HttpError(413, '内容太大');
    chunks.push(c as Buffer);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { throw new HttpError(400, '请求内容不是合法的 JSON'); }
}

function parse<T>(schema: z.ZodType<T>, data: unknown): T {
  const r = schema.safeParse(data);
  if (!r.success) throw new HttpError(400, `请求内容不对：${r.error.issues[0]?.path.join('.')} ${r.error.issues[0]?.message}`);
  return r.data;
}

export function serve(db: Db, port: number) {
  let lastSync: { at: string; cc: SyncResult; cx: SyncResult } | null = null;
  let syncing = false;
  const model = deepseek();

  const ownTask = (projectId: string, taskId: string) => {
    if (!taskId.startsWith(`${projectId}/`)) throw new HttpError(400, '任务不属于这个项目');
    return taskId;
  };
  const ownEvidence = (projectId: string, evidenceId: string) => {
    if (!db.evidenceForProject(projectId).some((e) => e.id === evidenceId)) throw new HttpError(400, '证据不属于这个项目');
    return evidenceId;
  };
  const project = (id: string) => {
    const p = db.getProject(id);
    if (!p) throw new HttpError(404, '项目不存在，可能已被删除');
    return p;
  };

  async function route(req: http.IncomingMessage, res: http.ServerResponse) {
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const method = req.method ?? 'GET';
    // 防 DNS 重绑定：只接受本机地址访问
    if (!/^(127\.0\.0\.1|localhost):\d+$/.test(req.headers.host ?? '')) throw new HttpError(403, '只允许本机访问');
    // 防跨站请求：写操作必须带自定义请求头（浏览器跨站发不出这个头）
    if (method !== 'GET' && req.headers['x-corpus'] !== '1') throw new HttpError(403, '缺少请求头');

    if (method === 'GET' && STATIC[url.pathname]) {
      const file = STATIC[url.pathname];
      res.writeHead(200, { 'content-type': TYPES[file.split('.').pop()!], 'cache-control': 'no-store' });
      res.end(readFileSync(new URL(file, WEB)));
      return;
    }

    const parts = url.pathname.split('/').filter(Boolean).map(decodeURIComponent); // ['api', 'projects', id, ...]
    if (parts[0] !== 'api') throw new HttpError(404, '找不到这个地址');

    if (method === 'GET' && parts[1] === 'state') {
      const projects = db.listProjects().map((p) => {
        const v = buildProjectView(db, p.id);
        return { ...p, counts: v.counts, pending: v.pending.length };
      });
      return send(res, 200, { projects, model: model.name, lastSyncAt: lastSync?.at ?? null });
    }

    if (method === 'GET' && parts[1] === 'sources') {
      const count = (sql: string, ...a: string[]) => Number((db.raw.prepare(sql).get(...a) as { c: number }).c);
      const src = (s: string) => ({
        sessions: count('SELECT COUNT(*) AS c FROM sessions WHERE source = ? AND project_id IS NOT NULL', s),
        messages: count('SELECT COUNT(*) AS c FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.source = ?', s),
      });
      const skipped: Record<string, number> = {};
      for (const r of [lastSync?.cc, lastSync?.cx]) for (const [k, n] of Object.entries(r?.skippedDirs ?? {})) skipped[k] = (skipped[k] ?? 0) + n;
      return send(res, 200, {
        claudeCode: { installed: existsSync(join(homedir(), '.claude', 'projects')), ...src('claude_code') },
        codex: { installed: existsSync(join(homedir(), '.codex', 'sessions')), ...src('codex') },
        imports: src('import'),
        lastSyncAt: lastSync?.at ?? null,
        badLines: (lastSync?.cc.badLines ?? 0) + (lastSync?.cx.badLines ?? 0),
        skippedDirs: Object.entries(skipped).sort((a, b) => b[1] - a[1]).slice(0, 12),
        model: model.name,
      });
    }

    if (parts[1] !== 'projects') throw new HttpError(404, '找不到这个地址');

    if (method === 'POST' && parts.length === 2) {
      const b = parse(ProjectBody, await readJson(req));
      const id = db.createProject({ name: b.name, goal: b.goal || null, dirs: b.dirs });
      return send(res, 201, { id });
    }

    const id = parts[2];
    const p = project(id);

    if (method === 'DELETE' && parts.length === 3) {
      db.deleteProject(id);
      return send(res, 200, { ok: true });
    }

    if (method === 'GET' && parts.length === 3) {
      const view = buildProjectView(db, id);
      const evidence: Record<string, Pick<StoredEvidence, 'cite' | 'kind' | 'detail' | 'speaker' | 'reason' | 'at'>> = {};
      for (const e of db.evidenceForProject(id)) evidence[e.id] = { cite: e.cite, kind: e.kind, detail: e.detail, speaker: e.speaker, reason: e.reason, at: e.at };
      const sessions = db.sessionsForProject(id).map((s) => ({ id: s.id, label: s.label, title: s.title, coverage: s.coverage, source: s.source, messages: db.messagesForSession(s.id).length }));
      db.logUsage(id, 'open_project');
      return send(res, 200, { project: p, view, evidence, sessions, failed: db.failedBatches(id), allTasks: db.tasksForProject(id).map((t) => ({ id: t.id, name: t.name })) });
    }

    if (method === 'GET' && parts[3] === 'messages') {
      // 只返回当前项目的消息（安全评审：之前是全局接口，知道编号就能跨项目读原文）
      const ids = (url.searchParams.get('ids') ?? '').split(',').filter(Boolean).slice(0, 50);
      const msgs = db.messagesByIds(ids, id).map((m) => {
        const s = db.getSession(m.sessionId);
        return { ...m, session: s && { label: s.label, title: s.title, coverage: s.coverage, source: s.source } };
      });
      return send(res, 200, msgs);
    }

    if (method === 'GET' && parts[3] === 'context') {
      const taskId = ownTask(id, url.searchParams.get('task') ?? '');
      db.logUsage(id, 'context_view');
      return send(res, 200, { text: buildContext(db, id, taskId) });
    }

    if (method === 'POST' && parts[3] === 'usage') {
      const b = parse(z.object({ kind: z.enum(['context_copy', 'next_accept', 'next_later']) }), await readJson(req));
      db.logUsage(id, b.kind);
      return send(res, 200, { ok: true });
    }

    if (method === 'POST' && parts[3] === 'dirs') {
      const b = parse(z.object({ dir: z.string().trim().min(1) }), await readJson(req));
      db.addProjectDir(id, b.dir);
      return send(res, 200, { ok: true });
    }

    if (method === 'POST' && parts[3] === 'import') {
      const b = parse(ImportBody, await readJson(req));
      const r = importText(db, { projectId: id, text: b.text, label: b.label, title: b.title, coverage: b.partial ? 'partial' : 'full', date: b.date || undefined });
      return send(res, 200, r);
    }

    if (method === 'POST' && parts[3] === 'consent') {
      db.setRemoteOk(id, true);
      return send(res, 200, { ok: true });
    }

    if (method === 'POST' && parts[3] === 'pause') {
      const b = parse(z.object({ paused: z.boolean() }), await readJson(req));
      db.setPaused(id, b.paused);
      return send(res, 200, { ok: true });
    }

    if (method === 'GET' && parts[3] === 'usage') {
      return send(res, 200, db.usageSummary(id));
    }

    if (method === 'POST' && parts[3] === 'sync') {
      // 需求：启用远程整理前说明会发送什么，得到同意再发
      if (!p.remoteOk) throw new HttpError(428, `整理会把这个项目的对话正文发送到远程模型 ${model.name}。请先确认。`);
      if (syncing) throw new HttpError(409, '正在同步，请稍等');
      syncing = true;
      try {
        const cc = syncClaudeCode(db);
        const cx = syncCodex(db);
        lastSync = { at: new Date().toISOString(), cc, cx };
        db.logUsage(id, 'sync');
        const r = await extractProject(db, id, model);
        return send(res, 200, { newMessages: cc.newMessages + cx.newMessages, badLines: cc.badLines + cx.badLines, ...r });
      } finally {
        syncing = false;
      }
    }

    if (method === 'POST' && parts[3] === 'corrections') {
      const c = parse(CorrectionBody, await readJson(req));
      db.logUsage(id, `correction_${c.type}`);
      switch (c.type) {
        case 'new_task': {
          if (c.evidenceId) ownEvidence(id, c.evidenceId);
          const taskId = db.addTask({ projectId: id, name: c.name, goal: null, createdAt: new Date().toISOString() });
          if (c.evidenceId) db.addCorrection(id, { type: 'assign', evidenceId: c.evidenceId, taskId });
          db.addCorrection(id, { type: 'set_status', taskId, status: 'todo', note: '你手动建的任务' });
          return send(res, 200, { taskId });
        }
        case 'set_role': {
          if (!db.messagesForProject(id).some((m) => m.id === c.messageId)) throw new HttpError(400, '消息不属于这个项目');
          db.setMessageRole(id, c.messageId, c.role);
          return send(res, 200, { ok: true });
        }
        case 'backfill_plan': {
          const ids = [...c.taskIds.map((t) => ownTask(id, t)), ...c.names.map((name) => db.addTask({ projectId: id, name, goal: null, createdAt: new Date().toISOString() }))];
          if (ids.length === 0) throw new HttpError(400, '后补规划至少要有一项');
          db.addCorrection(id, { type: 'backfill_plan', taskIds: ids });
          return send(res, 200, { ok: true });
        }
        case 'rename': case 'set_status': case 'confirm_condition':
          ownTask(id, c.taskId);
          break;
        case 'merge':
          ownTask(id, c.from); ownTask(id, c.into);
          if (c.from === c.into) throw new HttpError(400, '不能合并到自己');
          break;
        case 'assign':
          ownTask(id, c.taskId);
          ownEvidence(id, c.evidenceId);
          break;
        case 'ack':
          ownEvidence(id, c.evidenceId);
          break;
      }
      db.addCorrection(id, c as never);
      return send(res, 200, { ok: true });
    }

    throw new HttpError(404, '找不到这个地址');
  }

  const server = http.createServer((req, res) => {
    route(req, res).catch((e) => {
      if (e instanceof HttpError) return send(res, e.status, { error: e.message });
      console.error(e);
      send(res, 500, { error: `服务出错：${(e as Error).message}` });
    });
  });
  server.requestTimeout = 15 * 60_000; // 整理一次可能要几分钟
  server.listen(port, '127.0.0.1', () => console.log(`Working Corpus 已打开：http://127.0.0.1:${port}`));
  return server;
}
