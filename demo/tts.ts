// 配音：用 ElevenLabs 把一整段旁白一口气念完，同时拿回每个字的时间点，用来对齐画面和生成字幕。
// 每段按“声音 + 模型 + 文字”缓存在 demo/.voice/（不进 git），重录不重复花额度。
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/config.ts';

const CACHE = fileURLToPath(new URL('.voice/', import.meta.url));
// 模型和声音是实测挑的：同一句中文念完再转写回来比错字率，multilingual_v2 声调不准（“记账”念成“几章”），v3 最好
const MODEL = 'eleven_v3';
export const VOICE = process.env.VOICE_ID ?? '9lHjugDhwqoxA5MhX0az'; // Anna Su：中文女声，转写回来零错字；换声音用环境变量 VOICE_ID

export type Cue = { start: number; end: number; text: string };
/** 一段配音：音频文件、总时长、每个分句从第几秒开始念、字幕。 */
export type Paragraph = { file: string; seconds: number; partStarts: number[]; cues: Cue[] };

const CJK = '[\\u3400-\\u9fff\\u3000-\\u303f\\uff00-\\uffef“”‘’]';
/** 字幕里去掉中文和英文之间的空格，读起来是连贯的一段。英文词内部的空格保留。
 * 送去配音的文字不去：实测去掉后“Claude Code”会念成“CodeCode”，而留着空格并不会多出停顿。 */
export const tidy = (s: string) => s.replace(new RegExp(`(?<=${CJK})\\s+|\\s+(?=${CJK})`, 'g'), '').trim();

type Alignment = { characters: string[]; character_start_times_seconds: number[]; character_end_times_seconds: number[] };

export async function speakParagraph(parts: string[]): Promise<Paragraph> {
  const clean = parts.map((p) => p.replace(/\s+/g, ' ').trim());
  const text = clean.join('');
  mkdirSync(CACHE, { recursive: true });
  const base = join(CACHE, createHash('sha1').update(`${VOICE}\n${MODEL}\nts\n${text}`).digest('hex').slice(0, 16));
  if (!existsSync(`${base}.json`)) {
    loadEnv();
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error('配音需要 ELEVENLABS_API_KEY，写在仓库的 .env 里（.env 不会提交）');
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}/with-timestamps?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: MODEL }),
    });
    if (!res.ok) throw new Error(`ElevenLabs 返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
    const body = (await res.json()) as { audio_base64: string; alignment: Alignment };
    writeFileSync(`${base}.mp3`, Buffer.from(body.audio_base64, 'base64'));
    writeFileSync(`${base}.json`, JSON.stringify(body.alignment));
  }
  const align = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as Alignment;
  if (align.characters.join('') !== text) throw new Error('配音返回的时间点和文字对不上，删掉 demo/.voice/ 里的缓存重试');
  const starts = align.character_start_times_seconds;
  let offset = 0;
  const partStarts = clean.map((p) => { const t = starts[offset] ?? 0; offset += p.length; return t; });
  return { file: `${base}.mp3`, seconds: probeSeconds(`${base}.mp3`), partStarts, cues: toCues(text, align) };
}

const MAX = 22; // 一条字幕最多多少字，超过就在逗号处断开
/** 按句号、问号、分号切字幕；太长的句子再在逗号、冒号处断开。句末的逗号句号不显示。 */
export function toCues(text: string, a: Alignment): Cue[] {
  const chunks: [number, number][] = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    const end = /[。？！；]/.test(c) || i === text.length - 1;
    const soft = /[，：]/.test(c) && i + 1 - from >= 8 && nextBreak(text, i + 1) - from > MAX;
    if (end || soft) { chunks.push([from, i]); from = i + 1; }
  }
  const cues = chunks.map(([s, e]) => ({
    start: a.character_start_times_seconds[s],
    end: a.character_end_times_seconds[e],
    text: tidy(text.slice(s, e + 1)).replace(/[，。；：]$/, ''),
  })).filter((c) => c.text);
  // 两条之间空得很短就接上，免得字幕闪一下
  return cues.map((c, i) => ({ ...c, end: cues[i + 1] && cues[i + 1].start - c.end < 0.5 ? cues[i + 1].start : c.end + 0.3 }));
}

/** 从 i 开始，下一个句末标点的位置（用来判断这句剩下的部分会不会太长）。 */
function nextBreak(text: string, i: number): number {
  for (let j = i; j < text.length; j++) if (/[。？！；]/.test(text[j])) return j + 1;
  return text.length;
}

export function probeSeconds(file: string): number {
  const r = spawnSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file], { encoding: 'utf8' });
  const s = Number(r.stdout.trim());
  if (!Number.isFinite(s) || s <= 0) throw new Error(`读不出时长：${file}`);
  return s;
}

export function ffmpeg(args: string[]): void {
  const r = spawnSync('ffmpeg', ['-v', 'error', '-y', ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr || '没找到 ffmpeg');
}

/** 把几段配音按起始秒数铺到视频上，视频原样保留，输出带单声道音轨的 MP4。 */
export function mixVoice(video: string, clips: { file: string; at: number }[], out: string): void {
  // 配音比画面长时，画面停在最后一帧等它念完，不截掉最后一句
  const need = Math.max(...clips.map((c) => c.at + probeSeconds(c.file))) + 0.8;
  if (need > probeSeconds(video)) {
    const longer = video.replace(/\.mp4$/, '-long.mp4');
    ffmpeg(['-i', video, '-vf', `tpad=stop_mode=clone:stop_duration=${(need - probeSeconds(video)).toFixed(2)}`, '-c:v', 'libx264', '-crf', '20', longer]);
    video = longer;
  }
  const seconds = probeSeconds(video);
  const inputs = ['-i', video, '-f', 'lavfi', '-t', seconds.toFixed(2), '-i', 'anullsrc=r=44100:cl=mono', ...clips.flatMap((c) => ['-i', c.file])];
  const delays = clips.map((c, i) => `[${i + 2}:a]aresample=44100,aformat=channel_layouts=mono,adelay=${Math.round(c.at * 1000)}:all=1[v${i}]`);
  const mix = `[1:a]${clips.map((_, i) => `[v${i}]`).join('')}amix=inputs=${clips.length + 1}:duration=first:normalize=0[a]`;
  ffmpeg([...inputs, '-filter_complex', [...delays, mix].join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', out]);
}
