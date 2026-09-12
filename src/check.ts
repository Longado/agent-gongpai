// 拿项目视图对照样本的预期。测试和评估共用。
import type { ProjectView, TaskView } from './contracts.ts';

export interface Expected {
  tasks?: { match: string[]; status: string; minSessions?: number; minReopens?: number }[];
  taskCount?: number;
  absentTasks?: string[];
  plan?: { versions?: number; noPlan?: boolean };
  notRecommended?: string[];
  firstNext?: string[];
  doneEvents?: number;
  coverageWarning?: boolean;
  context?: { task: string[]; doNotSection?: string[]; thisRoundExcludes?: string[] };
  decisions?: { match: string[]; superseded: boolean }[];
}

export interface CheckResult {
  check: string;
  pass: boolean;
  detail: string;
  redLine?: boolean;
}

const hits = (name: string, words: string[]) => words.some((w) => name.includes(w));

export function checkExpected(view: ProjectView, exp: Expected, contextFor: (taskId: string) => string): CheckResult[] {
  const r: CheckResult[] = [];
  const find = (words: string[]): TaskView | undefined => view.tasks.find((t) => hits(t.name, words));
  const names = view.tasks.map((t) => `${t.name}(${t.status})`).join('、');

  for (const t of exp.tasks ?? []) {
    const got = find(t.match);
    r.push({ check: `任务「${t.match[0]}」状态为 ${t.status}`, pass: got?.status === t.status, detail: got ? `实际 ${got.status}` : `没找到，现有：${names}` });
    if (got && t.minSessions) r.push({ check: `任务「${t.match[0]}」挂着至少 ${t.minSessions} 段会话`, pass: got.sessions.length >= t.minSessions, detail: `实际 ${got.sessions.length}` });
    if (got && t.minReopens) {
      const n = got.history.filter((h) => (h.from === 'done' || h.from === 'to_verify') && h.to === 'doing').length;
      r.push({ check: `任务「${t.match[0]}」至少重开 ${t.minReopens} 次`, pass: n >= t.minReopens, detail: `实际 ${n}` });
    }
  }
  if (exp.taskCount !== undefined) r.push({ check: `任务数为 ${exp.taskCount}`, pass: view.tasks.length === exp.taskCount, detail: `实际 ${view.tasks.length}：${names}` });
  for (const w of exp.absentTasks ?? []) r.push({ check: `没有「${w}」这个任务`, pass: !view.tasks.some((t) => t.name.includes(w)), detail: names });
  if (exp.plan?.versions !== undefined) r.push({ check: `规划有 ${exp.plan.versions} 版`, pass: view.plan.versions.length === exp.plan.versions, detail: `实际 ${view.plan.versions.length}` });
  if (exp.plan?.noPlan !== undefined) r.push({ check: `没有规划 = ${exp.plan.noPlan}`, pass: view.plan.noPlan === exp.plan.noPlan, detail: `实际 ${view.plan.noPlan}` });
  for (const w of exp.notRecommended ?? []) r.push({ check: `下一步不推荐「${w}」`, pass: !view.next.some((n) => n.action.includes(w)), detail: view.next.map((n) => n.action).join('；'), redLine: true });
  if (exp.firstNext) r.push({ check: `第一条下一步是「${exp.firstNext[0]}」`, pass: !!view.next[0] && hits(view.next[0].action, exp.firstNext), detail: view.next[0]?.action ?? '没有下一步' });
  if (exp.doneEvents !== undefined) r.push({ check: `完成事件 ${exp.doneEvents} 次`, pass: view.doneEvents.length === exp.doneEvents, detail: `实际 ${view.doneEvents.length}`, redLine: true });
  if (exp.coverageWarning !== undefined) r.push({ check: `覆盖不完整提示 = ${exp.coverageWarning}`, pass: view.coverageWarning === exp.coverageWarning, detail: `实际 ${view.coverageWarning}` });
  if (exp.context) {
    const t = find(exp.context.task);
    if (!t) r.push({ check: '续接上下文', pass: false, detail: `没找到任务「${exp.context.task[0]}」` });
    else {
      const lines = contextFor(t.id).split('\n');
      const doNot = lines.find((l) => l.startsWith('不要做')) ?? '';
      const round = lines.find((l) => l.startsWith('本轮请做')) ?? '';
      for (const w of exp.context.doNotSection ?? []) r.push({ check: `续接上下文的“不要做”里有「${w}」`, pass: doNot.includes(w), detail: doNot });
      for (const w of exp.context.thisRoundExcludes ?? []) r.push({ check: `“本轮请做”里没有「${w}」`, pass: !round.includes(w), detail: round, redLine: true });
    }
  }
  for (const d of exp.decisions ?? []) {
    const got = view.decisions.find((x) => hits(x.text, d.match));
    r.push({ check: `决定「${d.match[0]}」${d.superseded ? '已被替代' : '仍然有效'}`, pass: !!got && !!got.supersededBy === d.superseded, detail: got ? `实际${got.supersededBy ? '已被替代' : '仍然有效'}` : `没找到，现有：${view.decisions.map((x) => x.text).join('、')}` });
  }
  // 硬红线：任何“已完成”都必须来自用户确认或人工修正，AI 自述永远不算
  const badDone = view.tasks.filter((t) => t.history.some((h) => h.to === 'done' && h.basis !== 'user' && h.basis !== 'manual'));
  r.push({ check: 'AI 自述从不直接变成已完成', pass: badDone.length === 0, detail: badDone.map((t) => t.name).join('、'), redLine: true });
  return r;
}
