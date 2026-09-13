// 从数据库取数，折叠出项目视图。页面、续接上下文、评估都用它。
import type { LastPosition, ProjectView, Role, TaskStatus } from '../contracts.ts';
import type { Db } from '../db.ts';
import { fold } from './fold.ts';
import { nextSteps } from './next.ts';
import { resultHints } from './hints.ts';
import { ms, timeOf } from '../extract/validate.ts';

const EMPTY: Record<TaskStatus, number> = { pending_confirm: 0, todo: 0, doing: 0, to_verify: 0, done: 0, blocked: 0, cancelled: 0 };

export function buildProjectView(db: Db, projectId: string): ProjectView & { planOrder: string[] } {
  const messages = db.messagesForProject(projectId);
  const roles = new Map<string, Role>(messages.map((m) => [m.id, m.role]));
  const sessionOf = new Map(messages.map((m) => [m.id, m.sessionId]));
  const evidence = db.evidenceForProject(projectId);
  const tsKnown = new Set(messages.filter((m) => m.ts).map((m) => m.id));
  const sessionLabel = new Map(db.sessionsForProject(projectId).map((s) => [s.id, s.label]));
  const replaced = new Set(messages.filter((m) => m.replacedBy).map((m) => m.id));
  const f = fold({ tasks: db.tasksForProject(projectId), evidence, corrections: db.correctionsForProject(projectId), roles, sessionOf, tsKnown, sessionLabel, replaced });

  // 上次停在哪：最近一条消息所在的会话，取那段会话里 AI 的最后一句
  let lastPosition: LastPosition | null = null;
  const latest = messages.reduce<(typeof messages)[number] | null>((a, m) => (!a || ms(timeOf(m)) >= ms(timeOf(a)) ? m : a), null);
  if (latest) {
    const session = db.getSession(latest.sessionId)!;
    const inSession = messages.filter((m) => m.sessionId === latest.sessionId);
    const lastAi = [...inSession].reverse().find((m) => m.role === 'assistant') ?? latest;
    const citing = evidence.filter((e) => e.taskId !== 'none' && e.taskId !== 'unknown' && e.cite.some((id) => sessionOf.get(id) === latest.sessionId)).at(-1);
    const taskId = citing && f.tasks.some((t) => t.id === citing.taskId) ? citing.taskId : null;
    lastPosition = { at: timeOf(latest), sessionId: session.id, label: session.label, title: session.title, text: lastAi.text.slice(0, 200), taskId };
  }

  // 每个任务的产出线索，给下一步的前置条件用
  const textOf = new Map(messages.map((m) => [m.id, m.text]));
  const citeOf = new Map(evidence.map((e) => [e.id, e.cite]));
  const hints = new Map(f.tasks.map((t) => [t.id, resultHints(t.evidenceIds.flatMap((id) => citeOf.get(id) ?? []).map((m) => textOf.get(m) ?? ''))]));

  const counts = { ...EMPTY };
  f.tasks.forEach((t) => counts[t.status]++);
  return {
    tasks: f.tasks, plan: f.plan, decisions: f.decisions, ideas: f.ideas, pending: f.pending,
    next: nextSteps(f.tasks, f.planOrder, f.dismissed, lastPosition?.taskId ?? null, hints),
    counts, doneEvents: f.doneEvents,
    coverageWarning: db.sessionsForProject(projectId).some((s) => s.coverage === 'partial'),
    lastPosition, planOrder: f.planOrder,
  };
}
