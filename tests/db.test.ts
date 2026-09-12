import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';

const msg = (id: string, seq: number) => ({
  id, sessionId: 's1', seq, role: 'user' as const, text: `第 ${seq} 条`, ts: '2026-09-10T10:00:00+08:00', capturedAt: '2026-09-13T00:00:00+08:00',
});

function seed() {
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: '记账小程序', goal: '记账', dirs: ['/code/ledger'] });
  db.upsertSession({ id: 's1', source: 'claude_code', label: 'Claude Code', projectId, cwd: '/code/ledger', title: null, coverage: 'full' });
  return { db, projectId };
}

test('同一条消息按来源编号写两次，只留一行', () => {
  const { db, projectId } = seed();
  assert.equal(db.insertMessages([msg('cc:a', 1), msg('cc:b', 2)]), 2);
  assert.equal(db.insertMessages([msg('cc:a', 1), msg('cc:b', 2)]), 0);
  assert.equal(db.messagesForProject(projectId).length, 2);
});

test('目录归属：子目录算同一个项目，别的目录不算', () => {
  const { db, projectId } = seed();
  assert.equal(db.projectForDir('/code/ledger'), projectId);
  assert.equal(db.projectForDir('/code/ledger/web'), projectId);
  assert.equal(db.projectForDir('/code/ledger-web'), null);
});

test('同名项目不会自动合并', () => {
  const { db } = seed();
  const other = db.createProject({ name: '记账小程序', goal: null, dirs: ['/code/other'] });
  assert.equal(db.listProjects().length, 2);
  assert.equal(db.projectForDir('/code/other'), other);
});

test('删除项目后，所有关联数据都清掉', () => {
  const { db, projectId } = seed();
  db.insertMessages([msg('cc:a', 1)]);
  const taskId = db.addTask({ projectId, name: '记账录入', goal: null, createdAt: '2026-09-10T10:00:00+08:00' });
  db.addEvidence([{ id: 'e1', projectId, taskId, kind: 'started', cite: ['cc:a'], speaker: 'user', detail: '开始', reason: null, at: '2026-09-10T10:00:00+08:00', order: 1, downgraded: null, model: 'm', promptVersion: 'p' }]);
  db.addCorrection(projectId, { type: 'rename', taskId, name: '录入' });
  db.deleteProject(projectId);
  assert.deepEqual(db.counts(), { projects: 0, sessions: 0, messages: 0, tasks: 0, evidence: 0, corrections: 0 });
});
