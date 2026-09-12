// 实测发现：推理模型在长批次上输出被截断，整批失败后后面全部卡住。改为失败时对半拆开重试。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDb } from '../src/db.ts';
import type { Message } from '../src/contracts.ts';
import { extractProject } from '../src/extract/run.ts';
import type { ModelCall } from '../src/extract/model.ts';

test('一批失败时对半拆开重试；拆小之后能成功就不算失败', async () => {
  const db = openDb(':memory:');
  const projectId = db.createProject({ name: 'p', goal: null, dirs: [] });
  db.upsertSession({ id: 's1', source: 'claude_code', label: 'Claude Code', projectId, cwd: null, title: null, coverage: 'full' });
  const msgs: Message[] = Array.from({ length: 4 }, (_, i) => ({ id: `s1:${i}`, sessionId: 's1', seq: i, role: 'user', text: `第 ${i} 条`, ts: `2026-09-10T10:0${i}:00+08:00`, capturedAt: 'x' }));
  db.insertMessages(msgs);
  // 假模型：一次超过 2 条消息就“截断”，返回坏 JSON
  const model: ModelCall = { name: 'fake', async call(_s, user) {
    const n = (user.match(/^\[m\d+\]/gm) ?? []).length;
    return n > 2 ? '{"evidence": [' : JSON.stringify({ evidence: [{ reasoning: 'r', task: { newName: '任务' }, kind: 'started', cite: ['m1'], detail: 'd' }] });
  } };
  const r = await extractProject(db, projectId, model);
  assert.equal(r.failed, 0);
  assert.equal(r.stored, 2);
  assert.equal(db.getSession('s1')!.extractedUpto, 3);
});
