// 下一步：最多三条。先验证已有产出，再继续进行中的，再开始规划里的。
// 受阻的任务放在“需要你处理”里，不占下一步的名额；只剩受阻时才建议解除阻塞。
import type { NextStep, TaskView } from '../contracts.ts';
import { ms } from '../extract/validate.ts';

const MAX = 3; // 需求 F09：每次最多推荐 1 到 3 项

export function nextSteps(tasks: TaskView[], planOrder: string[], dismissed: Map<string, string>, lastTaskId: string | null): NextStep[] {
  const standard = (t: TaskView) => t.doneCondition ?? '按你的标准确认可用，然后在任务上点“确认完成”';
  const planIndex = (t: TaskView) => { const i = planOrder.indexOf(t.id); return i < 0 ? Number.MAX_SAFE_INTEGER : i; };
  const recent = (a: TaskView, b: TaskView) => ms(b.lastAt) - ms(a.lastAt);
  const notDismissed = (key: string, t: TaskView) => {
    const at = dismissed.get(key);
    return !at || ms(t.lastAt) > ms(at); // 驳回之后出现了新证据，可以再推荐
  };
  const reopened = (t: TaskView) => t.history.some((h) => (h.from === 'done' || h.from === 'to_verify') && h.to === 'doing');

  const candidates: NextStep[] = [
    ...tasks.filter((t) => t.status === 'to_verify').sort(recent).map((t) => ({
      key: `${t.id}:verify`, taskId: t.id, action: `验证「${t.name}」`,
      reason: `${t.basisNote}${reopened(t) ? '；之前失败过' : ''}`, doneStandard: standard(t), evidenceId: t.basisEvidenceId,
    })),
    ...tasks.filter((t) => t.status === 'doing').sort(recent).map((t) => ({
      key: `${t.id}:continue`, taskId: t.id, action: `继续「${t.name}」`,
      reason: t.id === lastTaskId ? '上次停在这里' : t.basisNote, doneStandard: standard(t), evidenceId: t.basisEvidenceId,
    })),
    ...tasks.filter((t) => t.status === 'todo').sort((a, b) => planIndex(a) - planIndex(b)).map((t) => ({
      key: `${t.id}:start`, taskId: t.id, action: `开始「${t.name}」`,
      reason: t.inPlan ? '当前规划里还没开始' : '还没发现执行记录', doneStandard: standard(t), evidenceId: t.basisEvidenceId,
    })),
  ];
  const byTask = new Map(tasks.map((t) => [t.id, t]));
  const picked = candidates.filter((c) => notDismissed(c.key, byTask.get(c.taskId)!)).slice(0, MAX);
  if (picked.length > 0) return picked;
  return tasks.filter((t) => t.status === 'blocked').slice(0, MAX).map((t) => ({
    key: `${t.id}:unblock`, taskId: t.id, action: `解除「${t.name}」的阻塞：${t.blocker ?? '原因未说明'}`,
    reason: '其他任务都已完成或暂停', doneStandard: '阻塞条件消失，任务可以继续', evidenceId: t.basisEvidenceId,
  })).filter((c) => notDismissed(c.key, byTask.get(c.taskId)!));
}
