'use client';
// 인용구 모음 (v2.1 사용자 요청) — 카드를 세 줄(좁으면 두·한 줄)로 차곡차곡.
// 오른쪽 위 UFO를 누르면 빛줄기가 카드를 위에서 아래로 훑으며 **같은 자리**가 뒷면(출처·코멘트·날짜·댓글)으로 바뀐다.
// 카드 크기는 앞면 그대로 — 뒷면이 길면 카드 안에서 스크롤. 다시 누르면 같은 방향으로 앞면.
// 쓰기·댓글 권한은 환경설정 > 메뉴 관리의 인용구 항목, 댓글은 감상타래와 같은 comments 컬렉션(target 'quote')
import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useLocalList, newId, fmtDate, CommentRow, COMMENT_KEY, COMMENT_SEED, commentsFor } from '@/lib/postStore';
import { Quote, QUOTE_KEY, QUOTE_SEED, fmtQuoteDate } from '@/lib/quoteStore';
import type { Visibility } from '@/lib/charStore';
import { useMenuSettings, MenuPerm } from '@/lib/menuStore';
import { KInput, KTextarea, KSelect } from '@/components/ui/Kit';
import { GuestIdBar } from '@/components/ui/GuestId';
import { Modal, useConfirmDelete } from '@/components/ui/Modal';
import { EditableDesc, PageTitle } from '@/components/ui/PageText';
import { useToast } from '@/components/ui/Toast';
import { pushNotif } from '@/lib/notifStore';

const PER_PAGE = 15;
const VIS_OPTIONS = [
  { value: 'public', label: '전체 공개' },
  { value: 'member', label: '회원 공개' },
  { value: 'private', label: '나만 보기' },
];
type Draft = { id?: string; text: string; source: string; memo: string; visibility: Visibility };
const EMPTY: Draft = { text: '', source: '', memo: '', visibility: 'public' };

/** 로고 옆 장식과 같은 UFO 선 그림 */
const UfoIcon = () => (
  <svg viewBox="0 0 24 24" aria-hidden><path d="M8 11a4 4 0 0 1 8 0" /><ellipse cx="12" cy="12.5" rx="9" ry="2.6" /></svg>
);

