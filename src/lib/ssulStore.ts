'use client';
// 썰 백업 (카톡 아카이브) — 카톡에서 나눈 썰을 대화 그대로 보관한다.
//
//   ssul          목록 문서 (제목·날짜·태그·자관 AU) — 타임라인·자관 상세가 통째로 받는다
//   ssul_bodies   대화 본문 (메시지 배열) — 상세에서 fetchOne으로 하나씩만. id는 목록 문서와 같다
//   ssul_imports  업로드 기록 — 상대별 마지막 대화 시각. 다음 업로드는 그 이후만 분석한다
//
// 날짜는 전부 **채팅 시각**('YYYY-MM-DDTHH:mm', 기기 시간 그대로)이다. 업로드한 날이 아니다.
import { useEffect, useState } from 'react';
import { backend, isServerMode } from './backend';
import { getSetting, setSetting, onSettingChange } from './settingStore';
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
  /** 열람 비밀번호 (TRPG 로그와 같은 방식) — 화면에서만 확인하는 것이라 완전한 차단은 아니다.
   *  비밀번호가 있으면 목록·본문을 공개로 저장해, 권한이 없는 사람도 비밀번호만 알면 열 수 있게 한다 */
  password?: string;
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

/** 실제로 저장할 공개범위 — 비밀번호가 걸리면 공개(목록에서 보이고 비밀번호로 연다, TRPG 로그와 같은 규칙) */
export const storedVis = (vis: Visibility, password?: string): Visibility => (password?.trim() ? 'public' : vis);

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

/* ---------- 이름·키워드 사전 — 업로드할 때마다 자동 적용 ----------
   names   대화 속 이름 바꾸기 (예: 카톡 닉네임 「승리자」 → 「바야」)
   alias   비슷한 키워드 통일 (예: 가정상황 → IF, 업어주기 → 업기)
   blocked 지운 키워드 — 판별이 다시 붙여도 빼 버린다
   사이트 설정(관리자만 쓰기)에 둔다 — 키워드는 어차피 목록에 공개로 보이는 값이다 */
export const SSUL_DICT_KEY = 'ohome.ssuldict.v1';
export interface SsulDict { names: Record<string, string>; alias: Record<string, string>; blocked: string[] }
export const EMPTY_DICT: SsulDict = { names: {}, alias: {}, blocked: [] };

const tagKey = (t: string) => t.trim().replace(/^#/, '').toLowerCase();

/** 키워드 한 개 → 통일된 이름 (지운 키워드면 null). 별칭이 꼬리를 물면 끝까지 따라간다 */
export function canonTag(t: string, d: SsulDict): string | null {
  let cur = t.trim().replace(/^#/, '');
  const alias = new Map(Object.entries(d.alias).map(([k, v]) => [tagKey(k), v]));
  for (let hop = 0; hop < 10; hop++) {
    const next = alias.get(tagKey(cur));
    if (!next || tagKey(next) === tagKey(cur)) break;
    cur = next;
  }
  if (!cur || d.blocked.some(b => tagKey(b) === tagKey(cur))) return null;
  return cur;
}

/** 키워드 목록 정리 — 통일·삭제 반영 + 중복 제거 */
export function normTags(tags: string[], d: SsulDict): string[] {
  const out: string[] = [];
  for (const t of tags) {
    const c = canonTag(t, d);
    if (c && !out.some(o => tagKey(o) === tagKey(c))) out.push(c);
  }
  return out;
}

/** 이름 바꾸기 적용 */
export const renameMsgs = <M extends { sender: string }>(msgs: M[], names: Record<string, string>): M[] =>
  msgs.map(m => (names[m.sender]?.trim() ? { ...m, sender: names[m.sender].trim() } : m));

/** 사전 읽기·저장 — 다른 탭·화면에서 바꿔도 따라간다 */
export function useSsulDict(): [SsulDict, (d: SsulDict) => void] {
  const read = () => ({ ...EMPTY_DICT, ...getSetting<Partial<SsulDict>>(SSUL_DICT_KEY, EMPTY_DICT) });
  const [d, setD] = useState<SsulDict>(EMPTY_DICT);
  useEffect(() => {
    setD(read());
    return onSettingChange(k => { if (k === SSUL_DICT_KEY) setD(read()); });
  }, []);
  return [d, (next: SsulDict) => { setD(next); setSetting(SSUL_DICT_KEY, next); }];
}
