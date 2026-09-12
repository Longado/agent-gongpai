// 用手写的理想整理结果跑记忆引擎：六个样本的预期必须全部满足。
// 这一层不碰大模型，引擎的对错和模型的好坏分开测。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { openDb } from '../src/db.ts';
import { loadSample } from '../src/samples.ts';
import { storeEvidence } from '../src/extract/validate.ts';
import { buildProjectView } from '../src/engine/view.ts';
import { buildContext } from '../src/engine/context.ts';
import { checkExpected } from '../src/check.ts';

const SAMPLES = new URL('../samples/', import.meta.url);

for (const dir of readdirSync(SAMPLES).filter((d) => /^S\d/.test(d))) {
  test(`样本 ${dir}：理想证据下，预期全部满足`, () => {
    const db = openDb(':memory:');
    const { projectId, refs } = loadSample(db, new URL(`${dir}/`, SAMPLES));
    const ideal = JSON.parse(readFileSync(new URL(`${dir}/ideal.json`, SAMPLES), 'utf8'));
    const { dropped } = storeEvidence(db, projectId, ideal.evidence, refs, { model: 'ideal', promptVersion: 'ideal' });
    assert.deepEqual(dropped, []);
    const view = buildProjectView(db, projectId);
    const expected = JSON.parse(readFileSync(new URL(`${dir}/expected.json`, SAMPLES), 'utf8'));
    const results = checkExpected(view, expected, (taskId) => buildContext(db, projectId, taskId));
    const failed = results.filter((r) => !r.pass);
    assert.deepEqual(failed, [], JSON.stringify(failed, null, 1));
  });
}
