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

/** 세션 안의 썰 하나 — 한 세션에서 주제가 바뀌면 여러 개가 나온다 */
export interface SsulPart {
  /** 이 썰의 첫/끝 메시지 순번 — 앞뒤·사이 잡담을 잘라낸다 */
  from: number;
  to: number;
  title: string;
  summary: string;
  /** AuOption.key 또는 '' */
  au: string;
  tags: string[];
  /** 이 썰이 이어 가는 앞 썰(partKey 또는 PrevSsul.id) — 없으면 '' */
  continues: string;
}

export interface AnalyzeResult {
  id: string;
  /** 비어 있으면 잡담만 있던 세션 */
  ssuls: SsulPart[];
}

/** 썰 하나를 가리키는 id — 「세션id#순서」. 이어짐(continues)이 이걸로 앞 썰을 가리킨다 */
export const partKey = (sessionId: string, k: number) => `${sessionId}#${k}`;

export interface AnalyzeResponse { results: AnalyzeResult[]; error?: string }

/* ---------- 입력 만들기 ---------- */

const MSG_CAP = 400;          // 메시지 하나당 판별에 보낼 최대 글자 (원문은 그대로 저장된다)
const SESSION_CAP = 40_000;   // 안전장치 — 긴 세션은 분할 단계(splitSessions maxChars)에서 이미 잘려 온다

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
  key: string;                 // 첫 썰의 partKey
  sessionIds: string[];        // 합쳐진 썰들의 partKey
  title: string;
  summary: string;
  au: string;
  tags: string[];
  msgs: KakaoMsg[];
  /** 이전 업로드의 썰에 이어 붙일 때 그 썰 id */
  appendTo?: string;
}

/** 판별 결과를 썰 초안으로. 잡담은 버리고(썰 사이 잡담도 잘라 냄), 주제가 다른 썰은 각각 따로,
 *  같은 이야기가 이어지는 썰은(같은 세션이든 다른 날이든) 앞 썰에 합친다. */
export function buildDrafts(msgs: KakaoMsg[], sessions: Session[], results: AnalyzeResult[], prevIds: Set<string>): Draft[] {
  const byId = new Map(sessions.map(s => [s.id, s]));
  type Flat = SsulPart & { key: string; sid: string };
  const parts: Flat[] = [];
  for (const r of results) {
    const s = byId.get(r.id);
    if (!s) continue;
    r.ssuls.forEach((p, k) => {
      // 범위가 세션 밖이면(모델 실수) 세션 경계로 맞춘다
      const from = p.from >= s.from && p.from <= s.to ? p.from : s.from;
      const to = p.to >= from && p.to <= s.to ? p.to : s.to;
      parts.push({ ...p, from, to, key: partKey(r.id, k), sid: r.id });
    });
  }
  parts.sort((a, b) => a.from - b.from);
  // 모델이 세션 id만 적어 보내면 그 세션의 마지막 썰로 본다
  const lastOfSession = new Map<string, string>();
  for (const p of parts) lastOfSession.set(p.sid, p.key);

  const drafts: Draft[] = [];
  const owner = new Map<string, Draft>();   // 썰 key → 그 썰이 들어간 초안
  let lastEnd = -1;
  for (const p of parts) {
    const from = Math.max(p.from, lastEnd + 1);   // 겹치게 잘라 보낸 경우 같은 메시지가 두 번 들어가지 않게
    if (from > p.to) continue;
    lastEnd = p.to;
    const part = msgs.slice(from, p.to + 1);
    const ref = p.continues && !owner.has(p.continues) ? lastOfSession.get(p.continues) ?? p.continues : p.continues;
    const host = ref ? owner.get(ref) : undefined;
    // 같은 이야기면 합친다 — 같은 세션 안에서 잡담에 끊긴 경우도 (사이 잡담은 이미 잘려 나가 있다, 사용자 확정)
    if (host) {
      host.msgs.push(...part);
      host.sessionIds.push(p.key);
      host.tags = [...new Set([...host.tags, ...p.tags])];
      if (!host.au && p.au) host.au = p.au;
      owner.set(p.key, host);
      continue;
    }
    const d: Draft = {
      key: p.key, sessionIds: [p.key], title: p.title, summary: p.summary, au: p.au,
      tags: [...new Set(p.tags)], msgs: part,
      ...(ref && prevIds.has(ref) ? { appendTo: ref } : null),
    };
    drafts.push(d);
    owner.set(p.key, d);
  }
  return drafts;
}

/** 초안이 며칠에 걸쳐 있는지 (채팅 날짜 기준) */
export const daySpan = (msgs: { at: string }[]) => new Set(msgs.map(m => m.at.slice(0, 10))).size;
