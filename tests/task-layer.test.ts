// 第 13 轮：拆分任务、结果线索。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import type { Evidence, Message } from '../src/contracts.ts';
import { storeEvidence } from '../src/extract/validate.ts';
import { buildProjectView } from '../src/engine/view.ts';
import { resultHints } from '../src/engine/hints.ts';

function scene() {
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: 'p', goal: null, dirs: [] });
  db.upsertSession({ id: 's1', source: 'claude_code', label: 'Claude Code', projectId, cwd: null, title: null, coverage: 'full' });
  const rows: [string, Message['role'], string][] = [
    ['m1', 'user', '做导出和报表'],
    ['m2', 'assistant', '导出做好了，文件在 exports/2026-09.csv，提交 8a50a58'],
    ['m3', 'user', '报表还没开始，先放着'],
  ];
  const refs = new Map<string, Message>();
  rows.forEach(([ref, role, text], i) => refs.set(ref, { id: `s1:${ref}`, sessionId: 's1', seq: i, role, text, ts: `2026-09-10T1${i}:00:00+08:00`, capturedAt: 'x' }));
  db.insertMessages([...refs.values()]);
  const ev = (task: Evidence['task'], kind: Evidence['kind'], cite: string[], detail: string): Evidence => ({ reasoning: 'r', task, kind, cite, detail });
  storeEvidence(db, projectId, [
    ev({ newName: '导出和报表' }, 'started', ['m1'], '做导出和报表'),
    ev({ newName: '导出和报表' }, 'ai_claims_done', ['m2'], 'AI 说导出做好了'),
  ], refs, { model: 't', promptVersion: 't' });
  return { db, projectId, view: () => buildProjectView(db, projectId) };
}

test('任务视图带上它的证据编号', () => {
  const s = scene();
  assert.equal(s.view().tasks[0].evidenceIds.length, 2);
});

test('拆分：选中的证据拆成新任务，两边的状态各自按证据重算', () => {
  const s = scene();
  const [task] = s.view().tasks;
  const [first, second] = task.evidenceIds;
  const newId = s.db.addTask({ projectId: s.projectId, name: '月度导出', goal: null, createdAt: new Date().toISOString() });
  s.db.addCorrection(s.projectId, { type: 'assign', evidenceId: second, taskId: newId });
  const v = s.view();
  assert.equal(v.tasks.length, 2);
  assert.equal(v.tasks.find((t) => t.id === task.id)?.status, 'doing');
  assert.equal(v.tasks.find((t) => t.id === newId)?.status, 'to_verify');
  assert.deepEqual(v.tasks.find((t) => t.id === newId)?.evidenceIds, [second]);
  void first;
});

test('结果线索：用规则提取文件路径、提交编号、链接', () => {
  const h = resultHints([
    '导出做好了，文件在 exports/2026-09.csv，提交 8a50a58，改了 `src/export.ts`',
    '文档见 https://example.com/docs/export?id=3 ，另外 commit 76c5a3c9e1 也相关',
    '版本 2026 年，测试 118 passed，deadline 不是提交',
  ]);
  assert.deepEqual(h.files, ['exports/2026-09.csv', 'src/export.ts']);
  assert.deepEqual(h.commits, ['8a50a58', '76c5a3c9e1']);
  assert.deepEqual(h.links, ['https://example.com/docs/export?id=3']);
});

test('拆分接口：只能用本项目的证据；拆出的任务状态按证据算', async () => {
  const http = await import('node:http');
  const { serve } = await import('../src/server.ts');
  const { loadDemo } = await import('../src/demo.ts');
  const db = openDb(':memory:');
  const [p1, p2] = loadDemo(db);
  const server = serve(db, 0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as { port: number }).port;
  const post = (path: string, body: unknown) => new Promise<{ status: number; body: any }>((resolve) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { host: `127.0.0.1:${port}`, 'x-corpus': '1', 'content-type': 'application/json' } }, (res) => {
      let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(buf) }));
    });
    r.write(data); r.end();
  });
  const t = buildProjectView(db, p2).tasks[0];
  const foreign = db.evidenceForProject(p1)[0].id;
  assert.equal((await post(`/api/projects/${p2}/corrections`, { type: 'split', name: '拆出', evidenceIds: [foreign] })).status, 400);
  const last = t.evidenceIds.at(-1)!;
  const r = await post(`/api/projects/${p2}/corrections`, { type: 'split', name: '再导出一次', evidenceIds: [last] });
  assert.equal(r.status, 200);
  const split = buildProjectView(db, p2).tasks.find((x) => x.id === r.body.taskId);
  assert.equal(split?.status, 'to_verify');
  server.close();
});
