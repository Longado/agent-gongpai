// 第 19 轮：扩展的抽取脚本在真实浏览器 DOM 上跑（无头 Chrome），页面结构照 Gemini 的元素名写成。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CHROME = ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find(existsSync);
const PAGE = fileURLToPath(new URL('./fixtures/gemini/page.html', import.meta.url));

test('抽取：提问和回复按顺序、回复只取正文、标题取自侧栏', { skip: CHROME ? false : '本机没有 Chrome' }, () => {
  const r = spawnSync(CHROME!, ['--headless=new', '--disable-gpu', '--no-sandbox', '--allow-file-access-from-files', '--virtual-time-budget=2000', '--dump-dom', `file://${PAGE}`], { encoding: 'utf8' });
  const m = r.stdout.match(/<title>RESULT:(.*?)<\/title>/s);
  assert.ok(m, '页面没有输出结果');
  const out = JSON.parse(m![1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'));
  assert.equal(out.title, '记账小程序需求');
  assert.deepEqual(out.turns.map((t: any) => t.role), ['user', 'assistant', 'user', 'assistant']);
  assert.equal(out.turns[0].text, '第一版要有记账录入、分类统计。');
  assert.match(out.turns[1].text, /录入/);
  assert.doesNotMatch(JSON.stringify(out.turns), /不该被读进去/);
  assert.equal(out.partial, false);
});
