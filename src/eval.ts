// 用真模型跑六个样本，对照预期。硬红线有一条没过就算失败。
import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { openDb } from './db.ts';
import { loadSample } from './samples.ts';
import { extractProject, PROMPT_VERSION } from './extract/run.ts';
import type { ModelCall } from './extract/model.ts';
import { buildProjectView } from './engine/view.ts';
import { buildContext } from './engine/context.ts';
import { checkExpected, type CheckResult } from './check.ts';

const SAMPLES = new URL('../samples/', import.meta.url);

export interface SampleReport {
  sample: string;
  results: CheckResult[];
  batches: number;
  failedBatches: number;
  dropped: number;
  seconds: number;
}

export async function runEval(model: ModelCall, only?: string): Promise<{ reports: SampleReport[]; outDir: string }> {
  const dirs = readdirSync(SAMPLES).filter((d) => /^S\d/.test(d) && (!only || d.startsWith(only)));
  const outDir = `data/eval/${new Date().toISOString().replace(/[:.]/g, '-')}`;
  mkdirSync(outDir, { recursive: true });
  const reports = await Promise.all(dirs.map(async (dir) => {
    const t0 = Date.now();
    const db = openDb(':memory:');
    const { projectId } = loadSample(db, new URL(`${dir}/`, SAMPLES));
    const r = await extractProject(db, projectId, model);
    const view = buildProjectView(db, projectId);
    const expected = JSON.parse(readFileSync(new URL(`${dir}/expected.json`, SAMPLES), 'utf8'));
    const results = checkExpected(view, expected, (taskId) => buildContext(db, projectId, taskId));
    writeFileSync(`${outDir}/${dir}.json`, JSON.stringify({ model: model.name, prompt: PROMPT_VERSION, extract: r, evidence: db.evidenceForProject(projectId), view, results }, null, 1));
    return { sample: dir, results, batches: r.batches, failedBatches: r.failed, dropped: r.dropped.length, seconds: Math.round((Date.now() - t0) / 1000) };
  }));
  return { reports, outDir };
}

export function formatReport(reports: SampleReport[]): { text: string; redLineFailed: boolean } {
  const lines: string[] = [];
  let redLineFailed = false;
  for (const r of reports) {
    const pass = r.results.filter((x) => x.pass).length;
    const red = r.results.filter((x) => x.redLine && !x.pass);
    if (red.length || r.failedBatches) redLineFailed = true;
    lines.push(`${r.sample.padEnd(20)} ${String(pass).padStart(2)}/${r.results.length} 通过  硬红线${red.length ? `失败 ${red.length}` : '全过'}  批次 ${r.batches}${r.failedBatches ? `（失败 ${r.failedBatches}）` : ''}  丢弃证据 ${r.dropped}  ${r.seconds} 秒`);
    for (const x of r.results.filter((y) => !y.pass)) lines.push(`    ${x.redLine ? '✗ 红线' : '· 不一致'}  ${x.check}：${x.detail}`);
  }
  return { text: lines.join('\n'), redLineFailed };
}
