import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, mkdirSync, copyFileSync, appendFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseClaudeCodeLines, syncClaudeCode } from '../src/ingest/claude-code.ts';
import { openDb } from '../src/db.ts';

const FIXTURE = new URL('./fixtures/cc-sample.jsonl', import.meta.url);
const lines = readFileSync(FIXTURE, 'utf8').split('\n').filter(Boolean);

test('只保留用户和 AI 的正文，过滤命令、思考、工具调用、子 agent 和压缩摘要', () => {
  const out = parseClaudeCodeLines(lines, '2026-09-13T00:00:00Z');
  assert.equal(out.sessionId, 'sess-cc-1');
  assert.equal(out.cwd, '/code/ledger');
  assert.equal(out.title, '月度导出开发');
  assert.deepEqual(out.messages.map((m) => [m.id, m.role]), [
    ['cc:u4', 'user'],
    ['cc:u6', 'assistant'],
    ['cc:u8', 'tool_error'],
    ['cc:u11', 'user'],
    ['cc:u13', 'assistant'],
  ]);
});

test('带参数的斜杠命令保留成“/命令 参数”', () => {
  const out = parseClaudeCodeLines(lines, 'x');
  assert.equal(out.messages.find((m) => m.id === 'cc:u11')?.text, '/review 导出模块');
});

test('工具报错截短，凭证被替换', () => {
  const out = parseClaudeCodeLines(lines, 'x');
  const err = out.messages.find((m) => m.id === 'cc:u8')!;
  assert.ok(err.text.length <= 520, `长度 ${err.text.length}`);
  const user = out.messages.find((m) => m.id === 'cc:u4')!;
  assert.ok(!user.text.includes('sk-abcdefghijklmnopqrstuvwxyz123456'));
  assert.ok(user.text.includes('[已隐藏的凭证]'));
});

function setup() {
  const root = mkdtempSync(join(tmpdir(), 'gongpai-cc-'));
  const projDir = join(root, '-code-ledger');
  mkdirSync(projDir);
  const file = join(projDir, 'sess-cc-1.jsonl');
  copyFileSync(FIXTURE, file);
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: '记账小程序', goal: null, dirs: ['/code/ledger'] });
  return { root, file, db, projectId };
}

test('同步两次行数不变；追加一行多一条；只读已绑定目录的会话', () => {
  const { root, file, db, projectId } = setup();
  const r1 = syncClaudeCode(db, { root, resolveRoot: (d) => d });
  assert.equal(r1.newMessages, 5);
  const r2 = syncClaudeCode(db, { root, resolveRoot: (d) => d });
  assert.equal(r2.newMessages, 0);
  appendFileSync(file, JSON.stringify({ type: 'user', uuid: 'u99', sessionId: 'sess-cc-1', cwd: '/code/ledger', timestamp: '2026-09-10T03:00:00Z', message: { role: 'user', content: '导出能打开了，可以用。' } }) + '\n');
  const r3 = syncClaudeCode(db, { root, resolveRoot: (d) => d });
  assert.equal(r3.newMessages, 1);
  assert.equal(db.messagesForProject(projectId).length, 6);
  assert.equal(r3.skippedSessions, 0);
});

test('未绑定目录的会话不读取，只计数', () => {
  const { root, db } = setup();
  const f2 = join(root, '-code-ledger', 'sess-other.jsonl');
  writeFileSync(f2, JSON.stringify({ type: 'user', uuid: 'x1', sessionId: 'sess-other', cwd: '/elsewhere', timestamp: '2026-09-10T03:00:00Z', message: { role: 'user', content: '别的项目' } }) + '\n');
  const r = syncClaudeCode(db, { root, resolveRoot: (d) => d });
  assert.equal(r.skippedSessions, 1);
  assert.equal(db.getSession('sess-other'), null);
});

test('无法解析的行不会让整个同步失败，并报告格式异常', () => {
  const { root, file, db } = setup();
  appendFileSync(file, '{这不是 JSON\n');
  const r = syncClaudeCode(db, { root, resolveRoot: (d) => d });
  assert.equal(r.badLines, 1);
  assert.equal(r.newMessages, 5);
});
