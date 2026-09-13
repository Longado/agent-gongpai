// 命令行入口：npm run corpus -- <命令>
import { parseArgs } from 'node:util';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { dbPath, loadEnv } from './config.ts';
import { openDb } from './db.ts';
import { syncClaudeCode } from './ingest/claude-code.ts';
import { syncCodex } from './ingest/codex.ts';
import { syncVscode } from './ingest/vscode.ts';
import { importText } from './ingest/paste.ts';
import { readTakeoutPath, importConversations } from './ingest/takeout.ts';
import { extractProject } from './extract/run.ts';
import { deepseek } from './extract/model.ts';
import { buildProjectView } from './engine/view.ts';
import { buildContext } from './engine/context.ts';
import { runEval, formatReport } from './eval.ts';
import { gitRoot } from './ingest/common.ts';
import { renderScene, renderHome, useColor } from './tui.ts';

const HELP = `Working Corpus · 用法：corpus <命令>

  （不带命令）                                    所有项目的概况
  app [--port 4173] [--no-open]                     打开窗口：后台启动本地服务，用独立窗口打开
  stop                                             停掉后台的本地服务
  show [--project <编号>]                           在终端看项目现场；在项目目录里可以不写 --project
  context --task <T01> [--project <编号>]           打印续接上下文，贴进任何 AI 工具接着干

  project add <名称> --dir <目录> [--goal <目标>]   建项目并绑定目录（可多次 --dir）
  project list                                     列出项目
  project pause|resume --project <编号>              暂停或恢复采集（已有数据保留）
  sync [--no-extract] [--quiet]                    读取 Claude Code、Codex、VS Code 聊天的新对话，并整理
  import <文件> --project <编号> --label <来源> --title <标题> [--partial] [--date YYYY-MM-DD]
  takeout <zip、文件夹或 json> --project <编号> [--pick 编号,编号 | --all]
                                                   Google Takeout 的 Gemini 历史：不带 --pick 先列出对话
  extract [--project <编号>] [--fresh]              只整理，不读取；--fresh 清掉旧证据从头整理（任务编号和修正保留）
  serve [--port 4173]                              在前台运行本地服务
  mcp                                              以 MCP 连接器方式运行（stdio），见 docs/MCP.md
  eval [--only S1]                                 用真模型跑样本评估
  demo                                             用样本数据建两个示例项目（不调用模型）

没装全局命令时，把 corpus 换成 npm run corpus --`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string', multiple: true }, goal: { type: 'string' }, project: { type: 'string' }, task: { type: 'string' },
    label: { type: 'string' }, title: { type: 'string' }, partial: { type: 'boolean' }, date: { type: 'string' },
    'no-extract': { type: 'boolean' }, fresh: { type: 'boolean' }, quiet: { type: 'boolean' }, 'no-open': { type: 'boolean' }, pick: { type: 'string' }, all: { type: 'boolean' }, port: { type: 'string' }, only: { type: 'string' },
  },
});

// 默认数据库跟着仓库走，不跟着当前目录：MCP 连接器是从别的目录启动的
loadEnv();
const LEGACY_DB = fileURLToPath(new URL('../data/gongpai.db', import.meta.url));
if (!process.env.CORPUS_DB && !process.env.CORPUS_HOME && existsSync(LEGACY_DB) && !existsSync(dbPath())) {
  console.error(`提示：旧版本的数据库在 ${LEGACY_DB}，新位置是 ${dbPath()}。需要旧数据的话手动移动过去。`);
}
const db = () => openDb(dbPath());
const need = (v: string | undefined, name: string): string => {
  if (!v) { console.error(`缺少 --${name}\n\n${HELP}`); process.exit(2); }
  return v;
};

/** 项目参数可以省略：先按当前目录找，只有一个项目时就用它。 */
function pickProject(d: ReturnType<typeof db>, given: string | undefined): string {
  if (given) return given;
  const cwd = process.cwd();
  const hit = d.projectForDir(gitRoot(cwd)) ?? d.projectForDir(cwd);
  if (hit) return hit;
  const all = d.listProjects();
  if (all.length === 1) return all[0].id;
  console.error(all.length ? `当前目录没有绑定项目，请用 --project 指定：\n${all.map((p) => `  ${p.id}  ${p.name}`).join('\n')}` : '还没有项目。先运行 corpus demo 或 corpus project add');
  process.exit(2);
}

async function extractAll(d: ReturnType<typeof db>, projectIds: string[]) {
  const model = deepseek();
  for (const id of projectIds) {
    if (d.isPaused(id)) continue;
    console.log(`整理「${d.getProject(id)?.name}」：对话正文会发送到远程模型 ${model.name}，读取时已隐藏凭证`);
    const r = await extractProject(d, id, model, { onBatch: (i, n) => process.stdout.write(`\r整理 ${d.getProject(id)?.name}：第 ${i}/${n} 批`) });
    if (r.batches) process.stdout.write('\n');
    console.log(`整理完成：新证据 ${r.stored} 条，丢弃 ${r.dropped.length} 条${r.failed ? `，失败 ${r.failed} 批：${r.errors.join('；')}` : ''}`);
  }
}

