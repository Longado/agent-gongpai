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
import { importText } from './ingest/paste.ts';
import { extractProject } from './extract/run.ts';
import { deepseek } from './extract/model.ts';
import { buildProjectView } from './engine/view.ts';
import { buildContext } from './engine/context.ts';
import { runEval, formatReport } from './eval.ts';
import { STATUS_LABEL } from './contracts.ts';

const HELP = `用法：npm run corpus -- <命令>

  project add <名称> --dir <目录> [--goal <目标>]   建项目并绑定目录（可多次 --dir）
  project list                                     列出项目
  project pause|resume --project <编号>              暂停或恢复采集（已有数据保留）
  sync [--no-extract]                              读取 Claude Code 和 Codex 的新对话，并整理
  import <文件> --project <编号> --label <来源> --title <标题> [--partial] [--date YYYY-MM-DD]
  extract [--project <编号>]                        只整理，不读取
  show --project <编号>                             打印项目现场
  context --project <编号> --task <T01>              打印续接上下文
  serve [--port 4173]                              打开本地网页
  mcp                                              以 MCP 连接器方式运行（stdio），给 Claude Code、Codex、Cursor 读项目现场，见 docs/MCP.md
  eval [--only S1]                                 用真模型跑样本评估
  demo                                             用样本数据建两个示例项目（不调用模型）`;

const { positionals, values } = parseArgs({
  allowPositionals: true,
  options: {
    dir: { type: 'string', multiple: true }, goal: { type: 'string' }, project: { type: 'string' }, task: { type: 'string' },
    label: { type: 'string' }, title: { type: 'string' }, partial: { type: 'boolean' }, date: { type: 'string' },
    'no-extract': { type: 'boolean' }, port: { type: 'string' }, only: { type: 'string' },
  },
});

// 默认数据库跟着仓库走，不跟着当前目录：MCP 连接器是从别的目录启动的
loadEnv();
const LEGACY_DB = fileURLToPath(new URL('../data/gongpai.db', import.meta.url));
if (!process.env.CORPUS_DB && existsSync(LEGACY_DB) && !existsSync(dbPath())) {
  console.error(`提示：旧版本的数据库在 ${LEGACY_DB}，新位置是 ${dbPath()}。需要旧数据的话手动移动过去。`);
}
const db = () => openDb(dbPath());
const need = (v: string | undefined, name: string): string => {
  if (!v) { console.error(`缺少 --${name}\n\n${HELP}`); process.exit(2); }
  return v;
};

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
    console.log(`Claude Code：新消息 ${cc.newMessages}（${cc.files} 个会话）；Codex：新消息 ${cx.newMessages}（${cx.files} 个会话）；未绑定目录的会话 ${cc.skippedSessions + cx.skippedSessions} 个没有读取`);
    if (cc.badLines + cx.badLines) console.log(`格式异常的行 ${cc.badLines + cx.badLines} 条，已跳过，已有数据不受影响`);
    d.logUsage(null, 'sync');
    if (!values['no-extract']) await extractAll(d, d.listProjects().map((p) => p.id));
  } else if (cmd === 'import') {
    const d = db();
    const r = importText(d, { projectId: need(values.project, 'project'), text: readFileSync(need(sub, '文件'), 'utf8'), label: need(values.label, 'label'), title: need(values.title, 'title'), coverage: values.partial ? 'partial' : 'full', date: values.date });
    console.log(`导入 ${r.newMessages} 条新消息${r.unsure ? '；有一段认不出发言者，请在页面上核对' : ''}`);
  } else if (cmd === 'extract') {
    const d = db();
    await extractAll(d, values.project ? [values.project] : d.listProjects().map((p) => p.id));
  } else if (cmd === 'show') {
    const d = db();
    const id = need(values.project, 'project');
    const v = buildProjectView(d, id);
    console.log(`# ${d.getProject(id)?.name}`);
    if (v.lastPosition) console.log(`上次停在：${v.lastPosition.label} · ${v.lastPosition.at.slice(0, 16)} · ${v.lastPosition.text.slice(0, 60).replace(/\n/g, ' ')}`);
    console.log(`规划：${v.plan.noPlan ? '已读取的记录里没有明确规划' : v.plan.versions.at(-1)!.items.map((i) => (i.change === 'cancelled' ? `~~${i.name}~~` : i.name)).join('、')}`);
    if (v.coverageWarning) console.log('注意：有来源只读到一部分');
    for (const t of v.tasks) console.log(`  ${STATUS_LABEL[t.status].padEnd(4)} ${t.id.split('/').at(-1)} ${t.name} — ${t.basisNote}`);
    console.log('下一步：');
    v.next.forEach((n, i) => console.log(`  ${i + 1}. ${n.action}（${n.reason}）`));
    if (v.pending.length) console.log(`待确认 ${v.pending.length} 条`);
  } else if (cmd === 'context') {
    const d = db();
    const pid = need(values.project, 'project');
    console.log(buildContext(d, pid, `${pid}/${need(values.task, 'task')}`));
    d.logUsage(pid, 'context_cli');
  } else if (cmd === 'serve') {
    const { serve } = await import('./server.ts');
    serve(db(), Number(values.port ?? 4173));
  } else if (cmd === 'mcp') {
    const { runMcp } = await import('./mcp.ts'); // stdout 只留给协议消息，这里不能打印任何东西
    runMcp(db());
  } else if (cmd === 'demo') {
    const { loadDemo } = await import('./demo.ts');
    const ids = loadDemo(db());
    console.log(`已建示例项目：${ids.join('、')}。运行 npm run corpus -- serve 查看`);
  } else if (cmd === 'eval') {
    console.log('用真模型跑样本，推理模型每批要几十秒……');
    const { reports, outDir } = await runEval(deepseek(), values.only);
    const { text, redLineFailed } = formatReport(reports);
    console.log(text);
    console.log(`\n原始输出存在 ${outDir}`);
    process.exit(redLineFailed ? 1 : 0);
  } else {
    console.log(HELP);
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
