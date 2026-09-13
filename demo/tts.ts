// 配音：用 ElevenLabs 把旁白念出来，再按时间铺到视频上。
// 每句按“声音 + 模型 + 文字”缓存在 demo/.voice/（不进 git），重录不重复花额度。
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../src/config.ts';

const CACHE = fileURLToPath(new URL('.voice/', import.meta.url));
// 模型和声音是实测挑的：同一句中文念完再转写回来比错字率，multilingual_v2 声调不准（“记账”念成“几章”），v3 最好
const MODEL = 'eleven_v3';
export const VOICE = process.env.VOICE_ID ?? '9lHjugDhwqoxA5MhX0az'; // Anna Su：中文女声，转写回来零错字；换声音用环境变量 VOICE_ID

export type Clip = { file: string; seconds: number };

export async function speak(text: string): Promise<Clip> {
  mkdirSync(CACHE, { recursive: true });
  const file = join(CACHE, `${createHash('sha1').update(`${VOICE}\n${MODEL}\n${text}`).digest('hex').slice(0, 16)}.mp3`);
  if (!existsSync(file)) {
    loadEnv();
    const key = process.env.ELEVENLABS_API_KEY;
    if (!key) throw new Error('配音需要 ELEVENLABS_API_KEY，写在仓库的 .env 里（.env 不会提交）');
    const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: { 'xi-api-key': key, 'content-type': 'application/json' },
      body: JSON.stringify({ text, model_id: MODEL }),
    });
    if (!res.ok) throw new Error(`ElevenLabs 返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
    writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  return { file, seconds: probeSeconds(file) };
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
  const seconds = probeSeconds(video);
  const inputs = ['-i', video, '-f', 'lavfi', '-t', seconds.toFixed(2), '-i', 'anullsrc=r=44100:cl=mono', ...clips.flatMap((c) => ['-i', c.file])];
  const delays = clips.map((c, i) => `[${i + 2}:a]aresample=44100,aformat=channel_layouts=mono,adelay=${Math.round(c.at * 1000)}:all=1[v${i}]`);
  const mix = `[1:a]${clips.map((_, i) => `[v${i}]`).join('')}amix=inputs=${clips.length + 1}:duration=first:normalize=0[a]`;
  ffmpeg([...inputs, '-filter_complex', [...delays, mix].join(';'), '-map', '0:v', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k', out]);
}
