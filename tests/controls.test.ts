import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, mkdirSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { openDb } from '../src/db.ts';
import { syncClaudeCode } from '../src/ingest/claude-code.ts';
import { serve } from '../src/server.ts';

test('暂停采集后不再读新对话，已有数据保留；恢复后继续', () => {
  const root = mkdtempSync(join(tmpdir(), 'corpus-pause-'));
  mkdirSync(join(root, '-code-ledger'));
  copyFileSync(new URL('./fixtures/cc-sample.jsonl', import.meta.url), join(root, '-code-ledger', 's.jsonl'));
  const db = openDb(':memory:');
  const pid = db.createProject({ name: 'p', goal: null, dirs: ['/code/ledger'] });
  db.setPaused(pid, true);
  assert.equal(syncClaudeCode(db, { root, resolveRoot: (d) => d }).newMessages, 0);
  db.setPaused(pid, false);
  assert.equal(syncClaudeCode(db, { root, resolveRoot: (d) => d }).newMessages, 5);
  db.setPaused(pid, true);
  assert.equal(db.messagesForProject(pid).length, 5);
});

test('没有同意发送之前，同步接口不调用远程模型', async () => {
  const db = openDb(':memory:');
  const pid = db.createProject({ name: 'p', goal: null, dirs: [] });
  const server = serve(db, 0);
  await new Promise((r) => server.once('listening', r));
  after(() => server.close());
  const port = (server.address() as AddressInfo).port;
  const post = (path: string) => new Promise<number>((resolve) => {
    const r = http.request({ host: '127.0.0.1', port, path, method: 'POST', headers: { host: `127.0.0.1:${port}`, 'x-corpus': '1' } }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode!)); });
    r.end();
  });
  assert.equal(await post(`/api/projects/${pid}/sync`), 428);
  assert.equal(await post(`/api/projects/${pid}/consent`), 200);
  assert.equal(db.getProject(pid)?.remoteOk, true);
});
