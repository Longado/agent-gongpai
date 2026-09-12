// 把样本对话灌进数据库。测试和评估共用。
import { readFileSync } from 'node:fs';
import type { Coverage, Message, Role, Source } from './contracts.ts';
import type { Db } from './db.ts';

interface SampleFile {
  project: { name: string; goal: string | null };
  sessions: {
    id: string; source: Source; label: string; coverage: Coverage;
    messages: { ref: string; role: Role; text: string; ts: string | null; capturedAt?: string }[];
  }[];
}

export function readSample(dir: URL): SampleFile {
  return JSON.parse(readFileSync(new URL('input.json', dir), 'utf8'));
}

export function loadSample(db: Db, dir: URL): { projectId: string; refs: Map<string, Message>; sample: SampleFile } {
  const sample = readSample(dir);
  const projectId = db.createProject({ name: sample.project.name, goal: sample.project.goal, dirs: [] });
  const refs = new Map<string, Message>();
  for (const s of sample.sessions) {
    db.upsertSession({ id: s.id, source: s.source, label: s.label, projectId, cwd: null, title: null, coverage: s.coverage });
    const msgs: Message[] = s.messages.map((m, i) => ({
      id: `${s.id}:${m.ref}`, sessionId: s.id, seq: i, role: m.role, text: m.text,
      ts: m.ts, capturedAt: m.capturedAt ?? m.ts ?? new Date().toISOString(),
    }));
    db.insertMessages(msgs);
    s.messages.forEach((m, i) => refs.set(m.ref, msgs[i]));
  }
  return { projectId, refs, sample };
}
