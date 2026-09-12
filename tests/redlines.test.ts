// 记忆引擎的硬红线，每条单独钉住。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import type { Evidence, Message, Role } from '../src/contracts.ts';
import { storeEvidence } from '../src/extract/validate.ts';
import { buildProjectView } from '../src/engine/view.ts';
import { buildContext } from '../src/engine/context.ts';

type Line = [ref: string, role: Role, text: string, ts: string];
const T = (d: number, h = 10) => `2026-09-${String(d).padStart(2, '0')}T${String(h).padStart(2, '0')}:00:00+08:00`;

function scene(lines: Line[]) {
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: '记账小程序', goal: '做一个记账小程序', dirs: [] });
  db.upsertSession({ id: 's1', source: 'claude_code', label: 'Claude Code', projectId, cwd: null, title: null, coverage: 'full' });
  const refs = new Map<string, Message>();
  lines.forEach(([ref, role, text, ts], i) => refs.set(ref, { id: `s1:${ref}`, sessionId: 's1', seq: i, role, text, ts, capturedAt: ts }));
  db.insertMessages([...refs.values()]);
  const add = (ev: Evidence[]) => storeEvidence(db, projectId, ev, refs, { model: 't', promptVersion: 't' });
  const view = () => buildProjectView(db, projectId);
  const task = (name: string) => view().tasks.find((t) => t.name === name);
  return { db, projectId, refs, add, view, task };
}
const ev = (task: Evidence['task'], kind: Evidence['kind'], cite: string[], detail = '', reason?: string): Evidence => ({ reasoning: 'r', task, kind, cite, detail, ...(reason ? { reason } : {}) });

test('只引用 AI 消息的“用户确认完成”降级为 AI 自述：待验证，不计完成', () => {
  const s = scene([['m1', 'user', '做导出', T(10)], ['m2', 'assistant', '导出做完了，用户可以用了', T(10, 11)]]);
  s.add([ev({ newName: '导出' }, 'started', ['m1']), ev({ newName: '导出' }, 'user_confirms_done', ['m2'])]);
  assert.equal(s.task('导出')?.status, 'to_verify');
  assert.equal(s.view().doneEvents.length, 0);
});

test('只有 AI 提出的规划不进入范围，进待确认的建议区', () => {
  const s = scene([['m1', 'assistant', '建议加预算提醒', T(10)]]);
  s.add([ev({ newName: '预算提醒' }, 'plan_add', ['m1'])]);
  const v = s.view();
  assert.equal(v.tasks.length, 0);
  assert.equal(v.plan.noPlan, true);
  assert.equal(v.pending.filter((p) => p.kind === 'ai_suggestion').length, 1);
});

test('取消一个从没进入范围的事项：不新建任务，记成否决', () => {
  const s = scene([['m1', 'assistant', '建议加预算提醒', T(10)], ['m2', 'user', '预算提醒先不要', T(10, 11)]]);
  s.add([ev({ newName: '预算提醒' }, 'plan_add', ['m1']), ev({ newName: '预算提醒' }, 'plan_cancel', ['m2'])]);
  const v = s.view();
  assert.equal(v.tasks.length, 0);
  assert.equal(v.decisions.some((d) => d.kind === 'reject' && d.text.includes('预算提醒')), true);
});

test('完成后又失败：重开原任务，不新增任务，完成事件只记之前那一次', () => {
  const s = scene([['m1', 'user', '做导出', T(10)], ['m2', 'user', '导出可以用了', T(10, 11)], ['m3', 'user', '导出又打不开了', T(11)]]);
  s.add([ev({ newName: '导出' }, 'started', ['m1']), ev({ newName: '导出' }, 'user_confirms_done', ['m2']), ev({ newName: '导出' }, 'failure', ['m3'], '打不开')]);
  const v = s.view();
  assert.equal(v.tasks.length, 1);
  assert.equal(v.tasks[0].status, 'doing');
  assert.equal(v.doneEvents.length, 1);
  assert.ok(v.tasks[0].history.some((h) => h.from === 'done' && h.to === 'doing'));
});

test('人工改过状态后，更晚的证据不直接覆盖，进待确认；更早的证据不影响修正', () => {
  const LATER = '2099-01-01T00:00:00+08:00'; // 一定晚于修正发生的时间
  const s = scene([['m1', 'user', '做图表页', T(10)], ['m2', 'user', '图表页开始写了', T(10, 11)], ['m3', 'user', '设计稿还没给', LATER]]);
  s.add([ev({ newName: '图表页' }, 'started', ['m1'])]);
  const id = s.task('图表页')!.id;
  s.db.addCorrection(s.projectId, { type: 'set_status', taskId: id, status: 'done' });
  s.add([ev({ id }, 'started', ['m2'])]); // 早于修正：照常折叠，但修正在它之后，仍然生效
  assert.equal(s.task('图表页')?.status, 'done');
  assert.equal(s.view().pending.filter((p) => p.kind === 'conflict').length, 0);
  s.add([ev({ id }, 'blocked', ['m3'], '缺设计稿')]); // 晚于修正：进待确认
  const v = s.view();
  assert.equal(v.tasks[0].status, 'done');
  assert.equal(v.tasks[0].basis, 'manual');
  assert.equal(v.pending.filter((p) => p.kind === 'conflict').length, 1);
});

