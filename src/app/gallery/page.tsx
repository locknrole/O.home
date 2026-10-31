'use client';
// EditableDesc 주입
// 그림백업게시판 (4.11) — 갤러리/리스트 토글 · 로그/단일 뱃지 · 접기 썸네일 블러
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { Masonry } from '@/components/ui/Masonry';
import { Relation, REL_SEED } from '@/lib/charStore';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useSectionParam, filterSection, sectionSetter, secQuery } from '@/lib/sectionStore';
import { useLocalList, fmtDate } from '@/lib/postStore';
import { BackupPost, BACKUP_SEED } from '@/lib/galleryStore';
import { SearchBar, Pager, KSelect } from '@/components/ui/Kit';
import { createPortal } from 'react-dom';
import { CroppedBlobImg, CropEditor, CropValue } from '@/components/ui/CropEditor';
import { useBlobUrl, useThumbSrc } from '@/lib/blobStore';
import { EditableDesc, PageTitle } from '@/components/ui/PageText';
import { useMainStore } from '@/lib/mainStore';
import { useCardSort, mergeOrder } from '@/lib/cardSort';
import { useMenuSettings, canGalleryWrite } from '@/lib/menuStore';

const FOLD_LABEL = { spoiler: '스포일러', adult: '수위 주의' };
/** 갤러리 무한 스크롤 한 묶음 — 카드는 이미지만 (제목·날짜는 상세에서, v2.0 사용자 요청) */
const FEED_STEP = 24;

/** 핀터레스트형 카드 — 대표 이미지를 원래 비율로. 비율은 Masonry에 알린다.
 *  썸네일 크롭은 리스트 보기에만 쓴다 — 갤러리 보기는 크롭을 지정해도 원본 비율 그대로 (v2.1 사용자 요청) */
