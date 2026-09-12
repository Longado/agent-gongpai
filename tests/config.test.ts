import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { dbPath, homeDir, loadEnv } from '../src/config.ts';

// 只改动、恢复用到的变量；不要整体替换 process.env，否则它会变成普通对象
function withEnv(vars: Record<string, string | undefined>, fn: () => void) {
  const saved = Object.fromEntries(Object.keys(vars).map((k) => [k, process.env[k]]));
  const set = (v: Record<string, string | undefined>) => Object.entries(v).forEach(([k, x]) => (x === undefined ? delete process.env[k] : (process.env[k] = x)));
  set(vars);
  try { fn(); } finally { set(saved); }
}

test('数据目录默认在用户目录下，可以用环境变量改', () => {
  withEnv({ CORPUS_HOME: undefined, CORPUS_DB: undefined }, () => {
    assert.equal(homeDir(), join(homedir(), '.working-corpus'));
    assert.equal(dbPath(), join(homedir(), '.working-corpus', 'corpus.db'));
  });
  withEnv({ CORPUS_HOME: '/tmp/wc-home', CORPUS_DB: undefined }, () => assert.equal(dbPath(), '/tmp/wc-home/corpus.db'));
  withEnv({ CORPUS_DB: '/tmp/x.db' }, () => assert.equal(dbPath(), '/tmp/x.db'));
});

test('配置优先级：已有的环境变量 > 用户目录里的 .env', () => {
  const home = mkdtempSync(join(tmpdir(), 'corpus-home-'));
  writeFileSync(join(home, '.env'), 'CORPUS_TEST_A=file\nCORPUS_TEST_B=file\n');
  withEnv({ CORPUS_HOME: home, CORPUS_TEST_A: 'env', CORPUS_TEST_B: undefined }, () => {
    loadEnv();
    assert.equal(process.env.CORPUS_TEST_A, 'env');
    assert.equal(process.env.CORPUS_TEST_B, 'file');
  });
});
