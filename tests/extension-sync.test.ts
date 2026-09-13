// 第 21 轮：Gemini 自动同步的判断逻辑，以及“按链接认对话”。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { openDb } from '../src/db.ts';
import { importText } from '../src/ingest/paste.ts';

const ctx: any = {};
vm.runInNewContext(readFileSync(new URL('../extension/lib.js', import.meta.url), 'utf8'), { self: ctx, URL });
const lib = ctx.corpusLib;

test('对话编号：普通、多账号、带参数都能认；新对话页和别的网站不算', () => {
  assert.equal(lib.conversationKey('https://gemini.google.com/app/abc123'), 'abc123');
  assert.equal(lib.conversationKey('https://gemini.google.com/u/1/app/abc123?hl=zh#x'), 'abc123');
  assert.equal(lib.conversationKey('https://gemini.google.com/app'), null);
  assert.equal(lib.conversationKey('https://evil.example/app/abc123'), null);
});

test('只在绑定了、生成完了、内容变了的时候同步', () => {
  const turns = [{ role: 'user', text: '做导出' }, { role: 'assistant', text: '好的' }];
  const sig = lib.signature(turns);
  assert.equal(lib.shouldSync({ bound: true, generating: false, turns, lastSignature: '' }), true);
  assert.equal(lib.shouldSync({ bound: true, generating: false, turns, lastSignature: sig }), false);
  assert.equal(lib.shouldSync({ bound: true, generating: true, turns, lastSignature: '' }), false);
  assert.equal(lib.shouldSync({ bound: false, generating: false, turns, lastSignature: '' }), false);
  assert.equal(lib.shouldSync({ bound: true, generating: false, turns: [], lastSignature: '' }), false);
  const more = [...turns, { role: 'user', text: '再加统计' }];
  assert.equal(lib.shouldSync({ bound: true, generating: false, turns: more, lastSignature: sig }), true);
});

test('有链接的对话按链接认：标题后来变了，也还是同一段会话，不重复', () => {
  const db = openDb(':memory:');
  const pid = db.createProject({ name: 'p', goal: null, dirs: [] });
  const url = 'https://gemini.google.com/app/abc123';
  const a = importText(db, { projectId: pid, text: '你：做导出', label: 'Gemini 网页', title: '做导出', url });
  const b = importText(db, { projectId: pid, text: '你：做导出\nGemini：好的', label: 'Gemini 网页', title: '记账小程序导出需求', url });
  assert.equal(a.sessionId, b.sessionId);
  assert.equal(b.newMessages, 1);
  assert.equal(db.getSession(b.sessionId)?.title, '记账小程序导出需求');
});
