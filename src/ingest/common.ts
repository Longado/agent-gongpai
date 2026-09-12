// 各来源读取器共用的小工具。
import { execFileSync } from 'node:child_process';
import { openSync, readSync, fstatSync, closeSync } from 'node:fs';

const rootCache = new Map<string, string>();

/** 工作目录所在的 git 仓库根目录；不是仓库或目录已不存在时，返回原目录。 */
export function gitRoot(dir: string): string {
  const hit = rootCache.get(dir);
  if (hit) return hit;
  let root = dir;
  try {
    root = execFileSync('git', ['-C', dir, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() || dir;
  } catch {
    // 不是 git 仓库或目录不存在：按原目录归属
  }
  rootCache.set(dir, root);
  return root;
}

/** 从字节位置 from 读到文件末尾，只返回完整的行，以及读完后新的位置。 */
export function readNewLines(file: string, from: number): { lines: string[]; next: number; reset: boolean } {
  const fd = openSync(file, 'r');
  try {
    const size = fstatSync(fd).size;
    const reset = size < from; // 文件变短：被重写过，从头再读，重复的消息靠编号去重
    const start = reset ? 0 : from;
    if (size === start) return { lines: [], next: start, reset };
    const buf = Buffer.alloc(size - start);
    readSync(fd, buf, 0, buf.length, start);
    const lastNl = buf.lastIndexOf(0x0a);
    if (lastNl < 0) return { lines: [], next: start, reset };
    const text = buf.subarray(0, lastNl).toString('utf8');
    return { lines: text.split('\n').filter((l) => l.trim() !== ''), next: start + lastNl + 1, reset };
  } finally {
    closeSync(fd);
  }
}

/** 只读文件开头一段，找第一个出现的字段，用来在不读全文的情况下判断归属。 */
export function peekHead(file: string, bytes = 256 * 1024): string[] {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(Math.min(bytes, fstatSync(fd).size));
    readSync(fd, buf, 0, buf.length, 0);
    return buf.toString('utf8').split('\n').slice(0, -1);
  } finally {
    closeSync(fd);
  }
}

export function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[已截断 ${text.length - max} 字]`;
}

export const TOOL_ERROR_MAX = 500;
