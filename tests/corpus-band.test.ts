// 第 12 轮：语料带的数据。每条消息对应它支撑的任务的状态，没被引用的是 null。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import { loadDemo } from '../src/demo.ts';
import { corpusBand } from '../src/engine/band.ts';
import { buildProjectView } from '../src/engine/view.ts';

test('语料带：按时间排，每条消息带上它支撑的任务状态', () => {
  const db = openDb(':memory:');
  const [p1] = loadDemo(db);
  const view = buildProjectView(db, p1);
  const band = corpusBand(db, p1, view);
  assert.equal(band.length, db.messagesForProject(p1).length);
  const statuses = new Set(band.map((b) => b.status));
  assert.ok(statuses.has('done'));
  assert.ok(statuses.has('cancelled'));
  // 按时间排
  const t = band.map((b) => Date.parse(b.at));
  assert.deepEqual(t, [...t].sort((a, b) => a - b));
});
