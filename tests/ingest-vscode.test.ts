// 第 18 轮：VS Code 自带聊天（Copilot Chat）。文件是操作日志：0 初始状态、1 设值、2 追加。结构照本机真实文件写成，内容是编的。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openDb } from '../src/db.ts';
import { replayChatLog, parseVscodeSession, syncVscode } from '../src/ingest/vscode.ts';

const ROOT = fileURLToPath(new URL('./fixtures/vscode', import.meta.url));
const LOG = `${ROOT}/workspaceStorage/ws1/chatSessions/11111111-2222-3333-4444-555555555555.jsonl`;

test('重放操作日志：追加的提问和回复片段、设置的标题都在；不认识的操作跳过', () => {
  const s = replayChatLog(readFileSync(LOG, 'utf8'));
  assert.equal(s.customTitle, '月度导出');
  assert.equal(s.requests.length, 2);
  assert.equal(s.requests[0].response.length, 3);
});

test('会话转成消息：提问一条、回复只拼 Markdown 片段；时间来自毫秒时间戳', () => {
  const p = parseVscodeSession(readFileSync(LOG, 'utf8'), 'x');
  assert.equal(p.title, '月度导出');
  assert.deepEqual(p.messages.map((m) => [m.role, m.text]), [
    ['user', '帮我写月度导出函数'],
    ['assistant', '好的，先写查询：\n导出函数写好了。'],
    ['user', '文件打不开'],
  ]);
  assert.equal(p.messages[0].ts, new Date(1789200060000).toISOString());
});

test('按工作区文件夹归到项目；同步两次不重复；没打开文件夹的聊天只计数', () => {
  const db = openDb(':memory:');
  const pid = db.createProject({ name: 'p', goal: null, dirs: ['/code/ledger'] });
  const r1 = syncVscode(db, { root: ROOT, resolveRoot: (d) => d });
  assert.equal(r1.newMessages, 3);
  assert.equal(r1.skippedSessions, 1);
  assert.equal(syncVscode(db, { root: ROOT, resolveRoot: (d) => d }).newMessages, 0);
  const s = db.sessionsForProject(pid)[0];
  assert.equal(s.source, 'vscode');
  assert.equal(s.label, 'VS Code 聊天');
});
