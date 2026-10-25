'use client';
// 썰 대화 보기 — 카톡처럼 말풍선으로. 업로드 미리보기와 상세 페이지가 같이 쓴다.
// 편집 모드에서는 메시지마다 [수정]·[삭제]가 붙는다 (상세 페이지).
import React, { useState } from 'react';
import { BlobImg } from '@/lib/blobStore';
import { KTextarea } from '@/components/ui/Kit';
import type { SsulMsg } from '@/lib/ssulStore';

const WEEK = ['일', '월', '화', '수', '목', '금', '토'];
function dayLabel(at: string) {
  const [y, m, d] = at.slice(0, 10).split('-').map(Number);
  return `${y}년 ${m}월 ${d}일 ${WEEK[new Date(y, m - 1, d).getDay()]}요일`;
}
function timeLabel(at: string) {
  const [h, mi] = at.slice(11, 16).split(':').map(Number);
  return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(mi).padStart(2, '0')}`;
}

function Body({ m }: { m: SsulMsg }) {
  switch (m.kind) {
    case 'photo':
      return m.media?.srcs?.length
        ? <div className="sc-photos">{m.media.srcs.map(s => <BlobImg key={s} fileRef={s} thumb />)}</div>
        : <span className="sc-media">사진{m.media?.count && m.media.count > 1 ? ` ${m.media.count}장` : ''}</span>;
    case 'video': return <span className="sc-media">동영상</span>;
    case 'emoticon': return <span className="sc-media">이모티콘</span>;
    case 'voice': return <span className="sc-media">음성메시지</span>;
    case 'file': return <span className="sc-media">파일 · {m.media?.file}</span>;
    case 'deleted': return <span className="sc-deleted">삭제된 메시지입니다.</span>;
    default:
      return <>{m.sticker && <span className="sc-media" style={{ display: 'table', marginBottom: 5 }}>이모티콘</span>}<span className="sc-text">{m.text}</span></>;
  }
}

export function ChatView({ msgs, me, editing, onEdit, onDelete }: {
  msgs: SsulMsg[];
  me?: string;
  editing?: boolean;
  onEdit?: (idx: number, text: string) => void;
  onDelete?: (idx: number) => void;
}) {
  const [editIdx, setEditIdx] = useState<number | null>(null);
  const [draft, setDraft] = useState('');

  return (
    <div className="ssul-chat">
      {msgs.map((m, k) => {
        const prev = msgs[k - 1];
        const newDay = !prev || prev.at.slice(0, 10) !== m.at.slice(0, 10);
        // 날짜가 바뀌지 않았는데 3시간 넘게 쉬었으면 얇은 구분선 — 다일 썰을 이어 붙인 자리도 여기서 보인다
        const gap = !newDay && prev && (Date.parse(m.at) - Date.parse(prev.at)) / 60000 >= 180;
        const divider = newDay
          ? <div className="sc-day"><span>{dayLabel(m.at)}</span></div>
          : gap ? <div className="sc-gap" /> : null;
        if (m.kind === 'system') {
          return <React.Fragment key={k}>{divider}<div className="sc-sys">{m.text}</div></React.Fragment>;
        }
        const mine = !!me && m.sender === me;
        const showName = !mine && (newDay || !!gap || !prev || prev.sender !== m.sender || prev.kind === 'system');
        const next = msgs[k + 1];
        // 같은 사람이 같은 분에 연달아 보내면 시각은 마지막 말풍선에만 (카톡과 같게)
        const showTime = !next || next.sender !== m.sender || next.at !== m.at || next.at.slice(0, 10) !== m.at.slice(0, 10);
        return (
          <React.Fragment key={k}>
            {divider}
            <div className={`sc-row ${mine ? 'me' : ''}`}>
              <div className="sc-col">
                {showName && <div className="sc-name">{m.sender}</div>}
                <div className="sc-line">
                  {editIdx === k ? (
                    <div className="sc-edit">
                      <KTextarea value={draft} onChange={e => setDraft(e.target.value)} rows={Math.min(10, draft.split('\n').length + 1)} autoFocus />
                      <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-xs" onClick={() => setEditIdx(null)}>취소</button>
                        <button className="btn btn-dark btn-xs" onClick={() => { onEdit?.(k, draft); setEditIdx(null); }}>확인</button>
                      </div>
                    </div>
                  ) : (
                    <div className={`sc-bubble ${m.kind !== 'text' ? 'plain' : ''}`}><Body m={m} /></div>
                  )}
                  <div className="sc-meta">
                    {editing && editIdx !== k && (
                      <span className="sc-tools">
                        {m.kind === 'text' && <button title="수정" onClick={() => { setEditIdx(k); setDraft(m.text); }}>수정</button>}
                        <button title="삭제" onClick={() => onDelete?.(k)}>삭제</button>
                      </span>
                    )}
                    {m.edited && <small>수정됨</small>}
                    {showTime && <small>{timeLabel(m.at)}</small>}
                  </div>
                </div>
              </div>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
}