function GalleryCard({ p, folded, report, onUnveil }: {
  p: BackupPost; folded: boolean; report: (ratio: number) => void; onUnveil: () => void;
}) {
  const [url, onThumbErr] = useThumbSrc(p.images[0]);   // 목록 카드는 썸네일로 (v2.1)
  const reported = useRef(false);
  const done = (r: number) => { if (!reported.current) { reported.current = true; report(r); } };
  useEffect(() => {
    if (!p.images[0]) { done(0.75); return; }   // 이미지 없는 글 — 자리표시 4:3
    // 끝내 안 불러와지는 이미지가 뒤 카드들을 막지 않게
    const t = setTimeout(() => done(0.75), 8000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.images[0]]);
  return (
    <>
      <div className={`gm-img ${folded ? 'veil' : ''}`}>
        {url
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={url} alt={p.title} draggable={false}
            onLoad={e => done(e.currentTarget.naturalHeight / e.currentTarget.naturalWidth)}
            onError={() => { if (onThumbErr) onThumbErr(); else done(0.75); }} />
          : <div className={`ph ${p.phList[0] ?? 'cool'}`} style={{ width: '100%', height: '100%' }} />}
        {/* 유형 뱃지(로그/단일 …)는 리스트에서 뺐다 (v2.0 사용자 요청) — 상세에는 그대로 */}
        {count(p) > 1 && <span className="gm-cnt">{count(p)}</span>}
        {folded && (
          <div className="cover" onClick={e => { e.stopPropagation(); onUnveil(); }}>
            <div>
              <b>{p.fold!.type === 'custom' ? (p.fold!.label || '접힘') : FOLD_LABEL[p.fold!.type]}</b><br />
              <span>클릭하여 표시</span>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

const count = (p: BackupPost) => Math.max(p.images.length, p.phList.length);

function BackupPageInner() {
  const router = useRouter();
  const { user, isAdmin } = useAuth();
  const { editOn } = useMainStore();
  const [postsAll, setPostsAll] = useLocalList<BackupPost>('ohome.backup.v1', BACKUP_SEED);
  // 여러 개로 만든 섹션 (v2.0) — 주소의 ?s= 가 가리키는 것만 보여 준다
  const sec = useSectionParam('gallery');
  const posts = filterSection(postsAll, sec.id);
  // 저장은 이 섹션 자리만 교체 — 걸러진 목록을 그대로 넘겨도 다른 섹션이 지워지지 않는다
  const setPosts = sectionSetter(postsAll, sec.id, setPostsAll);
  // 기본 보기 — 환경설정 > 메뉴 관리의 갤러리 항목에서 지정 (5.2)
  const [menuSet, , menuLoaded] = useMenuSettings();
  const [view, setView] = useState<'gal' | 'list'>('gal');
  const [viewInit, setViewInit] = useState(false);
  useEffect(() => {
    if (menuLoaded && !viewInit) { setView(menuSet.backupView); setViewInit(true); }
  }, [menuLoaded, viewInit, menuSet.backupView]);
  const [q, setQ] = useState('');
  const [unveiled, setUnveiled] = useState<Record<string, boolean>>({});
  /* 우클릭 → 썸네일 수정 (v2.0 사용자 요청) — 리스트에서 바로 대표 이미지 크롭을 고친다.
     수정 화면까지 안 가도 되게. 관리자와 글쓴이만, 이미지가 있는 글만 */
  const [ctx, setCtx] = useState<{ x: number; y: number; post: BackupPost } | null>(null);
  const [cropPost, setCropPost] = useState<BackupPost | null>(null);
  useEffect(() => {
    if (!ctx) return;
    const close = () => setCtx(null);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [ctx]);
  const onCtx = (e: React.MouseEvent, p: BackupPost) => {
    if (!(isAdmin || (!!user && p.authorId === user.id)) || !p.images[0]) return;
    e.preventDefault();
    e.stopPropagation();
    setCtx({ x: e.clientX, y: e.clientY, post: p });
  };

  // 자관 필터 (v2.0 사용자 요청 — 게시판·TRPG 로그와 같은 방식): all | none(기타) | 자관 id
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [relF, setRelF] = useState('all');
  const canSee = (p: BackupPost) => isAdmin || p.visibility === 'public' || (p.visibility === 'member' && !!user);
  // 자관별 글 수 — 볼 수 있는 글 기준, 검색과 무관하게 (TRPG·게시판과 같음)
  const relCounts: Record<string, number> = {};
  posts.filter(canSee).forEach(p => { const k = p.relId ?? 'none'; relCounts[k] = (relCounts[k] ?? 0) + 1; });
  const relTotal = Object.values(relCounts).reduce((a, n) => a + n, 0);
  const visible = posts
    .filter(canSee)
    .filter(p => relF === 'all' || (relF === 'none' ? !p.relId : p.relId === relF))
    .filter(p => !q || p.title.includes(q) || p.category.includes(q)
      || (p.tags ?? []).some(t => t.toLowerCase().includes(q.toLowerCase())));   // 태그 검색 (v2.0)

  // 편집모드 카드 드래그 정렬 (v1.9 — 갤러리 보기)
  const sort = useCardSort(visible, next => setPosts(mergeOrder(posts, next)), editOn && isAdmin);

  /* 리스트 보기는 페이지로 (v2.0 사용자 요청) — 글 목록과 같은 20개.
     갤러리 보기는 핀터레스트형 무한 스크롤 — FEED_STEP개씩 이어 붙인다 */
  const PER = 20;
  const [feedN, setFeedN] = useState(FEED_STEP);
  const [feedReady, setFeedReady] = useState(false);
  const feed = visible.slice(0, feedN);
  const sentinelRef = useRef<HTMLDivElement>(null);
  useEffect(() => { setFeedN(FEED_STEP); }, [q, view, sec.id, relF]);
  useEffect(() => { setRelF('all'); }, [sec.id]);   // 다른 갤러리(섹션)로 가면 전체로
  // 끝 표시가 보이고 지금 묶음이 다 자리를 잡았으면 다음 묶음. 조건이 바뀔 때마다 다시 관찰해서
  // 이미 보이는 상태(짧은 목록·큰 화면)여도 첫 콜백으로 바로 이어진다
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || view !== 'gal' || !feedReady || feedN >= visible.length) return;
    const io = new IntersectionObserver(es => {
      if (es.some(e => e.isIntersecting)) setFeedN(n => n + FEED_STEP);
    }, { rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [view, feedReady, feedN, visible.length]);
  const [page, setPage] = useState(1);
  const pages = Math.max(1, Math.ceil(visible.length / PER));
  const cur = Math.min(page, pages);      // 검색·보기 전환으로 줄면 마지막 장으로 당긴다
  const start = (cur - 1) * PER;
  const paged = visible.slice(start, start + PER);
  useEffect(() => { setPage(1); }, [q, view, relF]);   // 검색어·보기·자관 필터를 바꾸면 첫 장부터

  const meta = (p: BackupPost) =>
    `${count(p)}장 · ${fmtDate(p.madeDate ? p.madeDate + 'T00:00:00' : p.date)}`;

  return (
    <section className="page">
      <div className="page-head">
        <PageTitle>{sec.id === 'main' ? 'GALLERY' : sec.name}</PageTitle>
        <EditableDesc k="backup-desc" def="로그형(웹툰 스크롤) / 단일형(좌우 넘김) · 리스트/갤러리 보기 전환" />
      </div>
      <div className="toolrow">
        <div className="seg">
          <button className={view === 'gal' ? 'on' : ''} onClick={() => setView('gal')}>갤러리</button>
          <button className={view === 'list' ? 'on' : ''} onClick={() => setView('list')}>리스트</button>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {/* 자관 필터 — 검색칸 왼쪽 드롭다운 (v2.0 사용자 요청: 오른쪽 칸이 그림 영역을 좁혀서 위로 옮김) */}
          <span className="rel-select">
            <KSelect minWidth={130} value={relF} onChange={setRelF}
              options={[
                { value: 'all', label: `자관 · 전체 ${relTotal}` },
                ...rels.filter(r => relCounts[r.id]).map(r => ({ value: r.id, label: `${r.name} ${relCounts[r.id]}` })),
                ...(relCounts['none'] > 0 ? [{ value: 'none', label: `기타 ${relCounts['none']}` }] : []),
              ]} />
          </span>
          <SearchBar onSearch={setQ} />
          {/* 글쓰기 권한 (v2.0 사용자 요청) — 메뉴 관리에서 갤러리별로 · 멤버 선택으로 좁힐 수 있다 */}
          {canGalleryWrite(menuSet, sec.id, { loggedIn: !!user, isAdmin, id: user?.id }) && (
            <button className="btn btn-dark" onClick={() => router.push('/gallery/write' + secQuery('gallery', sec.id))}>✎ WRITE</button>
          )}
        </div>
      </div>

      {/* 갤러리/리스트 모두 렌더해 두고 display로만 전환 (v1.9) —
          전환 때마다 재마운트되며 이미지가 다시 로드·등장하던 깜빡임 제거 */}
      {/* 갤러리 보기 = 핀터레스트형 (v2.0 사용자 요청) — 원래 비율 그대로 이어 붙이고, 끝에 닿으면 다음 묶음 */}
      {/* 가로가 세로의 1.5배(3:2) 이상인 그림은 두 칸 폭 (v2.0 사용자 요청 — B안) */}
      <div style={{ display: view === 'gal' && visible.length > 0 ? undefined : 'none' }}>
        <Masonry items={feed} infoH={0} wideRatio={0.67} complete={feed.length >= visible.length} onReadyChange={setFeedReady}
          itemProps={(p, i) => ({
            ...sort(i),
            onClick: () => { if (!(p.fold && !unveiled[p.id]) && !editOn) router.push(`/gallery/${p.id}`); },
            onContextMenu: (e: React.MouseEvent) => onCtx(e, p),
          })}
          renderItem={(p, _i, report) => (
            <GalleryCard p={p} folded={!!p.fold && !unveiled[p.id]} report={report}
              onUnveil={() => setUnveiled(u => ({ ...u, [p.id]: true }))} />
          )} />
        {/* 끝 표시 — 화면에 들어오면 다음 묶음 (앞 묶음이 다 자리 잡은 뒤에만) */}
        <div ref={sentinelRef} className="mz-end">{feed.length >= visible.length && visible.length > FEED_STEP ? '✦' : ''}</div>
      </div>
      {/* 게시물이 없으면 컨테이너 자체를 숨김 — 빈 패널이 안내문 위에 카드처럼 남던 버그 (v1.9 사용자 발견) */}
      <div className="panel flush" style={{ display: view === 'list' && visible.length > 0 ? undefined : 'none' }}>
          {paged.map(p => (
            <div key={p.id} className="list-item" onClick={() => router.push(`/gallery/${p.id}`)}
              onContextMenu={e => onCtx(e, p)}>
              <div className="th" style={{ position: 'relative' }}><CroppedBlobImg thumb fileRef={p.images[0]} crop={p.thumbCrop} ph={p.phList[0] ?? 'cool'} /></div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>
                  {p.title}
                  {/* 유형 뱃지는 뺐다 (v2.0 사용자 요청) — 접힘 표시만 남긴다 */}
                  {p.fold && <span className="pill red" style={{ marginLeft: 6 }}>접힘</span>}
                </b>
                <small>
                  {meta(p)}
                  {/* 태그 — 작성자 왼쪽 줄에 (v2.0 사용자 요청) */}
                  {(p.tags ?? []).map(t => <i key={t} className="tag-in">#{t}</i>)}
                </small>
              </div>
              <small>{p.author}</small>
            </div>
          ))}
        </div>
      {visible.length === 0 && (
        <div className="panel" style={{ textAlign: 'center', padding: 44, fontSize: 13, color: 'var(--faint)' }}>
          게시물이 없습니다
        </div>
      )}
      {view === 'list' && visible.length > PER && <Pager page={cur} total={pages} onChange={setPage} />}

      {/* 우클릭 메뉴 — 다른 우클릭들과 같은 순서: 메뉴 → 항목 선택 (v2.0) */}
      {ctx && typeof document !== 'undefined' && createPortal(
        <div style={{
          position: 'fixed', left: ctx.x, top: ctx.y, zIndex: 130,
          background: 'var(--panel-solid,#fff)', border: '1px solid var(--line)', borderRadius: 9,
          boxShadow: 'var(--sh-dd)', padding: 4, display: 'grid', minWidth: 128,
        }} onMouseDown={e => e.stopPropagation()}>
          <div style={{
            padding: '6px 12px 5px', fontSize: 10.5, color: 'var(--faint)', maxWidth: 200,
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            borderBottom: '1px solid var(--line)', marginBottom: 3,
          }}>{ctx.post.title}</div>
          <button style={{ padding: '7px 12px', fontSize: 12, borderRadius: 6, textAlign: 'left' }}
            onClick={() => { setCropPost(ctx.post); setCtx(null); }}>썸네일 수정</button>
        </div>,
        document.body,
      )}

      {/* 썸네일 크롭 — 작성 폼과 같은 4:3 크롭을 리스트에서 바로 (v2.0 사용자 요청) */}
      {cropPost && (
        <ThumbCropModal post={cropPost} onClose={() => setCropPost(null)}
          onApply={crop => {
            setPosts(posts.map(x => (x.id === cropPost.id ? { ...x, thumbCrop: crop } : x)));
            setCropPost(null);
          }} />
      )}
    </section>
  );
}

/** 대표 이미지 크롭 모달 — blob을 URL로 풀어 CropEditor에 (훅이라 컴포넌트로 분리) */
function ThumbCropModal({ post, onClose, onApply }: {
  post: BackupPost; onClose: () => void; onApply: (c: CropValue) => void;
}) {
  const url = useBlobUrl(post.images[0]);
  if (!url) return null;
  return <CropEditor open src={url} aspect="4:3" initial={post.thumbCrop} onClose={onClose} onApply={onApply} />;
}

/** ?s= 를 읽으므로 Suspense 경계가 필요하다 (Next App Router) */
export default function BackupPage() {
  return <Suspense fallback={<section className="page" />}><BackupPageInner /></Suspense>;
}
