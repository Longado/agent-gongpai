import { test } from 'node:test';
import assert from 'node:assert/strict';
import { splitSpeakers, importText } from '../src/ingest/paste.ts';
import { openDb } from '../src/db.ts';

const TEXT = `你：第一版要有记账录入、分类统计、月度导出。
Gemini：好的，按这三项推进。
另外可以考虑预算提醒。
你：预算提醒先不要。`;

test('按发言者标记切分，续行归到上一条', () => {
  assert.deepEqual(splitSpeakers(TEXT), [
    { role: 'user', text: '第一版要有记账录入、分类统计、月度导出。' },
    { role: 'assistant', text: '好的，按这三项推进。\n另外可以考虑预算提醒。' },
    { role: 'user', text: '预算提醒先不要。' },
  ]);
});

test('英文和 Markdown 标记也能认', () => {
  const t = '**You**\n先做导出\n\n**Gemini**\n好的\nUser: 再加统计\nAssistant: 可以';
  assert.deepEqual(splitSpeakers(t).map((m) => m.role), ['user', 'assistant', 'user', 'assistant']);
});

test('认不出发言者时整段算一条，标记为需要确认', () => {
  const out = splitSpeakers('这是一段没有任何标记的笔记。\n第二行。');
  assert.equal(out.length, 1);
  assert.equal(out[0].unsure, true);
});

function db1() {
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: '记账小程序', goal: null, dirs: [] });
  return { db, projectId };
}

test('同一段导入两次不重复；原始时间为空，不伪造', () => {
  const { db, projectId } = db1();
  const a = importText(db, { projectId, text: TEXT, label: 'Gemini 网页', title: '需求讨论' });
  const b = importText(db, { projectId, text: TEXT, label: 'Gemini 网页', title: '需求讨论' });
  assert.equal(a.newMessages, 3);
  assert.equal(b.newMessages, 0);
  assert.equal(a.sessionId, b.sessionId);
  assert.ok(db.messagesForProject(projectId).every((m) => m.ts === null));
});

test('之后粘了更长的版本，只补新的部分，顺序按新版本重排', () => {
  const { db, projectId } = db1();
  const tail = '你：预算提醒先不要。\nGemini：好的。';
  importText(db, { projectId, text: tail, label: 'Gemini 网页', title: '需求讨论', coverage: 'partial' });
  const r = importText(db, { projectId, text: `你：第一版要有录入。\n${tail}`, label: 'Gemini 网页', title: '需求讨论', coverage: 'full' });
  assert.equal(r.newMessages, 1);
  const s = db.getSession(r.sessionId)!;
  assert.equal(s.coverage, 'full');
  assert.deepEqual(db.messagesForSession(r.sessionId).map((m) => m.text), ['第一版要有录入。', '预算提醒先不要。', '好的。']);
});

test('用户标注了日期时，用它排序并在来源名里写明', () => {
  const { db, projectId } = db1();
  const r = importText(db, { projectId, text: TEXT, label: 'Gemini 网页', title: '需求讨论', date: '2026-09-08' });
  const msgs = db.messagesForSession(r.sessionId);
  assert.ok(msgs[0].ts?.startsWith('2026-09-08'));
  assert.match(db.getSession(r.sessionId)!.label, /日期由你标注/);
});
