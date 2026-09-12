// 第 11 轮：重新整理、移出误归类的会话、记录工具版本。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import type { Message } from '../src/contracts.ts';
import { extractProject } from '../src/extract/run.ts';
import type { ModelCall } from '../src/extract/model.ts';
import { buildProjectView } from '../src/engine/view.ts';
import { syncClaudeCode, parseClaudeCodeLines } from '../src/ingest/claude-code.ts';
import { parseCodexLines } from '../src/ingest/codex.ts';

const reply = (ev: unknown[]): ModelCall => ({ name: 'fake', async call() { return JSON.stringify({ evidence: ev }); } });

function project() {
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: 'p', goal: null, dirs: [] });
  db.upsertSession({ id: 's1', source: 'claude_code', label: 'Claude Code', projectId, cwd: null, title: null, coverage: 'full' });
  const msgs: Message[] = [
    { id: 's1:0', sessionId: 's1', seq: 0, role: 'user', text: '做导出', ts: '2026-09-10T10:00:00+08:00', capturedAt: 'x' },
    { id: 's1:1', sessionId: 's1', seq: 1, role: 'assistant', text: '导出做好了', ts: '2026-09-10T11:00:00+08:00', capturedAt: 'x' },
  ];
  db.insertMessages(msgs);
  return { db, projectId };
}

test('重新整理：清掉旧证据从头来，任务编号和你的修正都保留', async () => {
  const { db, projectId } = project();
  await extractProject(db, projectId, reply([{ reasoning: 'r', task: { newName: '导出' }, kind: 'started', cite: ['m1'], detail: '做导出' }]));
  const id = buildProjectView(db, projectId).tasks[0].id;
  db.addCorrection(projectId, { type: 'rename', taskId: id, name: '月度导出' });
  db.resetExtraction(projectId);
  assert.equal(db.evidenceForProject(projectId).length, 0);
  assert.equal(db.getSession('s1')!.extractedUpto, -1);
  // 新一轮整理用已有任务编号回答
  await extractProject(db, projectId, reply([
    { reasoning: 'r', task: { id: 'T01' }, kind: 'started', cite: ['m1'], detail: '做导出' },
    { reasoning: 'r', task: { id: 'T01' }, kind: 'ai_claims_done', cite: ['m2'], detail: 'AI 说做好了' },
  ]));
  const t = buildProjectView(db, projectId).tasks;
  assert.equal(t.length, 1);
  assert.equal(t[0].id, id);
  assert.equal(t[0].name, '月度导出');
  assert.equal(t[0].status, 'to_verify');
});

test('移出误归类的会话：消息和它产生的证据删掉，结论重算；之后同步不再读它', async () => {
  const root = mkdtempSync(join(tmpdir(), 'corpus-excl-'));
  mkdirSync(join(root, '-code-ledger'));
  copyFileSync(new URL('./fixtures/cc-sample.jsonl', import.meta.url), join(root, '-code-ledger', 's.jsonl'));
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: 'p', goal: null, dirs: ['/code/ledger'] });
  syncClaudeCode(db, { root, resolveRoot: (d) => d });
  await extractProject(db, projectId, reply([{ reasoning: 'r', task: { newName: '导出' }, kind: 'started', cite: ['m1'], detail: '做导出' }]));
  assert.equal(buildProjectView(db, projectId).tasks.length, 1);
  db.excludeSession(projectId, 'sess-cc-1');
  assert.equal(db.messagesForProject(projectId).length, 0);
  assert.equal(db.evidenceForProject(projectId).length, 0);
  assert.equal(buildProjectView(db, projectId).tasks.length, 0);
  assert.equal(syncClaudeCode(db, { root, resolveRoot: (d) => d }).newMessages, 0);
  assert.equal(db.sessionsForProject(projectId).length, 0);
});

test('记下工具版本：Claude Code 取每行的 version，Codex 取会话开头的 cli_version', () => {
  const cc = readFileSync(new URL('./fixtures/cc-sample.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean)
    .map((l) => { const d = JSON.parse(l); if (d.type === 'user') d.version = '2.1.269'; return JSON.stringify(d); });
  assert.equal(parseClaudeCodeLines(cc, 'x').version, '2.1.269');
  const cx = readFileSync(new URL('./fixtures/codex-sample.jsonl', import.meta.url), 'utf8').split('\n').filter(Boolean);
  assert.equal(parseCodexLines(cx, 'x').version, '0.154.0');
});
