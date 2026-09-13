// 第 16 轮：Google Takeout 的 Gemini 活动导出。格式没有用真实导出验证过，样本是按公开资料手写的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDb } from '../src/db.ts';
import { parseTakeout, importTakeout } from '../src/ingest/takeout.ts';

const raw = JSON.parse(readFileSync(new URL('./fixtures/takeout-sample.json', import.meta.url), 'utf8'));

test('按对话编号归组；没有编号的按天归组；空记录跳过', () => {
  const convs = parseTakeout(raw);
  assert.deepEqual(convs.map((c) => [c.key, c.turns.length]), [['abc123', 3], ['day-2026-09-09', 2], ['def456', 2]]);
  const abc = convs[0];
  assert.equal(abc.url, 'https://gemini.google.com/app/abc123');
  assert.equal(abc.title, '第一版要有记账录入、分类统计、月度导出。');
  assert.equal(abc.missingResponse, true); // 第二轮没有回复
});

test('几种存放方式都能取出问和答；HTML 回复去掉标签', () => {
  const [, day, def] = parseTakeout(raw);
  assert.deepEqual(day.turns.map((t) => [t.role, t.text]), [['user', '帮我想一个旅行计划'], ['assistant', '可以先去杭州。']]);
  assert.deepEqual(def.turns.map((t) => t.text), ['导出做成表格文件', '建议用 CSV，带 BOM。']);
});

test('只导入挑选的对话；带原始时间和原页面链接；重复导入不重复；缺回复的标为部分', () => {
  const db = openDb(':memory:');
  const pid = db.createProject({ name: 'p', goal: null, dirs: [] });
  const r1 = importTakeout(db, pid, raw, ['abc123']);
  assert.equal(r1.newMessages, 3);
  assert.equal(importTakeout(db, pid, raw, ['abc123']).newMessages, 0);
  const s = db.sessionsForProject(pid);
  assert.equal(s.length, 1);
  assert.equal(s[0].url, 'https://gemini.google.com/app/abc123');
  assert.equal(s[0].coverage, 'partial');
  assert.ok(db.messagesForProject(pid).every((m) => m.ts?.startsWith('2026-09-08')));
});

test('接口：先预览列出对话，再只导入勾选的', async () => {
  const http = await import('node:http');
  const { serve } = await import('../src/server.ts');
  const db = openDb(':memory:');
  const pid = db.createProject({ name: 'p', goal: null, dirs: [] });
  const server = serve(db, 0);
  await new Promise((r) => server.once('listening', r));
  const port = (server.address() as { port: number }).port;
  const post = (path: string, body: unknown) => new Promise<any>((resolve) => {
    const data = JSON.stringify(body);
    const r = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { host: `127.0.0.1:${port}`, 'x-corpus': '1', 'content-type': 'application/json' } }, (res) => {
      let buf = ''; res.on('data', (c) => (buf += c)); res.on('end', () => resolve({ status: res.statusCode, ...JSON.parse(buf) }));
    });
    r.write(data); r.end();
  });
  const pre = await post(`/api/projects/${pid}/takeout/preview`, raw);
  assert.equal(pre.conversations.length, 3);
  const done = await post(`/api/projects/${pid}/takeout/import`, { token: pre.token, keys: ['def456'] });
  assert.equal(done.newMessages, 2);
  assert.equal(db.sessionsForProject(pid).length, 1);
  assert.equal((await post(`/api/projects/${pid}/takeout/preview`, { not: 'array' })).status, 400);
  server.close();
});
