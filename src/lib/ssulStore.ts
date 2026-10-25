'use client';
// 썰 백업 (카톡 아카이브) — 카톡에서 나눈 썰을 대화 그대로 보관한다.
//
//   ssul          목록 문서 (제목·날짜·태그·자관 AU) — 타임라인·자관 상세가 통째로 받는다
//   ssul_bodies   대화 본문 (메시지 배열) — 상세에서 fetchOne으로 하나씩만. id는 목록 문서와 같다
//   ssul_imports  업로드 기록 — 상대별 마지막 대화 시각. 다음 업로드는 그 이후만 분석한다
//
// 날짜는 전부 **채팅 시각**('YYYY-MM-DDTHH:mm', 기기 시간 그대로)이다. 업로드한 날이 아니다.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { backend, isServerMode } from './backend';
import { getSetting, setSetting, onSettingChange } from './settingStore';
import { syncList } from './db';
import { useLocalList } from './postStore';
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
  /** 채팅 시작 월 'YYYY-MM' — 목록 페이지가 이 값으로 그 달 것만 서버에서 읽는다 (start에서 계산, 저장할 때 채움) */
  ym?: string;
  end: string;
  count: number;
  relId?: string;
  auId?: string;
  tags: string[];
  visibility: Visibility;
  /** (없앤 기능) 예전 열람 비밀번호 — 화면은 더 이상 쓰지 않는다. 남아 있으면 관리자가 썰 목록을 열 때
   *  지운다(공개 문서에 비밀번호가 평문으로 남지 않게). 열람 제한은 메뉴 공개범위로 한다 */
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

/** 'YYYY-MM-DDTHH:mm' → 'YYYY.MM.DD' */
export const fmtDay = (at: string) => at.slice(0, 10).replace(/-/g, '.');

/** 저장 직전에 — 월(ym)을 시작 시각에 맞춘다 */
export const withYm = (s: Ssul): Ssul => (s.ym === s.start.slice(0, 7) ? s : { ...s, ym: s.start.slice(0, 7) });

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

/* ---------- 즐겨찾기 — 회원마다 따로 ----------
   회원 한 명 = 문서 하나(id: fav_<회원id>, 나만보기). 목록 질의에서 남의 문서는 서버가 걸러 준다
   (관리자는 전부 받지만 화면은 자기 것만 쓴다). 로그인하지 않으면 즐겨찾기 없음 */
export const SSUL_FAV_KEY = 'ohome.ssulfav.v1';
export interface SsulFav { id: string; ids: string[]; visibility: Visibility; authorId?: string }
export const SSUL_FAV_SEED: SsulFav[] = [];

export function useSsulFavs(userId: string | undefined): { ids: Set<string>; toggle: (ssulId: string) => void; enabled: boolean } {
  const [favs, setFavs] = useLocalList<SsulFav>(SSUL_FAV_KEY, SSUL_FAV_SEED);
  const docId = userId ? `fav_${userId}` : '';
  const mine = favs.find(f => f.id === docId);
  // 문서가 바뀔 때만 새 Set — 화면의 useMemo가 매 렌더마다 다시 돌지 않게
  const ids = useMemo(() => new Set(mine?.ids ?? []), [mine]);
  const toggle = (ssulId: string) => {
    if (!userId) return;
    const nextIds = ids.has(ssulId) ? [...ids].filter(x => x !== ssulId) : [...ids, ssulId];
    const doc: SsulFav = { id: docId, ids: nextIds, visibility: 'private', authorId: userId };
    setFavs(mine ? favs.map(f => (f.id === docId ? doc : f)) : [...favs, doc]);
  };
  return { ids, toggle, enabled: !!userId };
}

/** /api/ssul/* 오류 코드 → 안내 문구 (업로드·썰 관리 공용) */
export function ssulErrText(code: string): string {
  const T: Record<string, string> = {
    'no-key': '서버에 ANTHROPIC_API_KEY가 없습니다 — Vercel 환경변수에 등록하고 다시 배포해 주세요',
    'bad-key': 'ANTHROPIC_API_KEY가 올바르지 않습니다',
    'no-credit': 'Anthropic API 크레딧이 부족합니다 — console.anthropic.com → Billing에서 충전한 뒤 이어서 진행해 주세요',
    'unauthorized': '관리자 로그인이 필요합니다',
    'rate-limit': '요청이 몰려 잠시 막혔습니다 — 조금 뒤 이어서 진행해 주세요',
    'refusal': '이 묶음은 모델이 처리를 거절했습니다',
    'too-long': '응답이 너무 길어졌습니다 — 다시 시도해 주세요',
  };
  return T[code] ?? `실패: ${code}`;
}

/* ---------- 화면 공용 ---------- */

export const VIS_OPTIONS: { value: Visibility; label: string }[] = [
  { value: 'public', label: '전체공개' },
  { value: 'member', label: '멤버공개' },
  { value: 'private', label: '나만보기' },
];

