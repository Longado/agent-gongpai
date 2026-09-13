// 示例数据：用样本对话和手写的理想整理结果灌库，不调用模型。没配置模型接口也能先看页面。
import { readFileSync } from 'node:fs';
import type { Db } from './db.ts';
import { loadSample } from './samples.ts';
import { storeEvidence } from './extract/validate.ts';

const SAMPLES = new URL('../samples/', import.meta.url);
/** 展示用的完整示例（记账小程序）：`corpus demo` 和在线演示都用它。 */
export const SHOWCASE = ['S8-showcase'];

export function loadDemo(db: Db, samples = ['S1-plan-change', 'S4-claim-then-fail']): string[] {
  return samples.map((dir) => {
    const { projectId, refs, sample } = loadSample(db, new URL(`${dir}/`, SAMPLES));
    db.raw.prepare('UPDATE projects SET name = ? WHERE id = ?').run(`示例 · ${sample.project.name} · ${dir.split('-')[0]}`, projectId);
    const ideal = JSON.parse(readFileSync(new URL(`${dir}/ideal.json`, SAMPLES), 'utf8'));
    storeEvidence(db, projectId, ideal.evidence, refs, { model: 'demo', promptVersion: 'ideal' });
    db.sessionsForProject(projectId).forEach((s) => db.setExtractedUpto(s.id, db.maxSeq(s.id))); // 示例数据算已整理
    return projectId;
  });
}
