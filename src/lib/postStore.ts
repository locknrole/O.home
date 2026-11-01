'use client';
// 게시판·방명록 타입 + 공용 목록 저장소 훅
// v2.0: 서버(Supabase) 연결이 있으면 DB, 없으면 localStorage — 화면 코드는 동일하다.
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { PostMode } from './sanitize';
import { isServerMode } from './supabase';
import { TABLE_OF, fetchList, syncList, subscribeTable } from './db';
import { currentUserId } from './currentUser';
import { backend } from './backend';

/** 목록 저장 실패 알림 (v2.0) — 조용히 되돌리면 "쓴 게 바로 지워진다"로만 보여 원인을 알 수 없다.
 *  ListSync가 받아 화면에 띄운다 (설정 저장 실패 알림과 같은 방식) */
export const LIST_ERR_EVT = 'ohome-list-error';

export interface Comment {
  id: string;
  author: string;
  authorId: string;      // 게스트 댓글은 '' (방문자 권한 — 4.10/5.2)
  text: string;
  date: string;          // ISO
  parentId?: string;     // 대댓글
  guestPw?: string;      // 게스트 본인 수정·삭제용 (mock — 실서비스는 서버 해시)
}

/**
 * 댓글 한 줄 = 자기 문서 하나 (v2.0).
 *
 * 예전에는 댓글이 글(Post·RoadItem) 안 배열에 들어 있었다. 그래서 **댓글을 달려면 그 글을
 * UPDATE 해야 했고**, 보안 규칙의 「글 수정은 작성자 또는 관리자만」에 걸려 일반 회원이
 * 관리자 글에 댓글을 달면 서버가 거부했다 — 화면에는 잠깐 보였다가 서버 값으로 되돌아와
 * "댓글이 바로 지워지는" 것처럼 보였다 (포크 사용자 제보로 확인).
 *
 * 댓글을 별도 컬렉션으로 빼면 글을 건드릴 필요가 없고, 각 댓글이 자기 authorId를 가지므로
 * 「내가 쓴 댓글은 내가 수정·삭제」가 규칙 그대로 성립한다.
 */
export const COMMENT_KEY = 'ohome.comments.v1';

export interface CommentRow extends Comment {
  targetId: string;                 // 달린 대상(글·로드뷰 항목·감상타래·방명록)의 id
  /** 대상 종류 — 같은 컬렉션을 나눠 쓴다 (thread·guest: v2.0 사용자 요청) */
  target: 'post' | 'road' | 'thread' | 'guest';
}

export const COMMENT_SEED: CommentRow[] = [];

/** 대상 하나의 댓글 — 분리 저장분 + 옛 글 안에 남아 있던 것(legacy)을 합쳐 시간순으로 */
export function commentsFor(
  rows: CommentRow[], target: CommentRow['target'], targetId: string, legacy: Comment[] = [],
): Comment[] {
  const mine = rows.filter(r => r.target === target && r.targetId === targetId);
  const seen = new Set(mine.map(r => r.id));
  return [...legacy.filter(c => !seen.has(c.id)), ...mine]
    .sort((a, b) => a.date.localeCompare(b.date));
}

export type FoldType = 'spoiler' | 'adult' | 'custom';

export interface Post {
  id: string;
  title: string;
  body: string;
  mode: PostMode;        // 렌더 방식 (md / html)
  /** 무엇으로 썼는지 (v2.0) — 에디터로 쓴 글을 수정할 때 HTML 소스가 뜨지 않게 기억한다.
   *  렌더는 mode로 하고, 이 값은 수정 화면을 어떤 모드로 열지에만 쓴다. */
  authored?: 'editor';
  category: string;      // 말머리
  author: string;
  authorId: string;
  date: string;          // ISO
  secret: boolean;       // 비밀글
  notice: boolean;       // 공지 고정
  fold: { type: FoldType; label?: string } | null; // 스포일러/수위 접기 (6.2)
  comments: Comment[];
  boardId?: string;      // 소속 게시판 (5.2 다중 게시판 — 없으면 기본 'main')
  /** 태그 (v2.0 사용자 요청) — 기본형 목록의 작성자 왼쪽에 나열되고 검색에 걸린다 */
  tags?: string[];
  thumbSrc?: string;     // 티켓 스킨 대표 이미지 — 본문에 삽입한 이미지 중 선택 (v1.9)
  thumbCrop?: { x: number; y: number; scale: number };  // 대표 썸네일 크롭 (16:9)
  /** 연동 자관 (v2.0 사용자 요청 — TRPG 로그처럼 목록 오른쪽 자관 필터로 거른다). 없으면 「기타」 */
  relId?: string;
  /** 그 자관의 AU (v2.0 사용자 요청 — 자관 상세에서만 AU별로 나눠 본다). 없으면 원래 설정 */
  auId?: string;
}

