// 记忆引擎：把证据和人工修正按时间折叠成项目状态。纯函数，同样的输入永远得到同样的结果。
import type {
  Basis, CorrectionRecord, Decision, EvidenceKind, PendingItem, PlanVersion, Role, StatusChange, StoredEvidence, TaskRecord, TaskStatus, TaskView,
} from '../contracts.ts';
import { STATUS_LABEL } from '../contracts.ts';
import { ms } from '../extract/validate.ts';

export interface FoldInput {
  tasks: TaskRecord[];
  evidence: StoredEvidence[];
  corrections: CorrectionRecord[];
  roles: Map<string, Role>; // 消息当前的发言者（可能被人工改过）
  sessionOf: Map<string, string>; // 消息属于哪个会话
}

export interface FoldOutput {
  tasks: TaskView[];
  plan: { versions: PlanVersion[]; noPlan: boolean };
  decisions: Decision[];
  ideas: { evidenceId: string; text: string }[];
  pending: PendingItem[];
  doneEvents: { at: string; taskId: string }[];
  dismissed: Map<string, string>; // 下一步的 key -> 驳回时间
  planOrder: string[]; // 当前规划里任务的先后
}

type Eff = EvidenceKind | 'ai_suggestion';

const PLAN_KINDS = new Set<EvidenceKind>(['plan_item', 'plan_add', 'plan_cancel']);
const day = (iso: string) => new Date(ms(iso)).toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric', timeZone: 'Asia/Shanghai' }).replace('/', '-');

/** 按当前发言者重新判断：规划和确认完成必须引用用户消息，否则降级。 */
export function effectiveKind(e: StoredEvidence, roles: Map<string, Role>): { kind: Eff; note: string | null } {
  const userCited = e.cite.some((id) => roles.get(id) === 'user');
  if (userCited) return { kind: e.kind, note: null };
  if (e.kind === 'user_confirms_done') return { kind: 'ai_claims_done', note: '没有引用用户的话，按 AI 自述处理' };
  if (PLAN_KINDS.has(e.kind)) return { kind: 'ai_suggestion', note: 'AI 建议，未经你确认' };
  return { kind: e.kind, note: null };
}

interface State {
  rec: TaskRecord;
  name: string;
  active: boolean;
  status: TaskStatus | null;
  basis: Basis;
  basisNote: string;
  basisEvidenceId: string | null;
  history: StatusChange[];
  inPlan: boolean;
  blocker: string | null;
  sessions: Set<string>;
  lastAt: string;
  manualAt: number | null;
  doneCondition: string | null;
  conditionConfirmed: boolean;
}

type Event =
  | { t: number; seq: number; type: 'evidence'; e: StoredEvidence }
  | { t: number; seq: number; type: 'correction'; c: CorrectionRecord };

