// 第 15 轮：Claude Code 插件。清单里引用的文件都在，启动脚本能跑，MCP 能握手。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, statSync, mkdtempSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const json = (p: string) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));

test('插件清单：名字、MCP、钩子、技能都指向真实存在的文件', () => {
  const plugin = json('.claude-plugin/plugin.json');
  const market = json('.claude-plugin/marketplace.json');
  assert.equal(plugin.name, 'working-corpus');
  assert.equal(market.plugins[0].name, plugin.name);
  assert.equal(market.plugins[0].source, './');
  assert.match(plugin.mcpServers.corpus.command, /\$\{CLAUDE_PLUGIN_ROOT\}\/bin\/corpus$/);
  assert.ok(existsSync(join(ROOT, plugin.hooks)));
  assert.ok(existsSync(join(ROOT, plugin.skills, 'working-corpus', 'SKILL.md')));
  const hook = json(plugin.hooks).hooks.SessionEnd[0].hooks[0];
  assert.match(hook.command, /bin\/corpus sync --no-extract --quiet/);
  assert.equal(hook.async, true, '会话结束的钩子只有 1.5 秒，必须在后台运行');
  assert.ok(statSync(join(ROOT, 'bin/corpus')).mode & 0o111, '启动脚本要可执行');
  assert.equal(json('package.json').bin.corpus, 'bin/corpus');
});

test('启动脚本：只读同步安静运行，不输出任何东西', () => {
  const home = mkdtempSync(join(tmpdir(), 'corpus-plugin-'));
  const r = spawnSync(join(ROOT, 'bin/corpus'), ['sync', '--no-extract', '--quiet'], { env: { ...process.env, CORPUS_HOME: home }, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, '');
});

test('启动脚本：MCP 握手', () => {
  const home = mkdtempSync(join(tmpdir(), 'corpus-plugin-'));
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } });
  const r = spawnSync(join(ROOT, 'bin/corpus'), ['mcp'], { env: { ...process.env, CORPUS_HOME: home }, input: `${init}\n`, encoding: 'utf8' });
  const first = JSON.parse(r.stdout.split('\n')[0]);
  assert.equal(first.result.serverInfo.name, 'working-corpus');
});
