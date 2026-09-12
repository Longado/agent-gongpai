// 第 14 轮：导入链接、打开页面自动读取。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db.ts';
import { loadDemo } from '../src/demo.ts';
import { serve } from '../src/server.ts';
import { importText } from '../src/ingest/paste.ts';

test('导入可以带原页面链接，会话记下它', () => {
  const db = openDb(':memory:');
  const pid = db.createProject({ name: 'p', goal: null, dirs: [] });
  const r = importText(db, { projectId: pid, text: '你：做导出', label: 'Gemini 网页', title: '需求', url: 'https://gemini.google.com/app/abc' });
  assert.equal(db.getSession(r.sessionId)?.url, 'https://gemini.google.com/app/abc');
});

const db = openDb(':memory:');
const [p1] = loadDemo(db);
const server = serve(db, 0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as AddressInfo).port;
after(() => server.close());
const req = (path: string, method = 'GET', body?: unknown) => new Promise<{ status: number; body: any }>((resolve) => {
  const data = body ? JSON.stringify(body) : undefined;
  const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, 'x-corpus': '1', ...(data ? { 'content-type': 'application/json' } : {}) } }, (res) => {
    let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(buf) }));
  });
  if (data) r.write(data); r.end();
});

test('导入接口只接受 http 和 https 链接', async () => {
  const bad = await req(`/api/projects/${p1}/import`, 'POST', { text: '你：hi', label: 'Gemini 网页', title: 't', url: 'javascript:alert(1)' });
  assert.equal(bad.status, 400);
  const ok = await req(`/api/projects/${p1}/import`, 'POST', { text: '你：hi', label: 'Gemini 网页', title: 't2', url: 'https://example.com/chat/1' });
  assert.equal(ok.status, 200);
});

test('只读同步接口不调用模型；项目数据里有“还没整理”的条数', async () => {
  const r = await req('/api/read', 'POST');
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.newMessages, 'number');
  const before = (await req(`/api/projects/${p1}`)).body.unextracted;
  assert.equal(before, 1); // 上一条测试导入的一条新消息还没整理；示例数据本身算已整理
});