export default function QuotesPage() {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const del = useConfirmDelete();
  const [menuSet] = useMenuSettings();
  const allow = (p: MenuPerm) => (p === 'admin' ? isAdmin : p === 'member' ? !!user : true);
  const cmtPerm = menuSet.quoteComment ?? 'guest';
  const canWrite = !!user && allow(menuSet.quoteUpload ?? 'member');
  const canComment = allow(cmtPerm) && (!!user || cmtPerm === 'guest');
  const [quotes, setQuotes, loaded] = useLocalList<Quote>(QUOTE_KEY, QUOTE_SEED);
  const [cmtRows, setCmtRows] = useLocalList<CommentRow>(COMMENT_KEY, COMMENT_SEED);
  const [page, setPage] = useState(0);
  const [draft, setDraft] = useState<Draft | null>(null);

  const visible = useMemo(() => quotes
    .filter(q => isAdmin || q.visibility === 'public' || (q.visibility === 'member' && user) || (user && q.authorId === user.id))
    .sort((a, b) => b.no - a.no), [quotes, isAdmin, user]);
  const pages = Math.max(1, Math.ceil(visible.length / PER_PAGE));
  const cur = Math.min(page, pages - 1);
  const shown = visible.slice(cur * PER_PAGE, (cur + 1) * PER_PAGE);

  // 열 개수 — 폭에 맞춰 3/2/1. 카드는 왼쪽부터 가로로 번갈아 놓는다 (25·24·23 / 22·21·20 …)
  const wrapRef = useRef<HTMLDivElement>(null);
  const [cols, setCols] = useState(3);
  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => { const w = el.clientWidth; setCols(w >= 640 ? 3 : w >= 420 ? 2 : 1); };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [loaded]);
  const columns = Array.from({ length: cols }, (_, c) => shown.filter((_, i) => i % cols === c));

  const save = () => {
    if (!draft || !user) return;
    if (!draft.text.trim()) { toast('인용구를 입력해 주세요'); return; }
    const body = { text: draft.text.trim(), source: draft.source.trim(), memo: draft.memo.trim(), visibility: draft.visibility };
    if (draft.id) {
      setQuotes(quotes.map(q => q.id === draft.id ? { ...q, ...body } : q));
    } else {
      const no = Math.max(0, ...quotes.map(q => q.no)) + 1;
      setQuotes([{ id: newId(), no, ...body, author: user.nickname, authorId: user.id, date: new Date().toISOString() }, ...quotes]);
      setPage(0);
    }
    setDraft(null);
  };
  const remove = (q: Quote) =>
    del.ask(`No. ${q.no} 인용구를 삭제하시겠습니까?`, () => {
      setQuotes(quotes.filter(x => x.id !== q.id));
      setCmtRows(cmtRows.filter(c => !(c.target === 'quote' && c.targetId === q.id)));
    });
  const addComment = (q: Quote, row: CommentRow) => {
    setCmtRows([...cmtRows, row]);
    // 알림 — 인용구를 올린 사람에게 (본인 댓글 제외)
    if (q.authorId && q.authorId !== (user?.id ?? '')) {
      pushNotif({ type: 'comment', toUserId: q.authorId, href: '/quotes', title: `No. ${q.no} 인용구에 새 댓글`, body: `${row.author} — ${row.text.slice(0, 50)}` });
    }
  };

  if (!loaded) return <section className="page" />;

  return (
    <section className="page page-quotes">
      <div className="page-head">
        <PageTitle>QUOTES</PageTitle>
        <EditableDesc k="quotes-desc" def="모아 둔 문장들 · UFO를 누르면 뒷면" />
        <div className="head-actions">
          {canWrite && <button className="btn btn-dark" onClick={() => setDraft({ ...EMPTY })}>✎ WRITE</button>}
        </div>
      </div>

      {pages > 1 && (
        <div className="qt-pager">
          {Array.from({ length: pages }, (_, i) => (
            <button key={i} className={i === cur ? 'on' : ''} onClick={() => setPage(i)}>{i + 1}</button>
          ))}
          {cur < pages - 1 && <button onClick={() => setPage(cur + 1)}>&gt;&gt;</button>}
        </div>
      )}

      {visible.length === 0 && (
        <div className="panel" style={{ textAlign: 'center', padding: 44, fontSize: 13, color: 'var(--faint)' }}>인용구가 없습니다</div>
      )}

      <div className="qt-grid" ref={wrapRef}>
        {columns.map((col, c) => (
          <div className="qt-col" key={c}>
            {col.map(q => (
              <QuoteCard key={q.id} q={q} canComment={canComment} guestMode={!user && cmtPerm === 'guest'}
                comments={commentsFor(cmtRows, 'quote', q.id)}
                onComment={row => addComment(q, row)}
                onRemoveComment={id => del.ask('이 댓글을 삭제하시겠습니까?', () => setCmtRows(cmtRows.filter(x => x.id !== id)))}
                canEdit={!!q.authorId && q.authorId === user?.id}
                canDelete={isAdmin || (!!q.authorId && q.authorId === user?.id)}
                onEdit={() => setDraft({ id: q.id, text: q.text, source: q.source, memo: q.memo, visibility: q.visibility })}
                onRemove={() => remove(q)} />
            ))}
          </div>
        ))}
      </div>

      <Modal open={draft !== null} title={draft?.id ? '인용구 수정' : '인용구 쓰기'} onClose={() => setDraft(null)} dirty={!!draft?.text.trim()}
        actions={<>
          <button className="btn btn-ghost" onClick={() => setDraft(null)}>CANCEL</button>
          <button className="btn btn-dark" onClick={save}>SAVE</button>
        </>}>
        {draft && (
          <div className="qt-form">
            <label>인용구<KTextarea rows={8} value={draft.text} onChange={e => setDraft({ ...draft, text: e.target.value })} /></label>
            <label>출처<KInput placeholder="작가 <작품> — 비워도 돼요" value={draft.source} onChange={e => setDraft({ ...draft, source: e.target.value })} /></label>
            <label>코멘트 <small>뒷면에만 보여요</small><KTextarea rows={3} value={draft.memo} onChange={e => setDraft({ ...draft, memo: e.target.value })} /></label>
            <label>공개 범위<KSelect options={VIS_OPTIONS} value={draft.visibility} onChange={v => setDraft({ ...draft, visibility: v as Visibility })} /></label>
          </div>
        )}
      </Modal>
      {del.element}
    </section>
  );
}

