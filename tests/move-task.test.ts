// 第 20 轮：把任务移到别的项目。任务、它的证据和状态一起走，原话仍能打开。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db.ts';
import { loadDemo } from '../src/demo.ts';
import { buildProjectView } from '../src/engine/view.ts';
import { serve } from '../src/server.ts';

const db = openDb(':memory:');
const [p1, p2] = loadDemo(db);
const server = serve(db, 0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as AddressInfo).port;
after(() => server.close());
const req = (method: string, path: string, body?: unknown) => new Promise<{ status: number; body: any }>((resolve) => {
  const data = body ? JSON.stringify(body) : undefined;
  const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, 'x-corpus': '1', ...(data ? { 'content-type': 'application/json' } : {}) } }, (res) => {
    let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(buf) }));
  });
  if (data) r.write(data); r.end();
});

test('移动后：源项目少一个任务，目标项目多一个，状态和依据不变，原话可以从目标项目读到', async () => {
  const before = buildProjectView(db, p2).tasks[0];
  const n1 = buildProjectView(db, p1).tasks.length;
  const r = await req('POST', `/api/projects/${p2}/tasks/${encodeURIComponent(before.id)}/move`, { to: p1 });
  assert.equal(r.status, 200);
  const moved = buildProjectView(db, p1).tasks.find((t) => t.id === r.body.taskId)!;
  assert.equal(buildProjectView(db, p2).tasks.length, 0);
  assert.equal(buildProjectView(db, p1).tasks.length, n1 + 1);
  assert.equal(moved.status, before.status);
  assert.equal(moved.history.length, before.history.length);
  const msgs = await req('GET', `/api/projects/${p1}/messages?ids=${encodeURIComponent(db.evidenceForProject(p1).find((e) => e.taskId === moved.id)!.cite.join(','))}`);
  assert.ok(msgs.body.length > 0);
});

test('不能移到不存在的项目，也不能移不属于这个项目的任务', async () => {
  const t = buildProjectView(db, p1).tasks[0].id;
  assert.equal((await req('POST', `/api/projects/${p1}/tasks/${encodeURIComponent(t)}/move`, { to: 'p_nope' })).status, 404);
  assert.equal((await req('POST', `/api/projects/${p2}/tasks/${encodeURIComponent(t)}/move`, { to: p2 })).status, 400);
});

test('几个示例项目灌进同一个库，各自的会话不会撞在一起', () => {
  const d = openDb(':memory:');
  const [a, b] = loadDemo(d);
  const sa = new Set(d.sessionsForProject(a).map((s) => s.id));
  assert.ok(d.sessionsForProject(b).every((s) => !sa.has(s.id)));
  assert.equal(d.messagesForProject(b).length, 6); // S4 一共 6 条消息，全在自己名下
});
