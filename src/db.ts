// 数据库访问。所有 SQL 都在这里，其他模块不直接写 SQL。
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, mkdirSync } from 'node:fs';
import { dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { Message, Session, StoredEvidence, TaskRecord, Correction, CorrectionRecord, Role } from './contracts.ts';

const SCHEMA = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');

const now = () => new Date().toISOString();
const shortId = (prefix: string) => `${prefix}${randomUUID().slice(0, 8)}`;

type Row = Record<string, unknown>;

export type Db = ReturnType<typeof openDb>;

export function openDb(path: string) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(SCHEMA);

  const all = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).all(...args) as Row[];
  const get = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).get(...args) as Row | undefined;
  const run = (sql: string, ...args: (string | number | null)[]) => db.prepare(sql).run(...args);

  const toSession = (r: Row): Session & { file: string | null; cursor: number; extractedUpto: number } => ({
    id: r.id as string, source: r.source as Session['source'], label: r.label as string,
    projectId: (r.project_id as string) ?? null, cwd: (r.cwd as string) ?? null, title: (r.title as string) ?? null,
    coverage: r.coverage as Session['coverage'], file: (r.file as string) ?? null,
    cursor: Number(r.cursor), extractedUpto: Number(r.extracted_upto),
  });
  const toMessage = (r: Row): Message => ({
    id: r.id as string, sessionId: r.session_id as string, seq: Number(r.seq), role: r.role as Role,
    text: r.text as string, ts: (r.ts as string) ?? null, capturedAt: r.captured_at as string,
  });
  const toEvidence = (r: Row): StoredEvidence => ({
    id: r.id as string, projectId: r.project_id as string, taskId: r.task_id as string,
    kind: r.kind as StoredEvidence['kind'], cite: JSON.parse(r.cite as string), speaker: r.speaker as Role,
    detail: r.detail as string, reason: (r.reason as string) ?? null, at: r.at as string, order: Number(r.ord),
    downgraded: (r.downgraded as string) ?? null, model: r.model as string, promptVersion: r.prompt_version as string,
  });

  const tx = <T>(fn: () => T): T => {
    db.exec('BEGIN');
    try { const out = fn(); db.exec('COMMIT'); return out; } catch (e) { db.exec('ROLLBACK'); throw e; }
  };

  return {
    raw: db,
    tx,

    createProject(p: { name: string; goal: string | null; dirs: string[] }): string {
      const id = shortId('p_');
      tx(() => {
        run('INSERT INTO projects (id, name, goal, created_at) VALUES (?, ?, ?, ?)', id, p.name, p.goal, now());
        for (const dir of p.dirs) run('INSERT OR IGNORE INTO project_dirs (project_id, dir) VALUES (?, ?)', id, dir);
      });
      return id;
    },
    addProjectDir(projectId: string, dir: string) {
      run('INSERT OR IGNORE INTO project_dirs (project_id, dir) VALUES (?, ?)', projectId, dir);
    },
    listProjects() {
      return all('SELECT id, name, goal, created_at FROM projects ORDER BY created_at').map((r) => ({
        id: r.id as string, name: r.name as string, goal: (r.goal as string) ?? null,
        dirs: all('SELECT dir FROM project_dirs WHERE project_id = ?', r.id as string).map((d) => d.dir as string),
      }));
    },
    getProject(id: string) {
      return this.listProjects().find((p) => p.id === id) ?? null;
    },
    /** 目录本身或它的子目录绑定到哪个项目。取最长匹配。 */
    projectForDir(dir: string): string | null {
      const rows = all('SELECT project_id, dir FROM project_dirs');
      const hit = rows
        .filter((r) => dir === r.dir || dir.startsWith((r.dir as string).replace(/\/$/, '') + sep))
        .sort((a, b) => (b.dir as string).length - (a.dir as string).length)[0];
      return hit ? (hit.project_id as string) : null;
    },
    deleteProject(id: string) {
      tx(() => {
        run('DELETE FROM evidence WHERE project_id = ?', id); // 显式删，和级联结果一致
        run('DELETE FROM projects WHERE id = ?', id);
      });
    },

    upsertSession(s: Session & { file?: string | null }) {
      run(
        `INSERT INTO sessions (id, source, label, project_id, cwd, title, coverage, file) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET label = excluded.label, cwd = excluded.cwd,
           title = COALESCE(excluded.title, sessions.title), coverage = excluded.coverage, file = COALESCE(excluded.file, sessions.file),
           project_id = COALESCE(sessions.project_id, excluded.project_id)`,
        s.id, s.source, s.label, s.projectId, s.cwd, s.title, s.coverage, s.file ?? null,
      );
    },
    getSession(id: string) {
      const r = get('SELECT * FROM sessions WHERE id = ?', id);
      return r ? toSession(r) : null;
    },
    sessionsForProject(projectId: string) {
      return all('SELECT * FROM sessions WHERE project_id = ?', projectId).map(toSession);
    },
    unassignedSessions() {
      return all('SELECT * FROM sessions WHERE project_id IS NULL').map(toSession);
    },
    assignSession(sessionId: string, projectId: string) {
      run('UPDATE sessions SET project_id = ? WHERE id = ?', projectId, sessionId);
    },
    setCursor(sessionId: string, cursor: number) {
      run('UPDATE sessions SET cursor = ? WHERE id = ?', cursor, sessionId);
    },
    setExtractedUpto(sessionId: string, seq: number) {
      run('UPDATE sessions SET extracted_upto = ? WHERE id = ?', seq, sessionId);
    },

    /** 按来源编号去重写入，返回新增条数。 */
    insertMessages(msgs: Message[]): number {
      const stmt = db.prepare('INSERT OR IGNORE INTO messages (id, session_id, seq, role, text, ts, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
      return tx(() => msgs.reduce((n, m) => n + Number(stmt.run(m.id, m.sessionId, m.seq, m.role, m.text, m.ts, m.capturedAt).changes), 0));
    },
    maxSeq(sessionId: string): number {
      return Number(get('SELECT COALESCE(MAX(seq), -1) AS s FROM messages WHERE session_id = ?', sessionId)?.s ?? -1);
    },
    messagesForSession(sessionId: string, afterSeq = -1) {
      return all('SELECT * FROM messages WHERE session_id = ? AND seq > ? ORDER BY seq', sessionId, afterSeq).map(toMessage);
    },
    messagesForProject(projectId: string) {
      return all(
        'SELECT m.* FROM messages m JOIN sessions s ON s.id = m.session_id WHERE s.project_id = ? ORDER BY COALESCE(m.ts, m.captured_at), m.seq',
        projectId,
      ).map(toMessage);
    },
    messagesByIds(ids: string[]) {
      if (ids.length === 0) return [];
      return all(`SELECT * FROM messages WHERE id IN (${ids.map(() => '?').join(',')})`, ...ids).map(toMessage);
    },

    addTask(t: Omit<TaskRecord, 'id'>): string {
      const n = Number(get('SELECT COUNT(*) AS c FROM tasks WHERE project_id = ?', t.projectId)?.c ?? 0) + 1;
      const id = `${t.projectId}/T${String(n).padStart(2, '0')}`;
      run('INSERT INTO tasks (id, project_id, name, goal, created_at) VALUES (?, ?, ?, ?, ?)', id, t.projectId, t.name, t.goal, t.createdAt);
      return id;
    },
    tasksForProject(projectId: string): TaskRecord[] {
      return all('SELECT * FROM tasks WHERE project_id = ? ORDER BY created_at, id', projectId).map((r) => ({
        id: r.id as string, projectId: r.project_id as string, name: r.name as string, goal: (r.goal as string) ?? null, createdAt: r.created_at as string,
      }));
    },

    addEvidence(list: StoredEvidence[], batchKey: string | null = null) {
      const stmt = db.prepare(
        `INSERT INTO evidence (id, project_id, task_id, kind, cite, speaker, detail, reason, at, ord, downgraded, model, prompt_version, batch_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      tx(() => {
        for (const e of list) {
          stmt.run(e.id, e.projectId, e.taskId, e.kind, JSON.stringify(e.cite), e.speaker, e.detail, e.reason, e.at, e.order, e.downgraded, e.model, e.promptVersion, batchKey);
        }
      });
    },
    evidenceForProject(projectId: string): StoredEvidence[] {
      return all('SELECT * FROM evidence WHERE project_id = ? ORDER BY at, ord', projectId).map(toEvidence);
    },

    batchDone(key: string) {
      return get("SELECT status FROM batches WHERE key = ? AND status = 'ok'", key) !== undefined;
    },
    recordBatch(b: { key: string; projectId: string; sessionId: string; uptoSeq: number; status: 'ok' | 'failed'; error?: string }) {
      run(
        `INSERT INTO batches (key, project_id, session_id, upto_seq, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET status = excluded.status, error = excluded.error`,
        b.key, b.projectId, b.sessionId, b.uptoSeq, b.status, b.error ?? null, now(),
      );
    },
    failedBatches(projectId: string) {
      return all("SELECT key, session_id, error FROM batches WHERE project_id = ? AND status = 'failed'", projectId);
    },

    addCorrection(projectId: string, c: Correction): string {
      const id = shortId('c_');
      run('INSERT INTO corrections (id, project_id, at, body) VALUES (?, ?, ?, ?)', id, projectId, now(), JSON.stringify(c));
      return id;
    },
    correctionsForProject(projectId: string): CorrectionRecord[] {
      return all('SELECT * FROM corrections WHERE project_id = ? ORDER BY at, id', projectId).map((r) => ({
        id: r.id as string, projectId: r.project_id as string, at: r.at as string, correction: JSON.parse(r.body as string),
      }));
    },

    logUsage(projectId: string | null, kind: string) {
      run('INSERT INTO usage_events (project_id, kind, at) VALUES (?, ?, ?)', projectId, kind, now());
    },

    counts() {
      const c = (t: string) => Number(get(`SELECT COUNT(*) AS c FROM ${t}`)?.c ?? 0);
      return { projects: c('projects'), sessions: c('sessions'), messages: c('messages'), tasks: c('tasks'), evidence: c('evidence'), corrections: c('corrections') };
    },
  };
}
