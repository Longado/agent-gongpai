// 第 20 轮：来源冲突。两段都拿不到原始时间的导入对话对同一任务说了相反的话，不能按采集先后定，要摆出来让人定。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import type { Evidence, Message } from '../src/contracts.ts';
import { storeEvidence } from '../src/extract/validate.ts';
import { buildProjectView } from '../src/engine/view.ts';

function scene(tsA: string | null, tsB: string | null) {
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: 'p', goal: null, dirs: [] });
  db.upsertSession({ id: 'a', source: 'import', label: 'Gemini 网页', projectId, cwd: null, title: 'a', coverage: 'full' });
  db.upsertSession({ id: 'b', source: 'import', label: 'ChatGPT 网页', projectId, cwd: null, title: 'b', coverage: 'full' });
  const refs = new Map<string, Message>([
    ['m1', { id: 'a:1', sessionId: 'a', seq: 0, role: 'user', text: '导出做 CSV', ts: tsA, capturedAt: '2026-09-12T10:00:00Z' }],
    ['m2', { id: 'b:1', sessionId: 'b', seq: 0, role: 'user', text: '导出不做 CSV 了，做 Excel', ts: tsB, capturedAt: '2026-09-12T11:00:00Z' }],
  ]);
  db.insertMessages([...refs.values()]);
  const ev = (cite: string, kind: Evidence['kind'], detail: string): Evidence => ({ reasoning: 'r', task: { newName: '导出' }, kind, cite: [cite], detail });
  storeEvidence(db, projectId, [ev('m1', 'plan_item', '做 CSV 导出'), ev('m2', 'plan_cancel', '不做 CSV 导出')], refs, { model: 't', promptVersion: 't' });
  return buildProjectView(db, projectId);
}

test('两份来源都没有原始时间：不按采集先后定，任务保持前一个状态并进待确认', () => {
  const v = scene(null, null);
  assert.equal(v.tasks[0].status, 'todo');
  const c = v.pending.find((p) => p.kind === 'source_conflict');
  assert.ok(c);
  assert.match(c!.text, /Gemini 网页/);
  assert.match(c!.text, /ChatGPT 网页/);
});

test('有原始时间的照常按时间折叠，不算冲突', () => {
  const v = scene('2026-09-10T10:00:00Z', '2026-09-11T10:00:00Z');
  assert.equal(v.tasks[0].status, 'cancelled');
  assert.equal(v.pending.filter((p) => p.kind === 'source_conflict').length, 0);
});
