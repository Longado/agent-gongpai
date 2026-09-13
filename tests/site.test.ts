// 在线演示站点：生成的静态文件够页面在只读模式下跑完所有页面。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

test('生成在线演示：示例项目的页面数据、原文、续接上下文齐全，资源用相对路径', () => {
  const out = mkdtempSync(join(tmpdir(), 'corpus-site-'));
  const r = spawnSync(process.execPath, ['--no-warnings', join(ROOT, 'scripts/build-site.ts'), out], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const json = (f: string) => JSON.parse(readFileSync(join(out, 'data', f), 'utf8'));
  const { projects } = json('state.json');
  assert.equal(projects.length, 1);
  const id = projects[0].id;
  const page = json(`p/${id}.json`);
  assert.ok(page.view.tasks.length >= 5, '示例项目应该有完整的任务');
  const msgIds = new Set(json(`p/${id}.messages.json`).map((m: { id: string }) => m.id));
  for (const e of Object.values(page.evidence) as { cite: string[] }[]) for (const c of e.cite) assert.ok(msgIds.has(c), `证据引用的原文 ${c} 要在导出里`);
  const ctx = json(`p/${id}.context.json`);
  for (const t of page.view.tasks) assert.match(ctx[t.id], /^# 继续/);
  const html = readFileSync(join(out, 'index.html'), 'utf8');
  assert.match(html, /name="corpus-static"/);
  assert.doesNotMatch(html + readFileSync(join(out, 'app.js'), 'utf8'), /(src|href)="\/(?!\/)/, 'GitHub Pages 在子路径下，资源不能用根路径');
});
