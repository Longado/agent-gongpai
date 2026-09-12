// MCP 连接器：让 Claude Code、Codex、Cursor 这类工具直接读项目现场和续接上下文。
// 手写 JSON-RPC 2.0，走 stdio：一行一条消息。只读：不调用大模型，不写数据库。
// stdout 只能写协议消息，其他输出一律走 stderr。
import { createInterface } from 'node:readline';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { STATUS_LABEL, type TaskView } from './contracts.ts';
import type { Db } from './db.ts';
import { buildProjectView } from './engine/view.ts';
import { buildContext, planLine } from './engine/context.ts';
import { gitRoot } from './ingest/common.ts';

const VERSION = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }).version;
const DEFAULT_PROTOCOL = '2025-06-18';

type Id = string | number | null;
export type McpResponse =
  | { jsonrpc: '2.0'; id: Id; result: unknown }
  | { jsonrpc: '2.0'; id: Id; error: { code: number; message: string } };
interface ToolResult { content: { type: 'text'; text: string }[]; isError?: true }

const ok = (id: Id, result: unknown): McpResponse => ({ jsonrpc: '2.0', id, result });
const fail = (id: Id, code: number, message: string): McpResponse => ({ jsonrpc: '2.0', id, error: { code, message } });
const text = (t: string): ToolResult => ({ content: [{ type: 'text', text: t }] });
const problem = (t: string): ToolResult => ({ ...text(t), isError: true });

const shortId = (id: string) => id.split('/').at(-1)!;

/** 先按编号或全名精确找，找不到再按名字包含找。返回全部命中，由调用方判断 0 个、1 个还是多个。 */
function pick<T extends { name: string }>(items: T[], query: string, ids: (t: T) => string[]): T[] {
  const q = query.trim();
  const exact = items.filter((t) => t.name === q || ids(t).some((i) => i.toLowerCase() === q.toLowerCase()));
  return exact.length ? exact : items.filter((t) => t.name.includes(q));
}

function projectListing(db: Db): string {
  const projects = db.listProjects();
  if (!projects.length) return '还没有项目。先在终端运行 npm run corpus -- project add "项目名" --dir <代码目录> 建一个。';
  return projects.map((p) => `- ${p.name}（${p.id}）${p.dirs.length ? `：${p.dirs.join('，')}` : '：没有绑定目录'}`).join('\n');
}

/** 找项目：传了就按编号或名字找；没传就看当前目录绑定到哪个项目。 */
function findProject(db: Db, query: string | undefined, cwd: string): { id: string } | { error: ToolResult } {
  if (!query) {
    const id = db.projectForDir(gitRoot(cwd)) ?? db.projectForDir(cwd);
    return id ? { id } : { error: problem(`当前目录（${cwd}）没有绑定到任何项目。请用 project 参数指定项目名或编号。已有项目：\n${projectListing(db)}`) };
  }
  const hits = pick(db.listProjects(), query, (p) => [p.id]);
  if (hits.length === 1) return { id: hits[0].id };
  if (hits.length === 0) return { error: problem(`没有找到项目「${query}」。已有项目：\n${projectListing(db)}`) };
  return { error: problem(`「${query}」匹配到多个项目，请写全名或编号：\n${hits.map((p) => `- ${p.name}（${p.id}）`).join('\n')}`) };
}

const taskLine = (t: TaskView) => `${STATUS_LABEL[t.status]} · ${shortId(t.id)} ${t.name} — ${t.basisNote}`;

function projectStatus(db: Db, projectId: string): string {
  const project = db.getProject(projectId)!;
  const view = buildProjectView(db, projectId);
  const active = view.tasks.filter((t) => t.status !== 'cancelled');
  const cancelled = view.tasks.filter((t) => t.status === 'cancelled');
  return [
    `# ${project.name}（${project.id}）`,
    `目标：${project.goal ?? '未填写'}`,
    `当前规划：${planLine(view)}`,
    ...(view.coverageWarning ? ['注意：有来源只读到一部分，下面的结论可能不全'] : []),
    '任务：',
    ...(active.length ? active.map((t) => `- ${taskLine(t)}`) : ['- 还没有任务']),
    ...(cancelled.length ? ['不要做（已取消）：', ...cancelled.map((t) => `- ${shortId(t.id)} ${t.name} — ${t.basisNote}`)] : []),
    '下一步：',
    ...(view.next.length ? view.next.map((n, i) => `${i + 1}. ${n.action}（${n.reason}）`) : ['- 暂无建议']),
    `待确认：${view.pending.length} 条${view.pending.length ? '，请到 Working Corpus 页面上处理' : ''}`,
    '提醒：AI 自述完成只算待验证，用户确认了才算完成。要接着做某个任务，调用 continue_context 并传任务编号。',
  ].join('\n');
}

