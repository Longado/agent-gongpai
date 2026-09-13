// 第 19 轮：浏览器扩展要从 chrome-extension:// 来源访问本地服务，只对这种来源放行跨域。
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db.ts';
import { serve } from '../src/server.ts';

const db = openDb(':memory:');
const pid = db.createProject({ name: 'p', goal: null, dirs: [] });
const server = serve(db, 0);
await new Promise((r) => server.once('listening', r));
const port = (server.address() as AddressInfo).port;
after(() => server.close());
const req = (method: string, path: string, headers: Record<string, string>, body?: string) => new Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }>((resolve) => {
  const r = http.request({ host: '127.0.0.1', port, path, method, headers: { host: `127.0.0.1:${port}`, ...headers } }, (res) => {
    let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: buf }));
  });
  if (body) r.write(body); r.end();
});
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';

test('扩展来源：预检通过，正式请求带上允许来源', async () => {
  const pre = await req('OPTIONS', `/api/projects/${pid}/import`, { origin: EXT, 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type,x-corpus' });
  assert.equal(pre.status, 204);
  assert.equal(pre.headers['access-control-allow-origin'], EXT);
  assert.match(String(pre.headers['access-control-allow-headers']), /x-corpus/i);
  const r = await req('POST', `/api/projects/${pid}/import`, { origin: EXT, 'x-corpus': '1', 'content-type': 'application/json' }, JSON.stringify({ text: '你：hi', label: 'Gemini 网页', title: 't', url: 'https://gemini.google.com/app/1' }));
  assert.equal(r.status, 200);
  assert.equal(r.headers['access-control-allow-origin'], EXT);
});

test('网站来源：预检被拒，正式请求不带允许来源', async () => {
  const pre = await req('OPTIONS', `/api/projects/${pid}/import`, { origin: 'https://evil.example', 'access-control-request-method': 'POST' });
  assert.equal(pre.status, 403);
  const r = await req('GET', '/api/state', { origin: 'https://evil.example' });
  assert.equal(r.headers['access-control-allow-origin'], undefined);
});
