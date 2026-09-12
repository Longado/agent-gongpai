// 续接上下文：用模板从结构化记录里拼，不让大模型改写，所以不会凭空多出或丢掉要求。
import { STATUS_LABEL, type ProjectView, type TaskView } from '../contracts.ts';
import type { Db } from '../db.ts';
import { buildProjectView } from './view.ts';

const list = (xs: string[]) => (xs.length ? xs.join('、') : '无');

/** 当前规划一行字：最新一版里没取消的条目。续接上下文和 MCP 连接器共用。 */
export function planLine(view: Pick<ProjectView, 'plan'>): string {
  const current = view.plan.versions.at(-1);
  return current
    ? `第 ${current.n} 版${current.backfilled ? '（后补）' : ''}：${list(current.items.filter((i) => i.change !== 'cancelled').map((i) => i.name))}`
    : '已读取的记录里没有明确规划';
}

export function buildContext(db: Db, projectId: string, taskId: string): string {
  const project = db.getProject(projectId)!;
  const view = buildProjectView(db, projectId);
  const task = view.tasks.find((t) => t.id === taskId);
  if (!task) throw new Error(`任务不存在或已被合并：${taskId}`);
  const others = (status: TaskView['status']) => view.tasks.filter((t) => t.id !== taskId && t.status === status).map((t) => t.name);
  const step = view.next.find((n) => n.taskId === taskId);
  const thisRound = step?.action
    ?? { todo: `开始「${task.name}」`, doing: `继续「${task.name}」`, to_verify: `验证「${task.name}」`, blocked: `先解决「${task.name}」的阻塞`, done: `「${task.name}」已完成，如需修改请先说明要改什么`, cancelled: '', pending_confirm: `先确认「${task.name}」的目标` }[task.status];
  const cancelled = view.tasks.filter((t) => t.status === 'cancelled');
  const decisions = view.decisions.filter((d) => d.kind !== 'cancel').slice(-5)
    .map((d) => `- ${d.kind === 'adopt' ? '采用' : '否决'}：${d.text}（原因：${d.reason ?? '未说明'}）`);
  const sessions = task.sessions.map((sid) => db.getSession(sid)).filter((s) => !!s).map((s) => `${s!.label}${s!.title ? `「${s!.title}」` : ''}`);
  const history = task.history.slice(-5).map((h) => `- ${h.at.slice(0, 10)} ${STATUS_LABEL[h.to]}：${h.note}`);

  return [
    `# 继续：${task.name}`,
    `项目目标：${project.goal ?? '未填写'}`,
    `当前规划：${planLine(view)}`,
    `本任务：${task.goal ?? task.name}`,
    `完成标准：${task.doneCondition ?? '还没确认，请先和我确认'}`,
    `当前状态：${STATUS_LABEL[task.status]}（${task.basisNote}）`,
    ...(history.length ? ['进展：', ...history] : []),
    ...(decisions.length ? ['相关决定：', ...decisions] : []),
    `当前阻塞：${task.blocker ?? '无'}`,
    `线索：${list(sessions)}`,
    `其他任务：已完成 ${list(others('done'))}；待验证 ${list(others('to_verify'))}`,
    `不要做（已取消）：${list(cancelled.map((t) => t.name))}`,
    `本轮请做：${thisRound}；完成标准：${task.doneCondition ?? '做完后告诉我怎么验证'}`,
  ].join('\n');
}