export interface GuestEntry {
  id: string;
  author: string;
  authorId?: string;      // 로그인 회원이면
  guestPw?: string;       // 게스트 작성 시 본인 수정·삭제용 (mock — 실서비스는 서버 해시)
  body: string;
  secret: boolean;
  date: string;
  reply?: { author: string; text: string; date: string } | null; // 관리자 답글
}

export const BOARD_CATEGORIES = ['잡담', '설정', '합작', '기타'];

export const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

/* ---------- 서버 목록 공유 캐시 (v2.1) ----------
   예전엔 useLocalList를 부르는 곳마다 따로 목록 전체를 읽고 따로 구독했다. 캐릭터 목록은 16곳,
   자관은 17곳에서 불러서 한 화면에 위젯 몇 개만 떠도 같은 컬렉션을 여러 번 통째로 읽었고,
   글 하나가 바뀌면 그 수만큼 또 전체를 읽었다 (Firestore는 읽은 문서 수가 곧 요금·무료 한도다).
   이제 테이블마다 구독 하나를 모든 화면이 나눠 쓴다. 화면을 떠나도 잠시(LINGER) 살려 둬서
   메뉴를 오가면 다시 읽지 않고 바로 그린다. */
type Shared = { rows: unknown[]; loaded: boolean };
type Entry = {
  snap: Shared;
  subs: Set<() => void>;
  stop?: () => void;          // 구독 끄기 (지금 돌고 있으면)
  restart?: () => void;       // 로그인 상태가 바뀌었을 때 다시 시작
  reload?: () => void;        // 저장 실패 후 서버 값으로 되돌리기 (재조회 방식에서만)
  req: number;                // 재조회 순번 (재조회 방식) — 낡은 결과가 최신 화면을 덮지 않게
  linger?: ReturnType<typeof setTimeout>;
};
const EMPTY: Shared = { rows: [], loaded: false };
const LINGER_MS = 60_000;
const tables = new Map<string, Entry>();

const notify = (e: Entry, snap: Shared) => { e.snap = snap; e.subs.forEach(fn => fn()); };

/* 로그인 계정이 바뀌면 볼 수 있는 글이 달라진다(공개분/회원분/내 글) — 돌고 있는 구독을 모두 다시 시작.
   인증 구독은 앱 전체에 하나만 (테이블마다 걸면 바뀔 때마다 프로필을 그만큼 읽는다) */
let authOff: (() => void) | null = null;
let authUid: string | null | undefined;
function ensureAuthWatch() {
  const be = backend();
  if (authOff || !be) return;
  authOff = be.onAuthChange(u => {
    const id = u?.id ?? null;
    if (authUid === undefined) { authUid = id; return; }   // 처음 알려 주는 현재 상태 — 이미 그 상태로 읽고 있다
    if (id === authUid) return;
    authUid = id;
    tables.forEach(e => e.restart?.());
  });
}

function startEntry(table: string, e: Entry) {
  const be = backend();
  if (!be) return;
  let stopWatch: (() => void) | undefined;
  let gen = 0;
  const run = () => {
    stopWatch?.();
    const my = ++gen;
    if (be.watchList) {
      // 실시간 목록 — 스냅샷이 곧 목록 (Firebase)
      stopWatch = be.watchList(table,
        rows => { if (my === gen) notify(e, { rows, loaded: true }); },
        () => { if (my === gen && !e.snap.loaded) notify(e, { rows: e.snap.rows, loaded: true }); });
      return;
    }
    // 재조회 방식 (Supabase) — 바뀌었다는 신호가 오면 전체를 다시 읽는다. 겹친 요청은 마지막 것만
    const load = () => {
      const id = ++e.req;
      fetchList(table)
        .then(rows => { if (my === gen && id === e.req) notify(e, { rows, loaded: true }); })
        .catch(() => { if (my === gen && !e.snap.loaded) notify(e, { rows: e.snap.rows, loaded: true }); });
    };
    e.reload = load;
    load();
    stopWatch = subscribeTable(table, load);
  };
  run();
  e.restart = run;
  e.stop = () => { gen++; stopWatch?.(); stopWatch = undefined; e.stop = undefined; e.restart = undefined; e.reload = undefined; };
  ensureAuthWatch();
}

