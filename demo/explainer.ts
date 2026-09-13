// 讲解视频，四分钟左右，中文配音：理念卡片 → 终端 → 桌面窗口 → 架构图 → 接下来。输出 docs/media/explainer.mp4。
// 运行：npm run record:explainer。需要 vhs、Chrome、ffmpeg，以及仓库 .env 里的 ELEVENLABS_API_KEY（.env 不会提交）。
// 每段画面停留多久由配音长度决定，所以声音和画面对得上。
// 改文案：卡片、终端、架构图的旁白都在下面；窗口部分的旁白在 demo/window.ts 的分镜里；卡片画面在 demo/slides.html。
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { evaluate, openChrome, sleep, startRecording, waitFor, writeFrames } from './chrome.ts';
import { ffmpeg, mixVoice, probeSeconds, speak, type Clip } from './tts.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const OUT = join(ROOT, 'docs', 'media', 'explainer.mp4');

// ---------- 旁白 ----------
const INTRO: [slide: string, voice: string][] = [
  ['title', '用 AI 做项目，难的常常不是开头，而是隔了几天，再接着做下去。'],
  ['scatter', '需求在网页上和 Gemini 聊，功能在 Claude Code 里写，bug 交给 Codex 去修。过两天回来，得翻好几段长对话，才想得起做到哪了。'],
  ['questions', '每次回来都在问：哪些真做完了，哪些只是 AI 说做完了？现在卡在哪，下一步做什么？'],
  ['evidence', 'Working Corpus 的第一条规矩，是只认证据。AI 说做完了，只算待验证；你说试过了、没问题，才算完成。每个状态，都能点回那句原话。'],
  ['judgment', '大模型在这里只做一件事：读对话，标出哪句话说明了哪个任务发生了什么，而且必须引用原话。状态、规划版本、下一步，都由代码按规则算。同样的对话，算出来的结果永远一样。'],
  ['people', '很多记忆工具，是把记忆写回给 AI。我们先把现场交给你，一眼看清楚；要换工具接着干，再给下一个 AI 一段准确的背景。'],
  ['local', '对话都留在你的电脑上。整理时只发送绑定项目的对话，发之前先问你；密钥在读取时就替换掉了。'],
  ['example', '来看一个例子：一个记账小程序，五天，六段对话，来自三个工具。'],
];
const TERMINAL_VOICE = [
  '在终端里敲 corpus，每个项目一行：各个状态有几项，下一步做什么。',
  'corpus show 看一个项目的现场。规划改过两版，每个任务都写着依据：是你确认的、原文写明的，还是 AI 自己说的。',
  '要换个工具接着做，corpus context 给出一段背景：之前失败过，要先确认完成条件，哪些事不要做。',
];
const ARCH_VOICE = '整体就是五步：读取你用过的工具，按代码目录归到项目；大模型把消息标成证据，代码再验一遍；最后按规则折叠成现场，交给终端、窗口，和下一个 AI。';
const OUTRO: [slide: string, voice: string][] = [
  ['next', '接下来想做两件事：让证据也能来自 git 提交和测试结果；再给每个 AI 记一张工牌，看看谁说的“做完了”最靠谱。'],
  ['end', 'Working Corpus 已经开源。在线演示不用安装，打开就能看。'],
];

type Beat = { voice: string; js: string };

/** 打开一个页面，逐拍执行动作并念对应的旁白，每拍停到念完再多一秒；输出带配音的 MP4。 */
async function recordBeats(url: string, size: [number, number], prep: string, beats: Beat[], out: string, tmp: string): Promise<void> {
  const clips: Clip[] = [];
  for (const b of beats) clips.push(await speak(b.voice)); // 一句一句请求：入门套餐最多同时 3 个
  const chrome = await openChrome(join(tmp, `chrome-${beats.length}-${Date.now()}`), size[0], size[1]);
  try {
    const { page } = chrome;
    await page.send('Page.navigate', { url });
    await waitFor(async () => (await evaluate(page, 'document.readyState === "complete"')) || null, '页面加载');
    await evaluate(page, 'document.fonts.ready.then(() => true)');
    if (prep) await evaluate(page, prep);
    await sleep(400);
    const rec = startRecording(page);
    const starts: number[] = [];
    for (const [i, b] of beats.entries()) {
      const start = Date.now();
      starts.push(start);
      await evaluate(page, b.js);
      await sleep(Math.max(1500, start + clips[i].seconds * 1000 + 700 - Date.now()));
    }
    const frames = await rec.stop();
    const list = writeFrames(frames, join(tmp, `frames-${Date.now()}`));
    const silent = join(tmp, `silent-${Date.now()}.mp4`);
    ffmpeg(['-f', 'concat', '-safe', '0', '-i', list, '-vf', 'fps=25,format=yuv420p', '-c:v', 'libx264', '-crf', '20', silent]);
    mixVoice(silent, clips.map((c, i) => ({ file: c.file, at: (starts[i] - frames[0].t) / 1000 + 0.3 })), out);
  } finally {
    chrome.close();
  }
}

const slides = (list: [string, string][]): Beat[] => list.map(([id, voice]) => ({ voice, js: `show(${JSON.stringify(id)})` }));
const slidesUrl = `${pathToFileURL(join(ROOT, 'demo', 'slides.html')).href}#none`;

const tmp = mkdtempSync(join(tmpdir(), 'corpus-explainer-'));
const run = (cmd: string, args: string[]) => {
  const r = spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  if (r.status !== 0) throw new Error(`${cmd} 失败：${(r.stderr || r.stdout).slice(-400)}`);
};