export function fold(input: FoldInput): FoldOutput {
  // 1. 合并与改派：先把证据指向的任务改好
  const redirect = new Map<string, string>();
  const assigned = new Map<string, string>();
  const acked = new Set<string>();
  for (const { correction: c } of input.corrections) {
    if (c.type === 'merge') redirect.set(c.from, c.into);
    if (c.type === 'assign') assigned.set(c.evidenceId, c.taskId);
    if (c.type === 'ack') acked.add(c.evidenceId);
  }
  const resolve = (id: string): string => {
    let cur = id;
    for (let i = 0; i < 20 && redirect.has(cur); i++) cur = redirect.get(cur)!;
    return cur;
  };

  const states = new Map<string, State>();
  for (const rec of input.tasks) {
    if (redirect.has(rec.id)) continue; // 被合并掉的任务不再单独出现
    states.set(rec.id, {
      rec, name: rec.name, active: false, status: null, basis: 'text', basisNote: '', basisEvidenceId: null, history: [],
      inPlan: false, blocker: null, sessions: new Set(), lastAt: rec.createdAt, manualAt: null, doneCondition: null, conditionConfirmed: false,
    });
  }

  const out: FoldOutput = { tasks: [], plan: { versions: [], noPlan: true }, decisions: [], ideas: [], pending: [], doneEvents: [], dismissed: new Map(), planOrder: [] };
  const suggestions = new Map<string, PendingItem>(); // 按任务去重

  // 2. 时间线：证据按被引用消息的时间，修正按修正发生的时间
  const events: Event[] = [
    ...input.evidence.map((e) => ({ t: ms(e.at), seq: e.order, type: 'evidence' as const, e })),
    ...input.corrections.map((c, i) => ({ t: ms(c.at), seq: 1e12 + i, type: 'correction' as const, c })),
  ].sort((a, b) => a.t - b.t || a.seq - b.seq);

  // 规划版本
  const versions: PlanVersion[] = [];
  let sealed = false; // 第一版在出现第一次变更时封口
  const versionCites = new Map<PlanVersion, Set<string>>(); // 每一版引用过的消息
  const planChange = (s: State, change: 'added' | 'cancelled', at: string, evId: string, cite: string[]) => {
    const last = versions.at(-1);
    let v = last;
    // 同一次决定：时间相同，或者和上一版的变更引用了同一条消息
    // 第一版不参与“同引用”合并，免得后来的变更顺手引用了最初规划就被并进第一版
    const sameMoment = !!last && (last.at === at || (last.n > 1 && cite.some((id) => versionCites.get(last)?.has(id))));
    if (!last || !sameMoment) {
      v = { n: versions.length + 1, at, backfilled: false, items: (last?.items ?? []).filter((i) => i.change !== 'cancelled').map((i) => ({ ...i, change: 'kept' as const })), evidenceIds: [] };
      versions.push(v);
    }
    if (!versionCites.has(v!)) versionCites.set(v!, new Set());
    cite.forEach((id) => versionCites.get(v!)!.add(id));
    const item = v!.items.find((i) => i.taskId === s.rec.id);
    if (change === 'added' && !item) v!.items.push({ taskId: s.rec.id, name: s.name, change: versions.length === 1 ? 'kept' : 'added' });
    if (change === 'cancelled' && item) item.change = 'cancelled';
    if (!v!.evidenceIds.includes(evId)) v!.evidenceIds.push(evId);
  };

  const setStatus = (s: State, to: TaskStatus, basis: Basis, note: string, evId: string | null, at: string) => {
    if (s.status !== to) {
      s.history.push({ at, from: s.status, to, evidenceId: evId, basis, note });
      if (to === 'done') out.doneEvents.push({ at, taskId: s.rec.id });
    }
    s.status = to;
    s.basis = basis;
    s.basisNote = note;
    s.basisEvidenceId = evId;
  };

  for (const ev of events) {
    if (ev.type === 'correction') {
      const c = ev.c.correction;
      const at = ev.c.at;
      if (c.type === 'set_status') {
        const s = states.get(resolve(c.taskId));
        if (!s) continue;
        s.active = true;
        setStatus(s, c.status, 'manual', c.note ?? `你在 ${day(at)} 手动改为${STATUS_LABEL[c.status]}`, null, at);
        s.manualAt = ev.t;
        if (c.status !== 'blocked') s.blocker = null;
      } else if (c.type === 'confirm_condition') {
        const s = states.get(resolve(c.taskId));
        if (s) { s.doneCondition = c.condition; s.conditionConfirmed = true; }
      } else if (c.type === 'dismiss_next') {
        out.dismissed.set(c.key, at);
      } else if (c.type === 'rename') {
        const s = states.get(resolve(c.taskId));
        if (s) s.name = c.name;
      } else if (c.type === 'backfill_plan') {
        const items = c.taskIds.map((id) => states.get(resolve(id))).filter((s): s is State => !!s);
        items.forEach((s) => { s.active = true; s.inPlan = true; if (!s.status) setStatus(s, 'todo', 'manual', '后补规划里有，还没发现执行记录', null, at); });
        versions.push({ n: versions.length + 1, at, backfilled: true, items: items.map((s) => ({ taskId: s.rec.id, name: s.name, change: 'kept' as const })), evidenceIds: [] });
        sealed = true;
      }
      continue;
    }

    const e = ev.e;
    const { kind, note } = effectiveKind(e, input.roles);
    const taskId = assigned.get(e.id) ?? (e.taskId === 'none' || e.taskId === 'unknown' ? e.taskId : resolve(e.taskId));

    if (kind === 'decision_adopt' || kind === 'decision_reject') {
      out.decisions.push({ evidenceId: e.id, kind: kind === 'decision_adopt' ? 'adopt' : 'reject', text: e.detail, reason: e.reason, at: e.at });
      continue;
    }
    if (kind === 'out_of_scope') { out.ideas.push({ evidenceId: e.id, text: e.detail }); continue; }
    if (taskId === 'unknown') { out.pending.push({ kind: 'unknown_task', evidenceId: e.id, text: e.detail }); continue; }
    if (taskId === 'none') continue;
    const s = states.get(taskId);
    if (!s) continue;

    if (kind === 'ai_suggestion') {
      if (!s.active) suggestions.set(s.rec.id, { kind: 'ai_suggestion', evidenceId: e.id, text: `${s.name}：${e.detail}`, taskId: s.rec.id });
      continue;
    }

    // 取消一个从没进入范围的事项：不建任务，记成否决
    if (kind === 'plan_cancel' && !s.active) {
      suggestions.delete(s.rec.id);
      out.decisions.push({ evidenceId: e.id, kind: 'reject', text: `不做「${s.name}」`, reason: e.reason, at: e.at });
      continue;
    }

    s.active = true;
    suggestions.delete(s.rec.id);
    e.cite.forEach((id) => { const sid = input.sessionOf.get(id); if (sid) s.sessions.add(sid); });
    if (ms(e.at) > ms(s.lastAt)) s.lastAt = e.at;

    // 算出这条证据要把任务推到哪个状态
    let target: { to: TaskStatus; basis: Basis; note: string } | null = null;
    const byWhom: Basis = e.speaker === 'assistant' ? 'ai' : 'text';
    switch (kind) {
      case 'plan_item':
      case 'plan_add':
        if (!sealed && kind === 'plan_item') {
          if (versions.length === 0) versions.push({ n: 1, at: e.at, backfilled: false, items: [], evidenceIds: [] });
          const v1 = versions[0];
          if (!v1.items.some((i) => i.taskId === s.rec.id)) v1.items.push({ taskId: s.rec.id, name: s.name, change: 'kept' });
          if (!v1.evidenceIds.includes(e.id)) v1.evidenceIds.push(e.id);
        } else {
          if (versions.length > 0) sealed = true;
          planChange(s, 'added', e.at, e.id, e.cite);
        }
        s.inPlan = true;
        if (s.status === null || s.status === 'cancelled') target = { to: 'todo', basis: 'user', note: s.status === 'cancelled' ? '重新加入规划' : '规划里有，还没发现执行记录' };
        break;
      case 'plan_cancel':
        if (s.inPlan) { sealed = true; planChange(s, 'cancelled', e.at, e.id, e.cite); }
        out.decisions.push({ evidenceId: e.id, kind: 'cancel', text: `取消「${s.name}」`, reason: e.reason, at: e.at });
        target = { to: 'cancelled', basis: 'user', note: `${day(e.at)} 你决定不做${e.reason ? `：${e.reason}` : ''}` };
        break;
      case 'started':
        if (s.status !== 'cancelled') {
          const reopen = s.status === 'done' || s.status === 'to_verify';
          target = { to: 'doing', basis: byWhom, note: `${reopen ? '重开：' : '最近执行：'}${e.detail}` };
        }
        break;
      case 'ai_claims_done':
        if (s.status !== 'done' && s.status !== 'cancelled') target = { to: 'to_verify', basis: 'ai', note: `AI ${day(e.at)} 说已完成，还没有你的确认${note ? `（${note}）` : ''}` };
        break;
      case 'user_confirms_done':
        if (s.status !== 'cancelled') target = { to: 'done', basis: 'user', note: `你 ${day(e.at)} 确认：${e.detail}` };
        break;
      case 'failure':
        if (s.status !== 'cancelled' && s.status !== 'blocked') target = { to: 'doing', basis: 'text', note: `${s.status === 'done' || s.status === 'to_verify' ? '重开' : '失败'}：${e.detail}` };
        break;
      case 'blocked': // 完成后又受阻也算重开（需求 F07：出现后续问题时重新打开）
        if (s.status !== 'cancelled') target = { to: 'blocked', basis: byWhom, note: e.speaker === 'assistant' ? `AI 推测：${e.detail}` : e.detail };
        break;
      case 'unblocked':
        if (s.status === 'blocked') target = { to: 'doing', basis: byWhom, note: `阻塞解除：${e.detail}` };
        break;
    }
    if (!target) continue;

    // 人工改过状态之后，更晚的证据不直接生效
    if (s.manualAt !== null && ev.t > s.manualAt && target.to !== s.status) {
      out.pending.push({ kind: 'conflict', evidenceId: e.id, taskId: s.rec.id, suggestedStatus: target.to, text: `你把「${s.name}」改成了${STATUS_LABEL[s.status!]}；之后的记录显示：${e.detail}` });
      continue;
    }
    setStatus(s, target.to, target.basis, target.note, e.id, e.at);
    if (target.to === 'blocked') s.blocker = e.detail;
    else if (s.status !== 'blocked') s.blocker = null;
  }

  out.pending.push(...suggestions.values());
  out.pending = out.pending.filter((p) => !acked.has(p.evidenceId));
  out.plan = { versions, noPlan: versions.length === 0 };
  const current = versions.at(-1);
  out.planOrder = current ? current.items.filter((i) => i.change !== 'cancelled').map((i) => i.taskId) : [];
  out.tasks = [...states.values()]
    .filter((s) => s.active && s.status)
    .map((s) => ({
      id: s.rec.id, name: s.name, goal: s.rec.goal, doneCondition: s.doneCondition, doneConditionConfirmed: s.conditionConfirmed,
      status: s.status!, basis: s.basis, basisNote: s.basisNote, basisEvidenceId: s.basisEvidenceId, inPlan: s.inPlan,
      blocker: s.status === 'blocked' ? s.blocker : null, sessions: [...s.sessions], history: s.history, lastAt: s.lastAt,
    }));
  // 版本里的名字跟着改名走
  const nameOf = new Map(out.tasks.map((t) => [t.id, t.name]));
  versions.forEach((v) => v.items.forEach((i) => { i.name = nameOf.get(i.taskId) ?? i.name; }));
  return out;
}
