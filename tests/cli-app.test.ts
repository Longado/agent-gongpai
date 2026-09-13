// 命令行演示：终端渲染、按当前目录找项目、后台启动和停止本地服务。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.ts';
import { loadDemo } from '../src/demo.ts';
import { buildProjectView } from '../src/engine/view.ts';
import { renderScene, renderLogo } from '../src/tui.ts';

const CLI = fileURLToPath(new URL('../bin/corpus', import.meta.url));
const run = (args: string[], env: Record<string, string>, cwd?: string) => spawnSync(CLI, args, { env: { ...process.env, NO_COLOR: '1', ...env }, encoding: 'utf8', cwd });

test('终端渲染：没有颜色时是纯文字，状态、下一步、不要做都在', () => {
  const db = openDb(':memory:');
  const [p1] = loadDemo(db);
  const out = renderScene(db.getProject(p1)!, buildProjectView(db, p1), { color: false });
  assert.doesNotMatch(out, /\x1b\[/);
  assert.match(out, /已完成\s+T01 记账录入/);
  assert.match(out, /下一步/);
  assert.match(out, /不要做.*云同步/s);
  assert.match(renderLogo({ color: true }), /\x1b\[38;2;/);
  assert.equal(renderLogo({ color: false }), '');
});

test('corpus show 不带参数：按当前目录找项目', () => {
  const home = mkdtempSync(join(tmpdir(), 'corpus-cli-'));
  const dir = join(home, 'proj');
  mkdirSync(dir);
  run(['project', 'add', '目录项目', '--dir', dir], { CORPUS_HOME: home });
  const r = run(['show'], { CORPUS_HOME: home }, dir);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /目录项目/);
});

test('corpus app --no-open 在后台启动服务，corpus stop 停掉', async () => {
  const home = mkdtempSync(join(tmpdir(), 'corpus-app-'));
  const port = String(4300 + Math.floor(Math.random() * 500));
  const r = run(['app', '--no-open', '--port', port], { CORPUS_HOME: home });
  assert.equal(r.status, 0, r.stderr);
  const state = await fetch(`http://127.0.0.1:${port}/api/state`).then((x) => x.status);
  assert.equal(state, 200);
  assert.equal(run(['app', '--no-open', '--port', port], { CORPUS_HOME: home }).status, 0); // 已经开着就直接用
  assert.equal(run(['stop'], { CORPUS_HOME: home }).status, 0);
  await new Promise((res) => setTimeout(res, 300));
  await assert.rejects(fetch(`http://127.0.0.1:${port}/api/state`));
});