function acquire(table: string, fn: () => void): () => void {
  let e = tables.get(table);
  if (!e) { e = { snap: EMPTY, subs: new Set(), req: 0 }; tables.set(table, e); }
  const entry = e;
  if (entry.linger) { clearTimeout(entry.linger); entry.linger = undefined; }
  entry.subs.add(fn);
  if (!entry.stop) startEntry(table, entry);
  return () => {
    entry.subs.delete(fn);
    if (entry.subs.size) return;
    entry.linger = setTimeout(() => {
      if (entry.subs.size) return;
      entry.stop?.();
      tables.delete(table);
    }, LINGER_MS);
  };
}

const noopSub = () => () => { /* 로컬 모드 */ };
const emptySnap = () => EMPTY;

/** 목록 저장소 훅 — 서버 모드면 DB, 아니면 localStorage (v2.0)
 *
 *  화면 코드는 예전 그대로 `[목록, 통째로 저장, 로드완료]`를 쓴다.
 *  서버 모드에서는 저장할 때 이전/새 배열을 비교해 바뀐 행만 insert/update/delete 하고,
 *  다른 사람의 변경은 실시간 구독으로 받아 온다 — 구독과 목록은 같은 테이블을 쓰는 모든 화면이 공유한다(v2.1).
 *  (로컬 모드는 storage 이벤트로 탭 간 동기화)
 */
export function useLocalList<T extends { id?: string }>(key: string, seed: T[]): [T[], (next: T[]) => void, boolean] {
  const server = isServerMode() && !!TABLE_OF[key];
  const table = TABLE_OF[key];

  /* 서버 모드 — 공유 캐시를 구독한다.
     시드는 화면에 내보내지 않는다 (v2.0 사용자 발견) — 서버 목록을 받아오기 전까지 예시 데이터가
     잠깐 보였다 사라지는 깜빡임의 원인이었고, 시드를 기준으로 저장하면 없는 행을 지우려 들었다 */
  const sub = useCallback((fn: () => void) => acquire(table, fn), [table]);
  const getSnap = useCallback(() => tables.get(table)?.snap ?? EMPTY, [table]);
  const shared = useSyncExternalStore(server ? sub : noopSub, server ? getSnap : emptySnap, emptySnap);

  // 로컬 모드 — localStorage
  const [local, setLocal] = useState<T[]>(() => (server ? [] : seed));
  const [localLoaded, setLocalLoaded] = useState(false);
  const localRef = useRef<T[]>(local);
  localRef.current = local;
  useEffect(() => {
    if (server) return;
    try {
      const raw = localStorage.getItem(key);
      if (raw) setLocal(JSON.parse(raw));
    } catch { /* 시드 유지 */ }
    setLocalLoaded(true);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== key || e.newValue == null) return;
      try { setLocal(JSON.parse(e.newValue)); } catch { /* 무시 */ }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [key, server]);

  const update = useCallback((next: T[]) => {
    if (!server) {
      localRef.current = next;
      setLocal(next);
      try { localStorage.setItem(key, JSON.stringify(next)); } catch { /* 무시 */ }
      return;
    }
    const e = tables.get(table);
    // diff 기준 = 「DB에 있다고 아는」 상태 — 공유 캐시의 지금 목록
    const prev = (e?.snap.rows ?? []) as { id: string }[];
    if (e) {
      e.req++;   // 이 시점 이전에 나간 재조회는 낡은 것 — 뒤늦게 도착해도 이 낙관적 갱신을 덮지 않는다
      notify(e, { rows: next, loaded: true });   // 낙관적 반영 — 같은 목록을 보는 모든 화면이 즉시 바뀐다
    }
    syncList(table, prev, next as unknown as { id: string }[], currentUserId())
      .catch(err => {
        // 실패하면 서버 상태로 되돌려 화면과 DB가 어긋난 채로 남지 않게 —
        // 되돌리기만 하면 "방금 쓴 게 스스로 사라지는" 것처럼 보이므로 이유도 함께 알린다 (v2.0).
        // 실시간 목록은 거부된 쓰기를 SDK가 스스로 되돌려 다시 보내 준다. 재조회 방식만 직접 다시 읽는다
        console.error('[ohome] 저장 실패', err);
        try {
          window.dispatchEvent(new CustomEvent(LIST_ERR_EVT, {
            detail: { table, message: err instanceof Error ? err.message : String(err) },
          }));
        } catch { /* 무시 */ }
        tables.get(table)?.reload?.();
      });
  }, [key, server, table]);

  return server
    ? [shared.rows as T[], update, shared.loaded]
    : [local, update, localLoaded];
}

/* ---------- 시드 (데모) ---------- */
export const BOARD_SEED: Post[] = [];

export const GUEST_SEED: GuestEntry[] = [];

export const fmtDate = (iso: string) => {
  const d = new Date(iso);
  return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`;
};