/** /api/ssul/<path> 호출 — 관리자 토큰을 붙이고, 실패면 오류 코드(ssulErrText로 안내 문구) */
export async function postSsulApi<T extends { error?: string }>(path: string, body: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const token = (await backend()?.authToken()) ?? '';
    const res = await fetch(`/api/ssul/${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const j = await res.json() as T;
    if (!res.ok || j.error) return { ok: false, error: j.error || `HTTP ${res.status}` };
    return { ok: true, data: j };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** 작업을 동시에 n개씩 — run이 오류 코드를 돌려주거나 던지면, 또는 stop()이 참이 되면 남은 건 시작하지 않는다.
 *  돌려주는 값은 실패 사유(없으면 ''). 판별·키워드 다시 붙이기가 같이 쓴다 */
export async function runPool<T>(jobs: T[], n: number, run: (job: T) => Promise<string | void>, stop: () => boolean = () => false): Promise<string> {
  let next = 0, failed = '';
  const worker = async () => {
    while (!failed && !stop() && next < jobs.length) {
      const job = jobs[next++];
      try { const err = await run(job); if (err) failed = err; } catch (e) { failed = e instanceof Error ? e.message : String(e); }
    }
  };
  await Promise.all(Array.from({ length: Math.min(n, jobs.length) }, worker));
  return failed;
}

/* ---------- 월별 읽기 — 목록 페이지가 매번 전체를 읽지 않게 ----------
   서버(Firestore)는 문서를 읽을 때마다 과금되므로, 목록은 기본으로 가장 최근 한 달만 읽는다.
   · 썰마다 ym('YYYY-MM')을 두고 data.ym == 값으로 그 달만 질의한다
   · 어떤 달이 있는지(기간 칸)는 사이트 설정의 월 목록(SSUL_MONTHS_KEY)으로 — 이걸 알려고 전체를 읽지 않게.
     월 목록은 썰 전체를 이미 들고 있는 관리자 화면(업로드·상세)이 바뀔 때마다 맞춰 둔다(useSyncSsulIndex) */
export const SSUL_MONTHS_KEY = 'ohome.ssulmonths.v1';

/** 썰이 있는 달 목록 (오름차순) — 아직 한 번도 맞춰 둔 적 없으면 빈 배열 */
export function useSsulMonths(): string[] {
  const read = () => getSetting<string[]>(SSUL_MONTHS_KEY, []);
  const [m, setM] = useState<string[]>([]);
  useEffect(() => {
    setM(read());
    return onSettingChange(k => { if (k === SSUL_MONTHS_KEY) setM(read()); });
  }, []);
  return m;
}

/** 관리자 화면에서 — 썰 전체를 들고 있을 때 월(ym)이 빠진 썰을 채우고, 월 목록을 맞춘다.
 *  없앤 비밀번호 기능의 흔적(password 칸)도 여기서 지운다 — 공개 문서에 평문으로 남지 않게 */
export function useSyncSsulIndex(ssuls: Ssul[], setSsuls: (next: Ssul[]) => void, ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const fixed = ssuls.map(s => {
      const t = withYm(s);
      return t.password ? { ...t, password: undefined } : t;
    });
    if (fixed.some((s, i) => s !== ssuls[i])) { setSsuls(fixed); return; }   // 저장되면 다시 불려 아래로 간다
    const months = [...new Set(ssuls.map(s => s.ym!))].sort();
    if (JSON.stringify(months) !== JSON.stringify(getSetting<string[]>(SSUL_MONTHS_KEY, []))) setSetting(SSUL_MONTHS_KEY, months);
  }, [ssuls, setSsuls, ready]);
}

/** 목록 페이지가 읽을 범위 */
export type SsulScope = { kind: 'all' } | { kind: 'months'; yms: string[] } | { kind: 'ids'; ids: string[] };

const localList = (): Ssul[] => {
  try { return JSON.parse(localStorage.getItem(SSUL_KEY) ?? '[]') as Ssul[]; } catch { return []; }
};

/** 범위만큼만 읽기 — 달별은 그 달 질의, 즐겨찾기는 그 문서들만, 그 밖엔 전체.
 *  서버가 달별 질의를 거부하면(색인 등) 전체를 읽어 거른다 — 화면이 비지 않게 */
export function useSsulScope(scope: SsulScope | null): { items: Ssul[]; loaded: boolean } {
  const key = scope ? JSON.stringify(scope) : '';
  const [state, setState] = useState<{ key: string; items: Ssul[] }>({ key: '', items: [] });
  const load = useCallback(async (sc: SsulScope): Promise<Ssul[]> => {
    const pick = (all: Ssul[]) => sc.kind === 'all' ? all
      : sc.kind === 'months' ? all.filter(s => sc.yms.includes(s.start.slice(0, 7)))
        : all.filter(s => sc.ids.includes(s.id));
    if (!isServerMode()) return pick(localList());
    const be = backend()!;
    try {
      const all = async () => (await be.fetchList('ssul')) as unknown as Ssul[];
      if (sc.kind === 'all') return await all();
      if (sc.kind === 'ids') {
        const got = await Promise.all(sc.ids.map(id => be.fetchOne('ssul', id)));
        return got.filter(x => !!x) as unknown as Ssul[];
      }
      const parts = await Promise.all(sc.yms.map(ym => be.fetchListWhere('ssul', 'ym', ym)));
      return parts.flat() as unknown as Ssul[];
    } catch (err) {
      console.warn('[ohome] 썰 부분 읽기 실패 — 전체 읽기로 대신합니다', err);
      return pick((await be.fetchList('ssul')) as unknown as Ssul[]);
    }
  }, []);
  useEffect(() => {
    if (!scope) return;
    let alive = true;
    void load(scope).then(items => { if (alive) setState({ key, items }); }).catch(() => { if (alive) setState({ key, items: [] }); });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, load]);
  return { items: state.key === key ? state.items : [], loaded: !!scope && state.key === key };
}
