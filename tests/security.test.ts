// 安全评审的两条低危：读原文和改证据都要限定在当前项目内。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db.ts';
import { loadDemo } from '../src/demo.ts';
import { serve } from '../src/server.ts';

const db = openDb(':memory:');
const [p1, p2] = loadDemo(db);
const server = serve(db, 0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as AddressInfo).port;
after(() => server.close());

function req(path: string, method = 'GET', body?: unknown): Promise<{ status: number; body: any }> {
  return new Promise((resolve) => {
    const data = body ? JSON.stringify(body) : undefined;
    const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, 'x-corpus': '1', ...(data ? { 'content-type': 'application/json' } : {}) } }, (res) => {
      let buf = '';
      res.on('data', (c) => (buf += c));
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(buf) }));
    });
    if (data) r.write(data);
    r.end();
  });
}

test('读原文只能读当前项目的消息', async () => {
  const otherMsg = db.messagesForProject(p2)[0].id;
  const own = db.messagesForProject(p1)[0].id;
  const r = await req(`/api/projects/${p1}/messages?ids=${encodeURIComponent(`${own},${otherMsg}`)}`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.map((m: any) => m.id), [own]);
});

test('不能用别的项目的证据做归入或标记已处理', async () => {
  const foreignEv = db.evidenceForProject(p2)[0].id;
  const task = db.tasksForProject(p1)[0].id;
  assert.equal((await req(`/api/projects/${p1}/corrections`, 'POST', { type: 'assign', evidenceId: foreignEv, taskId: task })).status, 400);
  assert.equal((await req(`/api/projects/${p1}/corrections`, 'POST', { type: 'ack', evidenceId: foreignEv })).status, 400);
});