try {
  // 1. 开场和理念：卡片
  await recordBeats(slidesUrl, [1280, 800], '', slides(INTRO), join(tmp, 'intro.mp4'), tmp);

  // 2. 终端：停留换成“念完再停一秒”，录好后找出三次输出出现的时刻，把配音铺上去
  const tClips: Clip[] = [];
  for (const text of TERMINAL_VOICE) tClips.push(await speak(text));
  let n = 0;
  const tape = readFileSync(join(ROOT, 'demo', 'terminal.tape'), 'utf8')
    .replace(/^Output .*$/gm, '')
    .replace(/^(# voice-hold.*\n)Sleep (\d+)s$/gm, (_, mark: string) => `${mark}Sleep ${Math.ceil(tClips[n++].seconds + 0.8)}s`)
    .replace(/^Set Shell/m, `Output ${JSON.stringify(join(tmp, 'terminal.mp4'))}\nSet Shell`);
  if (n !== TERMINAL_VOICE.length) throw new Error(`terminal.tape 里的 voice-hold 标记有 ${n} 个，旁白有 ${TERMINAL_VOICE.length} 句`);
  writeFileSync(join(tmp, 'terminal.tape'), tape);
  run('vhs', [join(tmp, 'terminal.tape')]);
  const scene = spawnSync('ffmpeg', ['-v', 'info', '-i', join(tmp, 'terminal.mp4'), '-vf', "select='gt(scene,0.015)',showinfo", '-f', 'null', '-'], { encoding: 'utf8' });
  const changes = [...scene.stderr.matchAll(/pts_time:([\d.]+)/g)].map((m) => Number(m[1]));
  // 画面大变化依次是：输出、清屏、输出、清屏、输出
  if (changes.length !== 5) throw new Error(`终端录屏里认出 ${changes.length} 次画面切换，应该是 5 次：${changes.join(', ')}`);
  mixVoice(join(tmp, 'terminal.mp4'), tClips.map((c, i) => ({ file: c.file, at: changes[i * 2] + 0.3 })), join(tmp, 'terminal-voice.mp4'));

  // 3. 桌面窗口：分镜按配音停留
  run(process.execPath, ['--no-warnings', join(ROOT, 'demo', 'window.ts'), '--voice', '--out', tmp]);

  // 4. 架构图：五列跟着旁白依次亮起
  const archClip = await speak(ARCH_VOICE);
  const step = Math.round((archClip.seconds * 1000) / 5.5);
  const hide = `(() => { const s = document.createElement('style'); s.textContent = '.flow > *, footer { opacity: 0; transform: translateY(10px); transition: opacity .6s, transform .6s } .flow > .shown, footer.shown { opacity: 1; transform: none }'; document.head.append(s); })()`;
  const reveal = `(() => { [...document.querySelectorAll('.flow > *')].forEach((el, i) => setTimeout(() => el.classList.add('shown'), Math.ceil(i / 2) * ${step} + 300)); setTimeout(() => document.querySelector('footer').classList.add('shown'), ${step * 5}); })()`;
  await recordBeats(pathToFileURL(join(ROOT, 'docs', 'diagram', 'architecture.html')).href, [1600, 720], hide, [{ voice: ARCH_VOICE, js: reveal }], join(tmp, 'arch.mp4'), tmp);

  // 5. 接下来和片尾
  await recordBeats(slidesUrl, [1280, 800], '', slides(OUTRO), join(tmp, 'outro.mp4'), tmp);

  // 6. 统一成 1280×800，淡入淡出后接起来
  const parts = [
    { file: 'intro.mp4', bg: '0x0B0C0F' },
    { file: 'terminal-voice.mp4', bg: '0x1E1E2E' },
    { file: 'window-voice.mp4', bg: '0x0B0C0F' },
    { file: 'arch.mp4', bg: '0x0B0C0F' },
    { file: 'outro.mp4', bg: '0x0B0C0F' },
  ];
  const filters = parts.flatMap((p, i) => {
    const d = probeSeconds(join(tmp, p.file));
    console.log(`  ${p.file.padEnd(20)} ${d.toFixed(1)} 秒`);
    return [
      `[${i}:v]scale=1280:800:force_original_aspect_ratio=decrease:flags=lanczos,pad=1280:800:(ow-iw)/2:(oh-ih)/2:color=${p.bg},fps=25,format=yuv420p,setsar=1,fade=t=in:st=0:d=0.4,fade=t=out:st=${(d - 0.4).toFixed(2)}:d=0.4[v${i}]`,
      `[${i}:a]aformat=sample_rates=44100:channel_layouts=mono,afade=t=in:st=0:d=0.2,afade=t=out:st=${(d - 0.3).toFixed(2)}:d=0.3[a${i}]`,
    ];
  });
  const concat = `${parts.map((_, i) => `[v${i}][a${i}]`).join('')}concat=n=${parts.length}:v=1:a=1[v][araw];[araw]loudnorm=I=-16:TP=-1.5:LRA=11,aresample=44100[a]`; // 响度统一，峰值留余量不破音
  ffmpeg([...parts.flatMap((p) => ['-i', join(tmp, p.file)]), '-filter_complex', [...filters, concat].join(';'), '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '22', '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', OUT]);
  const total = probeSeconds(OUT);
  console.log(`已生成 docs/media/explainer.mp4：${Math.floor(total / 60)} 分 ${Math.round(total % 60)} 秒`);
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
