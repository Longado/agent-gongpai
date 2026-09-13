// 第 22 轮：下一步的“前置条件”。由代码从已有数据推出来，不用大模型。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import type { Evidence, Message } from '../src/contracts.ts';
import { storeEvidence } from '../src/extract/validate.ts';
import { buildProjectView } from '../src/engine/view.ts';
import { buildContext } from '../src/engine/context.ts';

function scene(rows: [string, Message['role'], string][], ev: Evidence[]) {
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: 'p', goal: null, dirs: [] });
  db.upsertSession({ id: 's1', source: 'claude_code', label: 'Claude Code', projectId, cwd: null, title: null, coverage: 'full' });
  const refs = new Map<string, Message>();
  rows.forEach(([ref, role, text], i) => refs.set(ref, { id: `s1:${ref}`, sessionId: 's1', seq: i, role, text, ts: `2026-09-10T1${i}:00:00+08:00`, capturedAt: 'x' }));
  db.insertMessages([...refs.values()]);
  storeEvidence(db, projectId, ev, refs, { model: 't', promptVersion: 't' });
  return { db, projectId, view: buildProjectView(db, projectId) };
}
const e = (task: Evidence['task'], kind: Evidence['kind'], cite: string[], detail = ''): Evidence => ({ reasoning: 'r', task, kind, cite, detail });

test('验证类：列出能找到的产出，完成条件没确认时提醒先确认', () => {
  const s = scene([['m1', 'user', '做导出'], ['m2', 'assistant', '导出做好了，文件在 exports/2026-09.csv']],
    [e({ newName: '导出' }, 'started', ['m1']), e({ newName: '导出' }, 'ai_claims_done', ['m2'], 'AI 说做好了')]);
  const p = s.view.next[0].precondition;
  assert.match(p, /exports\/2026-09\.csv/);
  assert.match(p, /完成条件/);
});

test('开始类：规划里排在前面的还没做完，写明先做哪个', () => {
  const s = scene([['m1', 'user', '规划：录入、统计、导出']],
    [e({ newName: '录入' }, 'plan_item', ['m1']), e({ newName: '统计' }, 'plan_item', ['m1']), e({ newName: '导出' }, 'plan_item', ['m1'])]);
  const [first, second] = s.view.next;
  assert.equal(first.precondition, '无');
  assert.match(second.precondition, /录入/);
});

test('继续类：上次失败了，写明先看失败原因；续接上下文里也带上前置条件', () => {
  const s = scene([['m1', 'user', '做导出'], ['m2', 'user', '文件打不开，格式错误']],
    [e({ newName: '导出' }, 'started', ['m1']), e({ newName: '导出' }, 'failure', ['m2'], '文件打不开，格式错误')]);
  assert.match(s.view.next[0].precondition, /格式错误/);
  assert.match(buildContext(s.db, s.projectId, s.view.tasks[0].id), /前置条件：.*格式错误/);
});