test('合并两个任务：只剩一个，会话合在一起', () => {
  const s = scene([['m1', 'user', '实现登录', T(9)], ['m2', 'user', '修复登录错误', T(10)]]);
  s.add([ev({ newName: '实现登录' }, 'started', ['m1']), ev({ newName: '修复登录错误' }, 'failure', ['m2'])]);
  const [a, b] = s.view().tasks;
  s.db.addCorrection(s.projectId, { type: 'merge', from: b.id, into: a.id });
  const v = s.view();
  assert.equal(v.tasks.length, 1);
  assert.equal(v.tasks[0].status, 'doing');
});

test('引用不存在的消息，整条证据丢弃', () => {
  const s = scene([['m1', 'user', '做导出', T(10)]]);
  const r = s.add([ev({ newName: '导出' }, 'started', ['m9'])]);
  assert.equal(r.stored.length, 0);
  assert.equal(r.dropped.length, 1);
  assert.equal(s.view().tasks.length, 0);
});

test('受阻的任务不占下一步；只剩受阻时才建议解除阻塞', () => {
  const s = scene([['m1', 'user', '做视频', T(10)], ['m2', 'user', '缺视频接口凭证', T(10, 11)], ['m3', 'user', '做海报', T(10, 12)], ['m4', 'assistant', '海报做好了', T(10, 13)]]);
  s.add([ev({ newName: '视频' }, 'started', ['m1']), ev({ newName: '视频' }, 'blocked', ['m2'], '缺视频接口凭证'), ev({ newName: '海报' }, 'started', ['m3']), ev({ newName: '海报' }, 'ai_claims_done', ['m4'])]);
  const next = s.view().next;
  assert.match(next[0].action, /验证「海报」/);
  assert.ok(next.every((n) => !n.action.includes('视频')));
  assert.equal(s.task('视频')?.blocker, '缺视频接口凭证');
});

test('驳回的下一步不再推荐，直到这个任务出现新证据', () => {
  const s = scene([['m1', 'user', '做导出', T(10)], ['m2', 'assistant', '导出好了', T(10, 11)], ['m3', 'assistant', '又改了一版导出', '2099-01-01T00:00:00+08:00']]);
  s.add([ev({ newName: '导出' }, 'started', ['m1']), ev({ newName: '导出' }, 'ai_claims_done', ['m2'])]);
  const key = s.view().next[0].key;
  s.db.addCorrection(s.projectId, { type: 'dismiss_next', key });
  assert.equal(s.view().next.length, 0);
  s.add([ev({ newName: '导出' }, 'ai_claims_done', ['m3'])]);
  assert.equal(s.view().next.length, 1);
});

test('续接上下文：“本轮请做”不含已取消的事项，已取消的列在“不要做”', () => {
  const s = scene([['m1', 'user', '规划：导出、分享海报', T(8)], ['m2', 'user', '分享海报不做了', T(9)], ['m3', 'user', '开始做导出', T(10)]]);
  s.add([
    ev({ newName: '导出' }, 'plan_item', ['m1']), ev({ newName: '分享海报' }, 'plan_item', ['m1']),
    ev({ newName: '分享海报' }, 'plan_cancel', ['m2'], '不做了'), ev({ newName: '导出' }, 'started', ['m3']),
  ]);
  const ctx = buildContext(s.db, s.projectId, s.task('导出')!.id);
  const thisRound = ctx.split('\n').find((l) => l.startsWith('本轮请做'))!;
  const doNot = ctx.split('\n').find((l) => l.startsWith('不要做'))!;
  assert.ok(!thisRound.includes('海报'));
  assert.ok(doNot.includes('分享海报'));
});

test('改正发言者之后，证据按新的发言者重新判断', () => {
  const s = scene([['m1', 'user', '做导出', T(10)], ['m2', 'assistant', '导出可以用了', T(10, 11)]]);
  s.add([ev({ newName: '导出' }, 'started', ['m1']), ev({ newName: '导出' }, 'user_confirms_done', ['m2'])]);
  assert.equal(s.task('导出')?.status, 'to_verify');
  s.db.setMessageRole(s.projectId, 's1:m2', 'user');
  assert.equal(s.task('导出')?.status, 'done');
});

test('没有规划时，续接上下文写明没有找到，不编造', () => {
  const s = scene([['m1', 'user', '做首页', T(10)]]);
  s.add([ev({ newName: '首页' }, 'started', ['m1'])]);
  assert.match(buildContext(s.db, s.projectId, s.task('首页')!.id), /已读取的记录里没有明确规划/);
});
