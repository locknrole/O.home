'use client';
// 썰 백업 (카톡 아카이브) — 카톡에서 나눈 썰을 대화 그대로 보관한다.
//
//   ssul          목록 문서 (제목·날짜·태그·자관 AU) — 타임라인·자관 상세가 통째로 받는다
//   ssul_bodies   대화 본문 (메시지 배열) — 상세에서 fetchOne으로 하나씩만. id는 목록 문서와 같다
//   ssul_imports  업로드 기록 — 상대별 마지막 대화 시각. 다음 업로드는 그 이후만 분석한다
//
// 날짜는 전부 **채팅 시각**('YYYY-MM-DDTHH:mm', 기기 시간 그대로)이다. 업로드한 날이 아니다.
import { backend, isServerMode } from './backend';
import { syncList } from './db';
import { currentUserId } from './currentUser';
import type { Visibility } from './charStore';
import type { MsgKind } from './kakao/parse';

export const SSUL_KEY = 'ohome.ssul.v1';
export const SSUL_BODY_KEY = 'ohome.ssulbody.v1';
export const SSUL_IMP_KEY = 'ohome.ssulimp.v1';

export interface SsulMsg {
  /** 원본 파일 안에서의 순번 (업로드마다 새로 매겨진다 — 같은 썰 안에서 순서 비교용) */
  i: number;
  at: string;
  sender: string;
  text: string;
  kind: MsgKind;
  media?: { count?: number; file?: string; srcs?: string[] };
  sticker?: boolean;
  /** 편집 모드에서 고친 메시지 */
  edited?: boolean;
}

export interface Ssul {
  id: string;
  title: string;
  summary?: string;
  /** 대화 상대 — 업로드 기록과 맞춰 겹치는 기간을 거른다 */
  partner: string;
  /** 업로드한 사람 쪽 이름 (말풍선 좌우 구분) */
  me?: string;
  start: string;
  end: string;
  count: number;
  relId?: string;
  auId?: string;
  tags: string[];
  visibility: Visibility;
  createdAt: string;
}

export interface SsulBody {
  id: string;
  msgs: SsulMsg[];
  visibility: Visibility;
}

export interface SsulImport {
  id: string;
  partner: string;
  file: string;
  /** 이번 업로드에서 분석한 구간 (채팅 시각) */
  from: string;
  to: string;
  ssuls: number;
  at: string;
  visibility: Visibility;
}

export const SSUL_SEED: Ssul[] = [];
export const SSUL_IMP_SEED: SsulImport[] = [];

/** 이 상대와 이미 올린 마지막 채팅 시각 — 이 시각까지는 다음 업로드에서 건너뛴다 */
export const lastImportedAt = (imps: SsulImport[], partner: string): string | null =>
  imps.filter(r => r.partner === partner).reduce<string | null>((m, r) => (!m || r.to > m ? r.to : m), null);

/** 'YYYY-MM-DDTHH:mm' → 'YYYY.MM.DD' */
export const fmtDay = (at: string) => at.slice(0, 10).replace(/-/g, '.');

/** 썰 기간 표시 — 하루면 날짜 하나, 여러 날이면 시작~끝 */
export function fmtRange(s: Pick<Ssul, 'start' | 'end'>): string {
  const a = s.start.slice(0, 10), b = s.end.slice(0, 10);
  if (a === b) return fmtDay(s.start);
  return a.slice(0, 4) === b.slice(0, 4) ? `${fmtDay(s.start)} ~ ${b.slice(5).replace('-', '.')}` : `${fmtDay(s.start)} ~ ${fmtDay(s.end)}`;
}

/** AU 키 — 필터·LLM 후보 공용. 원래 설정은 'relId:base' */
export const auKeyOf = (s: { relId?: string; auId?: string }) => (s.relId ? `${s.relId}:${s.auId ?? 'base'}` : '');

/* ---------- 본문 — 목록과 달리 한 개씩 읽고 쓴다 ---------- */

const localBodies = (): SsulBody[] => {
  try { return JSON.parse(localStorage.getItem(SSUL_BODY_KEY) ?? '[]') as SsulBody[]; } catch { return []; }
};

export async function fetchBody(id: string): Promise<SsulBody | null> {
  if (isServerMode()) return ((await backend()!.fetchOne('ssul_bodies', id)) as unknown as SsulBody | null) ?? null;
  return localBodies().find(b => b.id === id) ?? null;
}

/** 본문 저장 — prev(이미 저장돼 있던 것)와 next를 비교해 바뀐 것만. 새로 만들면 prev는 빈 배열 */
export async function saveBodies(prev: SsulBody[], next: SsulBody[]): Promise<void> {
  for (const b of next) {
    // Firestore 문서 상한(1MB) — 넘으면 저장이 통째로 거부되므로 미리 알린다
    if (new TextEncoder().encode(JSON.stringify(b)).length > 950_000) {
      throw new Error('대화가 너무 길어 한 썰로 저장할 수 없습니다 — 상세 편집에서 나누거나 메시지를 줄여 주세요');
    }
  }
  if (isServerMode()) { await syncList('ssul_bodies', prev as unknown as { id: string }[], next as unknown as { id: string }[], currentUserId()); return; }
  const prevIds = new Set(prev.map(b => b.id));
  const nextMap = new Map(next.map(b => [b.id, b]));
  const kept = localBodies().filter(b => !prevIds.has(b.id) || nextMap.has(b.id)).map(b => nextMap.get(b.id) ?? b);
  const have = new Set(kept.map(b => b.id));
  localStorage.setItem(SSUL_BODY_KEY, JSON.stringify([...kept, ...next.filter(b => !have.has(b.id))]));
}

/* ---------- AU 선택지 — 자관 × AU ---------- */

export interface AuChoice { key: string; relId: string; auId: string; label: string; chars: string[] }

/** 모든 자관의 원래 설정 + AU — 업로드 판별 후보·필터·편집 선택 칸 공용 */
export function auChoices(
  rels: { id: string; name: string; members: { charId: string }[]; aus: { id: string; label: string }[] }[],
  chars: { id: string; name: string }[],
): AuChoice[] {
  return rels.flatMap(r => {
    const names = r.members.map(m => chars.find(c => c.id === m.charId)?.name).filter((n): n is string => !!n);
    const base: AuChoice = { key: `${r.id}:base`, relId: r.id, auId: 'base', label: r.name, chars: names };
    return [base, ...r.aus.filter(a => a.id !== 'base').map(a => ({
      key: `${r.id}:${a.id}`, relId: r.id, auId: a.id, label: `${r.name} · ${a.label || 'AU'}`, chars: names,
    }))];
  });
}

/** 저장용 — 'relId:auId' → { relId, auId } (원래 설정은 auId 비움, 다른 글들과 같은 규칙) */
export function splitAuKey(key: string): { relId?: string; auId?: string } {
  if (!key) return { relId: undefined, auId: undefined };
  const [relId, auId] = key.split(':');
  return { relId, auId: auId && auId !== 'base' ? auId : undefined };
}
