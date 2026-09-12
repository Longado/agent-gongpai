// 实测发现：续接上下文把整个项目的决定都带上了，和当前任务无关的也在里面。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import type { Evidence, Message } from '../src/contracts.ts';
import { storeEvidence } from '../src/extract/validate.ts';
import { buildProjectView } from '../src/engine/view.ts';
import { buildContext } from '../src/engine/context.ts';

test('续接上下文只带同一段会话里的决定；待验证任务的完成标准是说明验证方法和结果', () => {
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: 'p', goal: null, dirs: [] });
  const refs = new Map<string, Message>();
  const add = (sid: string, ref: string, role: Message['role'], text: string, ts: string) => {
    db.upsertSession({ id: sid, source: 'claude_code', label: 'Claude Code', projectId, cwd: null, title: sid, coverage: 'full' });
    const m: Message = { id: `${sid}:${ref}`, sessionId: sid, seq: refs.size, role, text, ts, capturedAt: ts };
    refs.set(ref, m);
    db.insertMessages([m]);
  };
  add('a', 'm1', 'user', '做报告，用 stdlib 生成 HTML', '2026-09-10T10:00:00+08:00');
  add('a', 'm2', 'assistant', '报告做好了', '2026-09-10T11:00:00+08:00');
  add('b', 'm3', 'user', '清单只覆盖四个家族', '2026-09-10T12:00:00+08:00');
  const ev = (task: Evidence['task'], kind: Evidence['kind'], cite: string[], detail: string): Evidence => ({ reasoning: 'r', task, kind, cite, detail });
  storeEvidence(db, projectId, [
    ev({ newName: '报告' }, 'started', ['m1'], '做报告'),
    ev('none', 'decision_adopt', ['m1'], '用 stdlib 生成 HTML'),
    ev({ newName: '报告' }, 'ai_claims_done', ['m2'], '报告做好了'),
    ev('none', 'decision_adopt', ['m3'], '清单只覆盖四个家族'),
  ], refs, { model: 't', promptVersion: 't' });
  const task = buildProjectView(db, projectId).tasks[0];
  const ctx = buildContext(db, projectId, task.id);
  assert.match(ctx, /stdlib/);
  assert.doesNotMatch(ctx, /四个家族/);
  assert.match(ctx.split('\n').find((l) => l.startsWith('本轮请做'))!, /验证方法和结果/);
});
