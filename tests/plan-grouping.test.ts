// 实测发现：同一次决定里的“取消”和“新增”引用的消息不完全相同，被拆成了两版规划。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import type { Evidence, Message } from '../src/contracts.ts';
import { storeEvidence } from '../src/extract/validate.ts';
import { buildProjectView } from '../src/engine/view.ts';

test('引用了同一条消息的规划变更属于同一版', () => {
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: 'p', goal: null, dirs: [] });
  db.upsertSession({ id: 's1', source: 'claude_code', label: 'Claude Code', projectId, cwd: null, title: null, coverage: 'full' });
  const rows: [string, Message['role'], string, string][] = [
    ['m1', 'user', '第一版：录入、云同步', '2026-09-08T10:00:00+08:00'],
    ['m7', 'user', '云同步不做了，改成本地备份', '2026-09-11T09:00:00+08:00'],
    ['m8', 'assistant', '好的，去掉云同步，新增本地备份', '2026-09-11T09:01:00+08:00'],
  ];
  const refs = new Map<string, Message>();
  rows.forEach(([ref, role, text, ts], i) => refs.set(ref, { id: `s1:${ref}`, sessionId: 's1', seq: i, role, text, ts, capturedAt: ts }));
  db.insertMessages([...refs.values()]);
  const ev = (task: Evidence['task'], kind: Evidence['kind'], cite: string[]): Evidence => ({ reasoning: 'r', task, kind, cite, detail: '' });
  storeEvidence(db, projectId, [
    ev({ newName: '录入' }, 'plan_item', ['m1']), ev({ newName: '云同步' }, 'plan_item', ['m1']),
    ev({ newName: '云同步' }, 'plan_cancel', ['m7']), ev({ newName: '本地备份' }, 'plan_add', ['m7', 'm8']),
  ], refs, { model: 't', promptVersion: 't' });
  const v = buildProjectView(db, projectId).plan.versions;
  assert.equal(v.length, 2);
  assert.deepEqual(v[1].items.map((i) => `${i.name}:${i.change}`), ['录入:kept', '云同步:cancelled', '本地备份:added']);
});