function continueContext(db: Db, projectId: string, query: string): ToolResult {
  const tasks = buildProjectView(db, projectId).tasks;
  const listing = (ts: TaskView[]) => ts.map((t) => `- ${shortId(t.id)} ${t.name}（${STATUS_LABEL[t.status]}）`).join('\n');
  const hits = pick(tasks, query, (t) => [t.id, shortId(t.id)]);
  if (hits.length === 1) return text(buildContext(db, projectId, hits[0].id));
  if (hits.length === 0) {
    const name = db.getProject(projectId)!.name;
    return problem(`项目「${name}」里没有匹配「${query}」的任务。${tasks.length ? `已有任务：\n${listing(tasks)}` : '这个项目还没有任务。'}`);
  }
  return problem(`「${query}」匹配到多个任务，请用编号指定：\n${listing(hits)}`);
}

const projectArg = z.string().min(1).optional().describe('项目名或编号。不传就按当前工作目录推断');
const TOOLS = [
  {
    name: 'list_projects',
    description: '列出 Working Corpus 里的全部项目：名称、编号、绑定的代码目录。不确定当前项目叫什么时先调这个。',
    args: z.object({}),
    run: (db: Db) => text(projectListing(db)),
  },
  {
    name: 'project_status',
    description: '读取一个项目的现场：目标、当前规划、每个任务的状态和依据、已取消不要做的事、下一步建议、待确认条数。开工前先看一眼，避免重做已完成或已取消的事。AI 自述完成只算待验证。',
    args: z.object({ project: projectArg }),
    run: (db: Db, a: { project?: string }, cwd: string) => {
      const p = findProject(db, a.project, cwd);
      return 'error' in p ? p.error : text(projectStatus(db, p.id));
    },
  },
  {
    name: 'continue_context',
    description: '生成某个任务的续接上下文：项目目标、当前规划、完成标准、进展、相关决定、阻塞、不要做的事、本轮该做什么。接着做某个任务之前调用，按里面写的范围和完成标准干活。',
    args: z.object({ task: z.string().min(1).describe('任务编号（如 T03）、完整编号或任务名'), project: projectArg }),
    run: (db: Db, a: { task: string; project?: string }, cwd: string) => {
      const p = findProject(db, a.project, cwd);
      return 'error' in p ? p.error : continueContext(db, p.id, a.task);
    },
  },
] as const;

function callTool(db: Db, params: Record<string, unknown>, cwd: string, id: Id): McpResponse {
  const tool = TOOLS.find((t) => t.name === params.name);
  if (!tool) return fail(id, -32602, `未知工具：${String(params.name)}。可用：${TOOLS.map((t) => t.name).join('、')}`);
  const parsed = tool.args.safeParse(params.arguments ?? {});
  if (!parsed.success) {
    const fields = parsed.error.issues.map((i) => i.path.join('.') || '参数').join('、');
    return ok(id, problem(`参数不对：${fields}。请按 ${tool.name} 的参数说明重试`));
  }
  return ok(id, (tool.run as (db: Db, a: unknown, cwd: string) => ToolResult)(db, parsed.data, cwd));
}

/** 处理一条已解析的消息。请求返回响应，通知和客户端发来的响应返回 null。 */
export function handleMcp(db: Db, msg: unknown, ctx: { cwd: string }): McpResponse | null {
  if (typeof msg !== 'object' || msg === null || Array.isArray(msg)) return fail(null, -32600, 'Invalid Request');
  const m = msg as { id?: Id; method?: unknown; params?: Record<string, unknown> };
  if (typeof m.method !== 'string') return 'result' in m || 'error' in m ? null : fail(m.id ?? null, -32600, 'Invalid Request');
  if (!('id' in m)) return null; // 通知不回复，包括 notifications/initialized
  const id = m.id ?? null;
  const params = m.params ?? {};
  try {
    switch (m.method) {
      case 'initialize':
        return ok(id, {
          protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : DEFAULT_PROTOCOL,
          capabilities: { tools: {} },
          serverInfo: { name: 'working-corpus', version: VERSION },
        });
      case 'ping':
        return ok(id, {});
      case 'tools/list':
        return ok(id, {
          tools: TOOLS.map((t) => ({ name: t.name, description: t.description, inputSchema: z.toJSONSchema(t.args), annotations: { readOnlyHint: true } })),
        });
      case 'tools/call':
        return callTool(db, params, ctx.cwd, id);
      default:
        return fail(id, -32601, `Method not found: ${m.method}`);
    }
  } catch (e) {
    console.error(e);
    return fail(id, -32603, e instanceof Error ? e.message : String(e));
  }
}

/** 接上 stdin/stdout。stdin 关闭后进程自然退出。 */
export function runMcp(db: Db): void {
  const send = (r: McpResponse) => process.stdout.write(`${JSON.stringify(r)}\n`);
  const ctx = { cwd: process.cwd() };
  createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
    if (!line.trim()) return;
    let msg: unknown;
    try {
      msg = JSON.parse(line);
    } catch {
      send(fail(null, -32700, 'Parse error'));
      return;
    }
    const r = handleMcp(db, msg, ctx);
    if (r) send(r);
  });
}
