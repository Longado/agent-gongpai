// 大模型给出的证据入库之前，由代码把关。
import { randomUUID } from 'node:crypto';
import { Evidence as EvidenceSchema, type Evidence, type EvidenceKind, type Message, type Role, type StoredEvidence } from '../contracts.ts';
import type { Db } from '../db.ts';

// 这些种类说的是某个任务；决定和范围外想法可以不挂任务
const TASK_KINDS = new Set<EvidenceKind>(['plan_item', 'plan_add', 'plan_cancel', 'started', 'ai_claims_done', 'user_confirms_done', 'failure', 'blocked', 'unblocked']);

export const normName = (s: string) => s.toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');

export const timeOf = (m: Pick<Message, 'ts' | 'capturedAt'>) => m.ts ?? m.capturedAt;
export const ms = (iso: string) => Date.parse(iso);

export interface Dropped {
  item: unknown;
  why: string;
}

export function storeEvidence(
  db: Db,
  projectId: string,
  items: unknown[],
  refs: Map<string, Message>,
  meta: { model: string; promptVersion: string; batchKey?: string; decisionRefs?: Map<string, string> },
): { stored: StoredEvidence[]; dropped: Dropped[] } {
  const stored: StoredEvidence[] = [];
  const dropped: Dropped[] = [];
  const tasks = db.tasksForProject(projectId);
  const byName = new Map(tasks.map((t) => [normName(t.name), t.id]));
  const known = new Set(tasks.map((t) => t.id));
  const base = db.evidenceCount(projectId);

  items.forEach((raw, i) => {
    const parsed = EvidenceSchema.safeParse(raw);
    if (!parsed.success) {
      dropped.push({ item: raw, why: `格式不对：${parsed.error.issues[0]?.message ?? ''}` });
      return;
    }
    const e: Evidence = parsed.data;
    const cited = e.cite.map((r) => refs.get(r));
    if (cited.some((m) => !m)) {
      dropped.push({ item: raw, why: `引用的消息不存在：${e.cite.filter((r) => !refs.get(r)).join('、')}` });
      return;
    }
    const msgs = cited as Message[];
    const speaker: Role = msgs.some((m) => m.role === 'user') ? 'user' : msgs.some((m) => m.role === 'tool_error') ? 'tool_error' : 'assistant';
    const at = msgs.map(timeOf).sort((a, b) => ms(a) - ms(b)).at(-1)!;

    let taskId: string;
    let detail = e.detail;
    if (e.task === 'none' || e.task === 'unknown') taskId = e.task;
    else if ('id' in e.task) taskId = known.has(e.task.id) ? e.task.id : 'unknown';
    else {
      const n = normName(e.task.newName);
      const hit = byName.get(n);
      if (hit) taskId = hit;
      else if (TASK_KINDS.has(e.kind)) {
        taskId = db.addTask({ projectId, name: e.task.newName, goal: e.task.goal ?? null, createdAt: at });
        byName.set(n, taskId);
        known.add(taskId);
      } else {
        taskId = 'none';
        if (!detail.includes(e.task.newName)) detail = `${e.task.newName}：${detail}`;
      }
    }

    // 被替代的决定：本批的消息编号或提示词里的决定编号；认不出的引用丢掉，不影响这条证据
    const replaces = (e.replaces ?? []).flatMap((r) => {
      const m = refs.get(r);
      if (m) return [`m:${m.id}`];
      const ev = meta.decisionRefs?.get(r);
      return ev ? [`e:${ev}`] : [];
    });
    stored.push({
      id: `e_${randomUUID().slice(0, 8)}`, projectId, taskId, kind: e.kind, cite: msgs.map((m) => m.id), speaker,
      detail, reason: e.reason?.trim() || null, at, order: base + i, downgraded: null, replaces, model: meta.model, promptVersion: meta.promptVersion,
    });
  });
  db.addEvidence(stored, meta.batchKey ?? null);
  return { stored, dropped };
}
