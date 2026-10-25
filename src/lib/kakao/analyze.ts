// 세션 → LLM 판별 입력 만들기 · 결과를 썰 초안으로 합치기 — 썰 백업 2단계.
// 업로드 화면(브라우저)과 /api/ssul/analyze(서버)가 같이 쓴다. 순수 함수만.
import type { KakaoMsg } from './parse';
import type { Session } from './segment';

/* ---------- API 계약 ---------- */

export interface AnalyzeSession {
  id: string;
  /** 사람이 읽는 대화록 — `#순번 이름: 내용` 한 줄씩 */
  text: string;
}
/** 이전 결과 — 이번 세션이 그 썰의 이어지는 부분인지 판단할 때 */
export interface PrevSsul { id: string; title: string; au: string; end: string; tail: string }
export interface AuOption { key: string; label: string; chars: string[] }

export interface AnalyzeRequest {
  me: string;
  partner: string;
  sessions: AnalyzeSession[];
  aus: AuOption[];
  tags: string[];
  prev: PrevSsul[];
}

export interface AnalyzeResult {
  id: string;
  isSsul: boolean;
  /** 썰 부분의 첫/끝 메시지 순번 — 앞뒤 잡담을 잘라낸다 */
  from: number;
  to: number;
  title: string;
  summary: string;
  /** AuOption.key 또는 '' */
  au: string;
  tags: string[];
  /** 이 세션이 이어 가는 앞 썰(이번 업로드의 세션 id 또는 PrevSsul.id) — 없으면 '' */
  continues: string;
}

export interface AnalyzeResponse { results: AnalyzeResult[]; error?: string }

/* ---------- 입력 만들기 ---------- */

const MSG_CAP = 400;          // 메시지 하나당 판별에 보낼 최대 글자 (원문은 그대로 저장된다)
const SESSION_CAP = 12_000;   // 세션 하나당 최대 글자 — 넘으면 앞 2/3 + 뒤 1/3만 보낸다

export function msgLine(m: KakaoMsg, me: string): string {
  const who = m.kind === 'system' ? '(시스템)' : m.sender === me ? `나(${m.sender})` : m.sender;
  let body: string;
  switch (m.kind) {
    case 'photo': body = `[사진${m.media?.count && m.media.count > 1 ? ` ${m.media.count}장` : ''}]`; break;
    case 'video': body = '[동영상]'; break;
    case 'emoticon': body = '[이모티콘]'; break;
    case 'file': body = `[파일 ${m.media?.file ?? ''}]`; break;
    case 'voice': body = '[음성]'; break;
    case 'deleted': body = '[삭제됨]'; break;
    default: body = (m.sticker ? '[이모티콘] ' : '') + m.text;
  }
  body = body.replace(/\n/g, ' / ');
  if (body.length > MSG_CAP) body = body.slice(0, MSG_CAP) + '…';
  return `#${m.i} ${who}: ${body}`;
}

export function sessionText(msgs: KakaoMsg[], s: Session, me: string): string {
  const lines = msgs.slice(s.from, s.to + 1).map(m => msgLine(m, me));
  const full = lines.join('\n');
  if (full.length <= SESSION_CAP) return full;
  const head: string[] = [], tail: string[] = [];
  let n = 0;
  for (const l of lines) { if (n + l.length > SESSION_CAP * 2 / 3) break; head.push(l); n += l.length + 1; }
  n = 0;
  for (let k = lines.length - 1; k >= head.length; k--) {
    if (n + lines[k].length > SESSION_CAP / 3) break;
    tail.unshift(lines[k]); n += lines[k].length + 1;
  }
  return [...head, `… (중간 ${lines.length - head.length - tail.length}개 메시지 생략) …`, ...tail].join('\n');
}

/** LLM에 보낼 필요도 없는 세션 — 글이 거의 없으면 썰일 수 없다 (토큰 절약) */
export const isTrivial = (s: Session) => s.chars < 120 || s.count < 3;

/** 요청 하나에 실을 세션 묶음 — 응답 시간·출력 길이를 고려해 글자 수로 끊는다 */
export function batchSessions(items: AnalyzeSession[], maxChars = 30_000, maxCount = 12): AnalyzeSession[][] {
  const out: AnalyzeSession[][] = [];
  let cur: AnalyzeSession[] = [], n = 0;
  for (const it of items) {
    if (cur.length && (n + it.text.length > maxChars || cur.length >= maxCount)) { out.push(cur); cur = []; n = 0; }
    cur.push(it); n += it.text.length;
  }
  if (cur.length) out.push(cur);
  return out;
}

/* ---------- 결과 → 초안 ---------- */

export interface Draft {
  key: string;                 // 첫 세션 id
  sessionIds: string[];
  title: string;
  summary: string;
  au: string;
  tags: string[];
  msgs: KakaoMsg[];
  /** 이전 업로드의 썰에 이어 붙일 때 그 썰 id */
  appendTo?: string;
}

/** 판별 결과를 썰 초안으로. 썰이 아닌 세션은 버리고, 이어지는 세션은 앞 썰에 합친다. */
export function buildDrafts(msgs: KakaoMsg[], sessions: Session[], results: AnalyzeResult[], prevIds: Set<string>): Draft[] {
  const byId = new Map(sessions.map(s => [s.id, s]));
  const drafts: Draft[] = [];
  const owner = new Map<string, Draft>();   // 세션 id → 그 세션이 들어간 초안
  const order = [...results].filter(r => r.isSsul && byId.has(r.id))
    .sort((a, b) => byId.get(a.id)!.from - byId.get(b.id)!.from);
  for (const r of order) {
    const s = byId.get(r.id)!;
    // 잘라낼 범위가 세션 밖이면(모델 실수) 세션 전체를 쓴다
    const from = r.from >= s.from && r.from <= s.to ? r.from : s.from;
    const to = r.to >= from && r.to <= s.to ? r.to : s.to;
    const part = msgs.slice(from, to + 1);
    const host = r.continues ? owner.get(r.continues) : undefined;
    if (host) {
      host.msgs.push(...part);
      host.sessionIds.push(r.id);
      host.tags = [...new Set([...host.tags, ...r.tags])];
      if (!host.au && r.au) host.au = r.au;
      owner.set(r.id, host);
      continue;
    }
    const d: Draft = {
      key: r.id, sessionIds: [r.id], title: r.title, summary: r.summary, au: r.au,
      tags: [...new Set(r.tags)], msgs: part,
      ...(r.continues && prevIds.has(r.continues) ? { appendTo: r.continues } : null),
    };
    drafts.push(d);
    owner.set(r.id, d);
  }
  return drafts;
}