/** front: 처음(애니메이션 없음) · toBack / toFront: 빛줄기가 위→아래로 훑으며 바뀌는 중·바뀐 뒤 */
type Face = 'front' | 'toBack' | 'toFront';

function QuoteCard({ q, comments, canComment, guestMode, onComment, onRemoveComment, canEdit, canDelete, onEdit, onRemove }: {
  q: Quote;
  comments: ReturnType<typeof commentsFor>;
  canComment: boolean; guestMode: boolean;
  onComment: (row: CommentRow) => void;
  onRemoveComment: (id: string) => void;
  canEdit: boolean; canDelete: boolean;
  onEdit: () => void; onRemove: () => void;
}) {
  const { user, isAdmin } = useAuth();
  const toast = useToast();
  const [face, setFace] = useState<Face>('front');
  const [cmt, setCmt] = useState('');
  const [gName, setGName] = useState('');
  const back = face === 'toBack';

  const add = () => {
    if (!cmt.trim()) return;
    if (guestMode && !gName.trim()) { toast('닉네임을 입력해 주세요'); return; }
    const base = { id: newId(), text: cmt.trim(), date: new Date().toISOString(), target: 'quote' as const, targetId: q.id };
    onComment(user
      ? { ...base, author: user.nickname, authorId: user.id }
      : { ...base, author: gName.trim(), authorId: '' });
    setCmt('');
  };

  return (
    <article className={`qt-card qt-${face}`}>
      <header>
        <b>No. {q.no}</b>
        <button className="qt-ufo" onClick={() => setFace(back ? 'toFront' : 'toBack')}
          aria-label={back ? '앞면 보기' : '뒷면 보기'} aria-pressed={back}>
          <UfoIcon />
          {comments.length > 0 && <sup>{comments.length}</sup>}
        </button>
      </header>
      <div className="qt-body">
        {/* 앞면 — 본문 · 날짜. 카드 높이는 늘 앞면이 정한다 */}
        <div className="qt-face qt-front" inert={back}>
          <p className="qt-text">{q.text}</p>
          <small className="qt-date">{fmtQuoteDate(q.date)}</small>
        </div>
        {/* 뒷면 — 앞면 자리에 겹쳐 놓고, 넘치면 카드 안에서 스크롤 */}
        <div className="qt-face qt-back" inert={!back}>
          {q.source && <p className="qt-src">✦ {q.source}</p>}
          {q.memo && <p className="qt-memo">{q.memo}</p>}
          <div className="qt-meta">
            <small>{fmtQuoteDate(q.date)}</small>
            {(canEdit || canDelete) && (
              <span>
                {canEdit && <button onClick={onEdit}>수정</button>}
                {canDelete && <button onClick={onRemove}>삭제</button>}
              </span>
            )}
          </div>
          <div className="qt-cmts">
            {comments.map(x => (
              <div key={x.id} className="cmt">
                <b>{x.author}</b><small>{fmtDate(x.date)}</small>
                {/* 손님 댓글은 관리자만 지운다 (게시판 v2.0 확정과 동일) */}
                {(isAdmin || (user && x.authorId === user.id)) && (
                  <small className="qt-x" onClick={() => onRemoveComment(x.id)}>삭제</small>
                )}
                <p>{x.text}</p>
              </div>
            ))}
          </div>
          {canComment && (
            <div className="qt-cin">
              {guestMode && <GuestIdBar name={gName} onName={setGName} />}
              <div className="ci-row">
                <KInput placeholder="댓글 남기기..." value={cmt} onChange={e => setCmt(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) add(); }} />
                <button className="btn btn-dark" onClick={add}>입력</button>
              </div>
            </div>
          )}
        </div>
        {/* 훑고 지나가는 빛줄기 — 바뀔 때마다 위에서 아래로 한 번 */}
        {face !== 'front' && <i className="qt-scan" key={face} aria-hidden />}
      </div>
    </article>
  );
}
