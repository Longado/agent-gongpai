import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import type { Evidence, Message } from '../src/contracts.ts';
import { storeEvidence } from '../src/extract/validate.ts';
import { buildProjectView } from '../src/engine/view.ts';

function scene() {
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: 'p', goal: null, dirs: [] });
  db.upsertSession({ id: 's1', source: 'claude_code', label: 'Claude Code', projectId, cwd: null, title: null, coverage: 'full' });
  const lines: [string, Message['role'], string, string][] = [
    ['m1', 'user', '做图表页', '2026-09-10T10:00:00+08:00'],
    ['m2', 'user', '设计稿还没给', '2099-01-01T00:00:00+08:00'],
    ['m3', 'assistant', '建议加预算提醒', '2026-09-10T11:00:00+08:00'],
  ];
  const refs = new Map<string, Message>();
  lines.forEach(([ref, role, text, ts], i) => refs.set(ref, { id: `s1:${ref}`, sessionId: 's1', seq: i, role, text, ts, capturedAt: ts }));
  db.insertMessages([...refs.values()]);
  const add = (ev: Evidence[]) => storeEvidence(db, projectId, ev, refs, { model: 't', promptVersion: 't' });
  return { db, projectId, add, view: () => buildProjectView(db, projectId) };
}

test('冲突提示写明新证据指向的状态；处理过的待确认不再出现', () => {
  const s = scene();
  s.add([{ reasoning: 'r', task: { newName: '图表页' }, kind: 'started', cite: ['m1'], detail: '做图表页' }]);
  const id = s.view().tasks[0].id;
  s.db.addCorrection(s.projectId, { type: 'set_status', taskId: id, status: 'done' });
  s.add([{ reasoning: 'r', task: { id }, kind: 'blocked', cite: ['m2'], detail: '缺设计稿' }]);
  const conflict = s.view().pending.find((p) => p.kind === 'conflict')!;
  assert.equal(conflict.suggestedStatus, 'blocked');
  s.db.addCorrection(s.projectId, { type: 'ack', evidenceId: conflict.evidenceId });
  assert.equal(s.view().pending.length, 0);
});

test('AI 建议被“纳入”后成为待开始的任务；被忽略后不再出现', () => {
  const s = scene();
  s.add([{ reasoning: 'r', task: { newName: '预算提醒' }, kind: 'plan_add', cite: ['m3'], detail: '建议加预算提醒' }]);
  const sug = s.view().pending.find((p) => p.kind === 'ai_suggestion')!;
  s.db.addCorrection(s.projectId, { type: 'set_status', taskId: sug.taskId!, status: 'todo' });
  s.db.addCorrection(s.projectId, { type: 'ack', evidenceId: sug.evidenceId });
  const v = s.view();
  assert.equal(v.tasks.find((t) => t.name === '预算提醒')?.status, 'todo');
  assert.equal(v.pending.length, 0);
});
