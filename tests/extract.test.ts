// 用假模型测整理流程：分批、重试、去重、编号映射。真模型的效果由 npm run eval 看。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import type { Message } from '../src/contracts.ts';
import { extractProject, buildPrompt } from '../src/extract/run.ts';
import type { ModelCall } from '../src/extract/model.ts';

function setup(n = 2) {
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: '记账小程序', goal: '记账', dirs: [] });
  db.upsertSession({ id: 's1', source: 'claude_code', label: 'Claude Code', projectId, cwd: null, title: '导出', coverage: 'full' });
  const msgs: Message[] = Array.from({ length: n }, (_, i) => ({
    id: `s1:${i}`, sessionId: 's1', seq: i, role: i % 2 ? 'assistant' : 'user', text: i % 2 ? '导出做完了' : '做导出', ts: `2026-09-10T10:0${i % 10}:00+08:00`, capturedAt: 'x',
  }));
  db.insertMessages(msgs);
  return { db, projectId };
}

function fake(replies: string[]): ModelCall & { calls: string[] } {
  const calls: string[] = [];
  return { name: 'fake-1', calls, async call(_s, user) { calls.push(user); return replies[Math.min(calls.length - 1, replies.length - 1)]; } };
}

const ok = JSON.stringify({ evidence: [
  { reasoning: '用户要求', task: { newName: '导出' }, kind: 'started', cite: ['m1'], detail: '做导出' },
  { reasoning: 'AI 说完成', task: { newName: '导出' }, kind: 'ai_claims_done', cite: ['m2'], detail: 'AI 说导出做完了' },
] });

test('整理一次：证据入库，记下模型和提示词版本；重跑不再调用模型', async () => {
  const { db, projectId } = setup();
  const m = fake([ok]);
  const r1 = await extractProject(db, projectId, m);
  assert.equal(r1.stored, 2);
  assert.equal(m.calls.length, 1);
  const e = db.evidenceForProject(projectId);
  assert.equal(e[0].model, 'fake-1');
  assert.match(e[0].promptVersion, /^evidence-v\d+/);
  const r2 = await extractProject(db, projectId, m);
  assert.equal(r2.stored, 0);
  assert.equal(m.calls.length, 1);
});

test('第一次格式不对，带着错误重试一次；成功就入库', async () => {
  const { db, projectId } = setup();
  const m = fake(['这不是 JSON', ok]);
  const r = await extractProject(db, projectId, m);
  assert.equal(m.calls.length, 2);
  assert.match(m.calls[1], /上一次的输出不符合要求/);
  assert.equal(r.stored, 2);
});

test('两次都不对：这一批记为失败，不入库，下次同步会重试', async () => {
  const { db, projectId } = setup();
  const m = fake(['{"evidence": "错"}']);
  const r = await extractProject(db, projectId, m);
  assert.equal(r.failed, 1);
  assert.equal(db.evidenceForProject(projectId).length, 0);
  assert.equal(db.getSession('s1')!.extractedUpto, -1);
  assert.equal(db.failedBatches(projectId).length, 1);
});

test('提示词里已有任务用短编号，模型用短编号回答也能对上', async () => {
  const { db, projectId } = setup();
  await extractProject(db, projectId, fake([ok]));
  db.insertMessages([{ id: 's1:9', sessionId: 's1', seq: 9, role: 'user', text: '导出能用了', ts: '2026-09-11T10:00:00+08:00', capturedAt: 'x' }]);
  const m = fake([JSON.stringify({ evidence: [{ reasoning: '用户确认', task: { id: 'T01' }, kind: 'user_confirms_done', cite: ['m1'], detail: '用户确认导出能用' }] })]);
  await extractProject(db, projectId, m);
  assert.match(m.calls[0], /T01 导出/);
  const last = db.evidenceForProject(projectId).at(-1)!;
  assert.equal(last.taskId, `${projectId}/T01`);
});

test('长对话按批次切开，按时间顺序整理', async () => {
  const { db, projectId } = setup(40);
  const m = fake([JSON.stringify({ evidence: [] })]);
  const r = await extractProject(db, projectId, m, { maxChars: 20 });
  assert.ok(r.batches > 1, `批次 ${r.batches}`);
  assert.equal(db.getSession('s1')!.extractedUpto, 39);
});

test('提示词里标出来源覆盖不完整', () => {
  const { db, projectId } = setup();
  db.raw.prepare("UPDATE sessions SET coverage = 'partial' WHERE id = 's1'").run();
  const { user } = buildPrompt(db, projectId, db.getSession('s1')!, db.messagesForSession('s1'));
  assert.match(user, /覆盖：部分/);
});