async function main() {
  const [cmd, sub, arg] = positionals;
  if (cmd === 'project' && sub === 'add') {
    const d = db();
    const id = d.createProject({ name: need(arg, '名称'), goal: values.goal ?? null, dirs: (values.dir ?? []).map((x) => resolve(x)) });
    console.log(`已建项目 ${id}`);
  } else if (cmd === 'project' && (sub === 'pause' || sub === 'resume')) {
    db().setPaused(need(values.project, 'project'), sub === 'pause');
    console.log(sub === 'pause' ? '已暂停采集，已有数据保留' : '已恢复采集');
  } else if (cmd === 'project' && sub === 'list') {
    for (const p of db().listProjects()) console.log(`${p.id}  ${p.name}  ${p.dirs.join('，')}`);
  } else if (cmd === 'sync') {
    const d = db();
    const cc = syncClaudeCode(d);
    const cx = syncCodex(d);
    const vs = syncVscode(d);
    d.logUsage(null, 'sync');
    if (values.quiet && values['no-extract']) return; // 钩子调用：只读，什么都不输出
    console.log(`Claude Code：新消息 ${cc.newMessages}（${cc.files} 个会话）；Codex：新消息 ${cx.newMessages}（${cx.files} 个会话）；VS Code 聊天：新消息 ${vs.newMessages}（${vs.files} 个会话）；未绑定目录的会话 ${cc.skippedSessions + cx.skippedSessions + vs.skippedSessions} 个没有读取`);
    if (cc.badLines + cx.badLines) console.log(`格式异常的行 ${cc.badLines + cx.badLines} 条，已跳过，已有数据不受影响`);
    if (!values['no-extract']) await extractAll(d, d.listProjects().map((p) => p.id));
  } else if (cmd === 'import') {
    const d = db();
    const r = importText(d, { projectId: need(values.project, 'project'), text: readFileSync(need(sub, '文件'), 'utf8'), label: need(values.label, 'label'), title: need(values.title, 'title'), coverage: values.partial ? 'partial' : 'full', date: values.date });
    console.log(`导入 ${r.newMessages} 条新消息${r.unsure ? '；有一段认不出发言者，请在页面上核对' : ''}`);
  } else if (cmd === 'takeout') {
    const convs = readTakeoutPath(need(sub, '文件'));
    const pid = need(values.project, 'project');
    if (!values.pick && !values.all) {
      if (!convs.length) console.log('没有找到 Gemini 对话。网页版的聊天要在 Takeout 里勾“我的活动 → Gemini Apps”，格式选 JSON');
      for (const c of convs) console.log(`${c.key.padEnd(20)} ${c.start.slice(0, 10)} ${String(c.turns.length).padStart(3)} 条${c.missingResponse ? '（缺回复）' : ''}  ${c.source}  ${c.title}`);
      if (convs.length) console.log('\n用 --pick 编号,编号 导入挑选的对话，或 --all 全部导入');
    } else {
      const r = importConversations(db(), pid, convs, values.all ? 'all' : values.pick!.split(',').map((x) => x.trim()));
      console.log(`导入 ${r.sessions} 段对话，新消息 ${r.newMessages} 条。点“同步”整理`);
    }
  } else if (cmd === 'extract') {
    const d = db();
    if (values.fresh) for (const id of values.project ? [values.project] : d.listProjects().map((p) => p.id)) d.resetExtraction(id);
    await extractAll(d, values.project ? [values.project] : d.listProjects().map((p) => p.id));
  } else if (cmd === 'show') {
    const d = db();
    const id = pickProject(d, values.project);
    console.log(renderScene(d.getProject(id)!, buildProjectView(d, id), { color: useColor() }));
    d.logUsage(id, 'show_cli');
  } else if (cmd === 'context') {
    const d = db();
    const pid = pickProject(d, values.project);
    console.log(buildContext(d, pid, `${pid}/${need(values.task, 'task')}`));
    d.logUsage(pid, 'context_cli');
  } else if (cmd === 'app') {
    const { startServer, openWindow } = await import('./app.ts');
    const port = Number(values.port ?? 4173);
    const state = await startServer(port);
    const url = `http://127.0.0.1:${port}`;
    if (values['no-open']) console.log(`本地服务${state === 'running' ? '已经在运行' : '已启动'}：${url}`);
    else console.log(`已用${openWindow(url)}打开 ${url}${state === 'started' ? '。停掉服务：corpus stop' : ''}`);
  } else if (cmd === 'stop') {
    const { stopServer } = await import('./app.ts');
    console.log(stopServer() ? '已停掉后台的本地服务' : '后台没有在运行的本地服务');
  } else if (cmd === 'help' || cmd === '--help' || cmd === '-h') {
    console.log(HELP);
  } else if (cmd === 'serve') {
    const { serve } = await import('./server.ts');
    serve(db(), Number(values.port ?? 4173));
  } else if (cmd === 'mcp') {
    const { runMcp } = await import('./mcp.ts'); // stdout 只留给协议消息，这里不能打印任何东西
    runMcp(db());
  } else if (cmd === 'demo') {
    const { loadDemo } = await import('./demo.ts');
    const ids = loadDemo(db());
    console.log(`已建示例项目：${ids.join('、')}。在终端看：corpus show --project ${ids[0]}；打开窗口：corpus app`);
  } else if (cmd === 'eval') {
    console.log('用真模型跑样本，推理模型每批要几十秒……');
    const { reports, outDir } = await runEval(deepseek(), values.only);
    const { text, redLineFailed } = formatReport(reports);
    console.log(text);
    console.log(`\n原始输出存在 ${outDir}`);
    process.exit(redLineFailed ? 1 : 0);
  } else if (!cmd) {
    const d = db();
    console.log(renderHome(d.listProjects().map((p) => ({ project: p, view: buildProjectView(d, p.id) })), { color: useColor() }));
  } else {
    console.error(`不认识的命令：${cmd}\n`);
    console.log(HELP);
    process.exit(2);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
