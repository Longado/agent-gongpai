// 第 14 轮：新决定推翻旧决定时，旧的标为“已被替代”。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import type { Evidence, Message } from '../src/contracts.ts';
import { storeEvidence } from '../src/extract/validate.ts';
import { buildProjectView } from '../src/engine/view.ts';
import { buildContext } from '../src/engine/context.ts';

function scene() {
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: 'p', goal: null, dirs: [] });
  db.upsertSession({ id: 's1', source: 'claude_code', label: 'Claude Code', projectId, cwd: null, title: null, coverage: 'full' });
  const msg = (ref: string, role: Message['role'], text: string, h: number): Message => ({ id: `s1:${ref}`, sessionId: 's1', seq: h, role, text, ts: `2026-09-10T1${h}:00:00+08:00`, capturedAt: 'x' });
  const all = [msg('m1', 'user', '用 SQLite', 0), msg('m2', 'user', '做存储层', 1), msg('m3', 'user', '改用 Postgres', 2)];
  db.insertMessages(all);
  const refs = (...ms: Message[]) => new Map(ms.map((m, i) => [`m${i + 1}`, m]));
  const ev = (kind: Evidence['kind'], cite: string[], detail: string, extra: Partial<Evidence> = {}): Evidence => ({ reasoning: 'r', task: 'none', kind, cite, detail, ...extra });
  return { db, projectId, all, refs, ev, view: () => buildProjectView(db, projectId) };
}

test('同一批里：新决定引用旧决定的消息，旧的标为已被替代', () => {
  const s = scene();
  s.db; storeEvidence(s.db, s.projectId, [
    s.ev('decision_adopt', ['m1'], '用 SQLite'),
    s.ev('decision_adopt', ['m3'], '改用 Postgres', { replaces: ['m1'] }),
  ], s.refs(s.all[0], s.all[1], s.all[2]), { model: 't', promptVersion: 't' });
  const d = s.view().decisions;
  assert.equal(d.find((x) => x.text.includes('SQLite'))?.supersededBy, d.find((x) => x.text.includes('Postgres'))?.evidenceId);
  assert.equal(d.find((x) => x.text.includes('Postgres'))?.supersededBy, null);
});

test('跨批次：新决定用提示词里的决定编号指回旧决定', () => {
  const s = scene();
  const first = storeEvidence(s.db, s.projectId, [s.ev('decision_adopt', ['m1'], '用 SQLite')], s.refs(s.all[0]), { model: 't', promptVersion: 't' });
  storeEvidence(s.db, s.projectId, [s.ev('decision_adopt', ['m1'], '改用 Postgres', { replaces: ['D1', 'D9'] })], s.refs(s.all[2]),
    { model: 't', promptVersion: 't', decisionRefs: new Map([['D1', first.stored[0].id]]) });
  const d = s.view().decisions;
  assert.ok(d.find((x) => x.text.includes('SQLite'))?.supersededBy);
});

test('续接上下文不带已被替代的决定', () => {
  const s = scene();
  storeEvidence(s.db, s.projectId, [
    { reasoning: 'r', task: { newName: '存储层' }, kind: 'started', cite: ['m2'], detail: '做存储层' },
    s.ev('decision_adopt', ['m1'], '用 SQLite'),
    s.ev('decision_adopt', ['m3'], '改用 Postgres', { replaces: ['m1'] }),
  ], s.refs(s.all[0], s.all[1], s.all[2]), { model: 't', promptVersion: 't' });
  const ctx = buildContext(s.db, s.projectId, s.view().tasks[0].id);
  assert.match(ctx, /Postgres/);
  assert.doesNotMatch(ctx, /用 SQLite/);
});
