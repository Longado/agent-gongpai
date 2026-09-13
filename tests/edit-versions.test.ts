// 第 23 轮：消息编辑版本。旧版本保留、能看到，但不再参与判断，也不再发给模型。
// Claude Code 的形态照本机真实记录：同一个上级下挂两条文字提问，旧的那条后面只有一两行，新的后面才是后续。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../src/db.ts';
import type { Evidence } from '../src/contracts.ts';
import { syncClaudeCode } from '../src/ingest/claude-code.ts';
import { importText } from '../src/ingest/paste.ts';
import { storeEvidence } from '../src/extract/validate.ts';
import { buildProjectView } from '../src/engine/view.ts';
import { buildPrompt } from '../src/extract/run.ts';

const line = (uuid: string, parent: string | null, type: 'user' | 'assistant', text: string, t: number) => JSON.stringify({
  type, uuid, parentUuid: parent, sessionId: 's-edit', cwd: '/code/ledger', timestamp: `2026-09-10T10:00:${String(t).padStart(2, '0')}Z`,
  message: { role: type, content: type === 'user' ? text : [{ type: 'text', text }] },
}) + '\n';

function ccSetup() {
  const root = mkdtempSync(join(tmpdir(), 'corpus-edit-'));
  mkdirSync(join(root, '-code-ledger'));
  const file = join(root, '-code-ledger', 's-edit.jsonl');
  const db = openDb(':memory:');
  const pid = db.createProject({ name: 'p', goal: null, dirs: ['/code/ledger'] });
  return { root, file, db, pid, sync: () => syncClaudeCode(db, { root, resolveRoot: (d) => d }) };
}

test('Claude Code：改了一句重发，旧提问和它的半截回复标为旧版本；分两次同步也能认出来', () => {
  const s = ccSetup();
  writeFileSync(s.file, line('p0', null, 'assistant', '准备好了', 0) + line('a1', 'p0', 'user', '做导出', 1) + line('r1', 'a1', 'assistant', '好的，我先', 2));
  s.sync();
  appendFileSync(s.file, line('a2', 'p0', 'user', '做月度导出，表格格式', 3) + line('r2', 'a2', 'assistant', '月度导出做好了', 4));
  s.sync();
  const byId = new Map(s.db.messagesForProject(s.pid).map((m) => [m.id, m]));
  assert.equal(byId.get('cc:a1')?.replacedBy, 'cc:a2');
  assert.equal(byId.get('cc:r1')?.replacedBy, 'cc:a2');
  assert.equal(byId.get('cc:a2')?.replacedBy ?? null, null);
  assert.equal(byId.get('cc:r2')?.replacedBy ?? null, null);
});

test('粘贴导入：再导一次时同一位置换了内容，旧的标为被新的替代', () => {
  const db = openDb(':memory:');
  const pid = db.createProject({ name: 'p', goal: null, dirs: [] });
  importText(db, { projectId: pid, text: '你：第一版要有录入\nGemini：好\n你：做导出\nGemini：好的', label: 'Gemini 网页', title: 't' });
  importText(db, { projectId: pid, text: '你：第一版要有录入\nGemini：好\n你：做月度导出\nGemini：好的，月度导出', label: 'Gemini 网页', title: 't' });
  const msgs = db.messagesForProject(pid);
  const old = msgs.find((m) => m.text === '做导出')!;
  const neu = msgs.find((m) => m.text === '做月度导出')!;
  assert.equal(old.replacedBy, neu.id);
  assert.equal(msgs.find((m) => m.text === '第一版要有录入')?.replacedBy ?? null, null);
});

test('只引用旧版本的证据不再参与判断；整理时旧版本不发给模型', () => {
  const s = ccSetup();
  writeFileSync(s.file, line('p0', null, 'assistant', '准备好了', 0) + line('a1', 'p0', 'user', '做导出', 1) + line('a2', 'p0', 'user', '做月度导出', 3));
  s.sync();
  const byId = new Map(s.db.messagesForProject(s.pid).map((m) => [m.id, m]));
  const refs = new Map([['m1', byId.get('cc:a1')!], ['m2', byId.get('cc:a2')!]]);
  const ev = (cite: string, name: string): Evidence => ({ reasoning: 'r', task: { newName: name }, kind: 'started', cite: [cite], detail: name });
  storeEvidence(s.db, s.pid, [ev('m1', '导出'), ev('m2', '月度导出')], refs, { model: 't', promptVersion: 't' });
  assert.deepEqual(buildProjectView(s.db, s.pid).tasks.map((t) => t.name), ['月度导出']);
  const session = s.db.getSession('s-edit')!;
  const { user } = buildPrompt(s.db, s.pid, session, s.db.messagesForSession('s-edit').filter((m) => !m.replacedBy));
  assert.doesNotMatch(user, /\n做导出/);
});
