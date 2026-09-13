// 录屏共用：启动无头 Chrome、最小的 DevTools 协议客户端、边截图边记时间、把帧排成 ffmpeg 能读的清单。
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type Page = { send: (method: string, params?: object) => Promise<any> };
export type Frame = { t: number; data: string };

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(fn: () => Promise<T | null>, what: string): Promise<T> {
  for (let i = 0; i < 100; i++) {
    const v = await fn().catch(() => null);
    if (v) return v;
    await sleep(100);
  }
  throw new Error(`等不到${what}`);
}

async function connect(wsUrl: string): Promise<Page & { close: () => void }> {
  const ws = new WebSocket(wsUrl);
  const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
  let seq = 0;
  ws.onmessage = (e) => {
    const m = JSON.parse(String(e.data));
    const p = m.id && pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    m.error ? p.rej(new Error(m.error.message)) : p.res(m.result);
  };
  await new Promise((r, j) => { ws.onopen = r; ws.onerror = () => j(new Error('连不上 Chrome')); });
  return {
    send: (method, params = {}) => new Promise((res, rej) => { const id = ++seq; pending.set(id, { res, rej }); ws.send(JSON.stringify({ id, method, params })); }),
    close: () => ws.close(),
  };
}

/** 启动无头 Chrome，返回一个设好尺寸和深色模式的页面；用完调 close。 */
export async function openChrome(profileDir: string, width: number, height: number): Promise<{ page: Page; close: () => void }> {
  const chrome = [process.env.CHROME, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/google-chrome', '/usr/bin/chromium'].find((p) => p && existsSync(p));
  if (!chrome) throw new Error('没找到 Chrome，可以用环境变量 CHROME 指定路径');
  const proc = spawn(chrome, ['--headless=new', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--allow-file-access-from-files', `--user-data-dir=${profileDir}`, '--remote-debugging-port=0', `--window-size=${width},${height}`, 'about:blank'], { stdio: 'ignore' });
  try {
    const devPort = await waitFor(async () => readFileSync(join(profileDir, 'DevToolsActivePort'), 'utf8').split('\n')[0] || null, 'Chrome 启动');
    const target = await waitFor(async () => ((await (await fetch(`http://127.0.0.1:${devPort}/json/list`)).json()) as { type: string; webSocketDebuggerUrl: string }[]).find((t) => t.type === 'page') ?? null, 'Chrome 页面');
    const page = await connect(target.webSocketDebuggerUrl);
    await page.send('Page.enable');
    await page.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await page.send('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: 'dark' }] });
    return { page, close: () => { page.close(); proc.kill(); } };
  } catch (err) {
    proc.kill();
    throw err;
  }
}

/** 在页面里执行一段表达式，返回结果；页面报错就抛出。 */
export async function evaluate(page: Page, expr: string): Promise<any> {
  const r = await page.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result.value;
}

/** 边操作边截图（无损 PNG，停住的帧完全相同，GIF 才压得小），记下每帧的时间，合成时按真实间隔排。 */
export function startRecording(page: Page): { stop: () => Promise<Frame[]> } {
  const frames: Frame[] = [];
  let on = true;
  const loop = (async () => {
    while (on) {
      const t = Date.now();
      const { data } = await page.send('Page.captureScreenshot', { format: 'png' });
      frames.push({ t, data });
      await sleep(Math.max(0, 80 - (Date.now() - t)));
    }
  })();
  return { stop: async () => { on = false; await loop; return frames; } };
}

/** 把帧写成图片，返回 ffmpeg concat 清单的路径。 */
export function writeFrames(frames: Frame[], dir: string): string {
  mkdirSync(dir, { recursive: true });
  const name = (i: number) => join(dir, `${String(i).padStart(5, '0')}.png`);
  const list = frames.map((f, i) => {
    writeFileSync(name(i), Buffer.from(f.data, 'base64'));
    const next = frames[i + 1]?.t ?? f.t + 1500;
    return `file '${name(i)}'\nduration ${((next - f.t) / 1000).toFixed(3)}`;
  });
  const file = join(dir, 'list.txt');
  writeFileSync(file, `${list.join('\n')}\nfile '${name(frames.length - 1)}'\n`);
  return file;
}
