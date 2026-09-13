// 桌面窗口：后台启动本地服务，再用 Chrome 的应用模式开一个独立窗口（没有地址栏和标签页）。
// 没装 Chrome 就用默认浏览器打开。
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, rmSync, openSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { platform } from 'node:os';
import { fileURLToPath } from 'node:url';
import { homeDir } from './config.ts';

const pidFile = () => join(homeDir(), 'server.pid');
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function alive(port: number): Promise<boolean> {
  try {
    return (await fetch(`http://127.0.0.1:${port}/api/state`, { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}

export async function startServer(port: number): Promise<'running' | 'started'> {
  if (await alive(port)) return 'running';
  mkdirSync(homeDir(), { recursive: true });
  const log = openSync(join(homeDir(), 'server.log'), 'a');
  const child = spawn(process.execPath, ['--no-warnings', fileURLToPath(new URL('./cli.ts', import.meta.url)), 'serve', '--port', String(port)], {
    detached: true, stdio: ['ignore', log, log], env: process.env,
  });
  child.unref();
  writeFileSync(pidFile(), JSON.stringify({ pid: child.pid, port }));
  // 每 200 毫秒试一次，10 秒还没起来就报错。这是启动超时，不是业务上的界限
  for (let i = 0; i < 50; i++) {
    if (await alive(port)) return 'started';
    await sleep(200);
  }
  throw new Error(`本地服务没有起来，看日志：${join(homeDir(), 'server.log')}`);
}

export function stopServer(): boolean {
  if (!existsSync(pidFile())) return false;
  const { pid } = JSON.parse(readFileSync(pidFile(), 'utf8'));
  rmSync(pidFile(), { force: true });
  try {
    process.kill(pid);
    return true;
  } catch {
    return false; // 进程已经不在了
  }
}

const CHROME: Record<string, string[]> = {
  darwin: ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/Applications/Chromium.app/Contents/MacOS/Chromium', '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge'],
  linux: ['/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/microsoft-edge'],
  win32: [],
};

export function openWindow(url: string): string {
  const chrome = (CHROME[platform()] ?? []).find((p) => existsSync(p));
  if (chrome) {
    spawn(chrome, [`--app=${url}`], { detached: true, stdio: 'ignore' }).unref();
    return '独立窗口';
  }
  const opener = platform() === 'darwin' ? ['open', [url]] : platform() === 'win32' ? ['cmd', ['/c', 'start', '', url]] : ['xdg-open', [url]];
  spawn(opener[0] as string, opener[1] as string[], { detached: true, stdio: 'ignore' }).unref();
  return '默认浏览器';
}
