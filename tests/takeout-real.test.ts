// 用真实导出校准：“Gemini in Workspace”的对话格式照真实文件的结构写成（内容是编的）。
// 整个 Takeout 文件夹或 zip 都能直接导入，自动识别里面有哪几种数据。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readTakeoutPath } from '../src/ingest/takeout.ts';

const FOLDER = fileURLToPath(new URL('./fixtures/takeout-folder', import.meta.url));

test('Workspace 对话：问答、时间、标题、引用链接、图片占位', () => {
  const convs = readTakeoutPath(FOLDER);
  const ws = convs.find((c) => c.key === 'ws-1778499057')!;
  assert.equal(ws.title, '记账小程序导出需求');
  assert.equal(ws.source, 'Gemini in Workspace');
  assert.equal(ws.turns.length, 4);
  assert.deepEqual(ws.turns.map((t) => t.role), ['user', 'assistant', 'user', 'assistant']);
  assert.match(ws.turns[1].text, /https:\/\/example\.com\/spec/);
  assert.match(ws.turns[3].text, /\[图片\]/);
  assert.equal(ws.turns[0].ts, '2026-05-11T11:30:57.834207+00:00');
  assert.equal(ws.missingResponse, false);
});

test('同一个文件夹里的“我的活动”导出也一起读出来', () => {
  const keys = readTakeoutPath(FOLDER).map((c) => c.key);
  assert.ok(keys.includes('abc123'));
  assert.ok(keys.includes('ws-1778499057'));
});

test('zip 包可以直接读', { skip: spawnSync('zip', ['-v']).status !== 0 ? '本机没有 zip 命令' : false }, () => {
  const out = join(mkdtempSync(join(tmpdir(), 'corpus-zip-')), 'takeout.zip');
  spawnSync('zip', ['-qr', out, 'Takeout'], { cwd: FOLDER });
  assert.ok(readTakeoutPath(out).some((c) => c.key === 'ws-1778499057'));
});

test('接口：直接上传 zip 包，预览后导入', { skip: spawnSync('zip', ['-v']).status !== 0 ? '本机没有 zip 命令' : false }, async () => {
  const { readFileSync } = await import('node:fs');
  const http = await import('node:http');
  const { openDb } = await import('../src/db.ts');
  const { serve } = await import('../src/server.ts');
  const out = join(mkdtempSync(join(tmpdir(), 'corpus-zip-')), 'takeout.zip');
  spawnSync('zip', ['-qr', out, 'Takeout'], { cwd: FOLDER });
  const db = openDb(':memory:');
  const pid = db.createProject({ name: 'p', goal: null, dirs: [] });
  const server = serve(db, 0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as { port: number }).port;
  const post = (path: string, body: Buffer | string, type: string) => new Promise<any>((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { host: `127.0.0.1:${port}`, 'x-corpus': '1', 'content-type': type } }, (res) => {
      let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => resolve({ status: res.statusCode, ...JSON.parse(buf) }));
    });
    r.write(body); r.end();
  });
  const pre = await post(`/api/projects/${pid}/takeout/preview`, readFileSync(out), 'application/zip');
  assert.ok(pre.conversations.some((c: any) => c.key === 'ws-1778499057'));
  const done = await post(`/api/projects/${pid}/takeout/import`, JSON.stringify({ token: pre.token, keys: ['ws-1778499057'] }), 'application/json');
  assert.equal(done.newMessages, 4);
  assert.match(db.sessionsForProject(pid)[0].label, /Gemini in Workspace/);
  server.close();
});
