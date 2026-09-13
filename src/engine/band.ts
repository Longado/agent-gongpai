// 语料带：页面顶部的像素带，每个方块是一条消息，颜色是它支撑的任务的状态。
import type { ProjectView, Role, TaskStatus } from '../contracts.ts';
import type { Db } from '../db.ts';
import { timeOf } from '../extract/validate.ts';

export interface BandCell {
  at: string;
  role: Role;
  status: TaskStatus | null; // 没被任何任务证据引用的消息是 null
  task: string | null;
}

export function corpusBand(db: Db, projectId: string, view: ProjectView): BandCell[] {
  const tasks = new Map(view.tasks.map((t) => [t.id, t]));
  const taskOf = new Map<string, string>(); // 消息 -> 最近一条引用它的证据所指的任务
  for (const e of db.evidenceForProject(projectId)) {
    if (tasks.has(e.taskId)) e.cite.forEach((id) => taskOf.set(id, e.taskId));
  }
  return db.messagesForProject(projectId).filter((m) => !m.replacedBy).map((m) => { // 旧版本不算进语料带
    const t = tasks.get(taskOf.get(m.id) ?? '');
    return { at: timeOf(m), role: m.role, status: t?.status ?? null, task: t?.name ?? null };
  });
}
