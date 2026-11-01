'use client';
import { useState } from 'react';
import { ColorField } from '@/components/ui/ColorField';
import { KInput } from '@/components/ui/Kit';
import { DragList } from '@/components/ui/DragList';
import { useConfirmDelete } from '@/components/ui/Modal';
import { newId } from '@/lib/postStore';
import { useBoardSettings, boardBadgeStyle, BoardBadge, galleryCatsOf, useBoards, BoardSkin, DEFAULT_BOARD_CATS, MAIN_BOARD_ID } from '@/lib/boardStore';
import { SectionsBlock } from '@/components/settings/SectionList';
import { useSections, MAIN_SEC } from '@/lib/sectionStore';

/** 게시판 관리 탭 (5.2) — 게시판 생성·삭제·스킨·권한 + 게시판별 말머리 + 뱃지 색 */
export function BoardPane() {
  const {
    st, patchSystem, patchGallery,
    patchGalleryCat, addGalleryCat, removeGalleryCat, setGalleryCats,
  } = useBoardSettings();
  const { boards, setBoards, patchBoard } = useBoards();
  const [catBoard, setCatBoard] = useState(MAIN_BOARD_ID);   // 말머리 편집 대상 게시판
  /* 갤러리 말머리도 갤러리마다 따로 (v2.0 사용자 요청) — 어느 갤러리 것을 고칠지 고른다.
     하나뿐이면 고를 것이 없으니 선택 줄을 아예 두지 않는다 (감상타래와 같은 방식) */
  const { list: secList } = useSections();
  const galSecs = secList('gallery');
  const [galSecSel, setGalSec] = useState(MAIN_SEC);
  const galSec = galSecs.some(s2 => s2.id === galSecSel) ? galSecSel : MAIN_SEC;
  const galCats = galleryCatsOf(st, galSec);
  const del = useConfirmDelete();

  const sel = boards.find(b => b.id === catBoard) ?? boards[0];
  const setCats = (cats: BoardBadge[]) => patchBoard(sel.id, { cats });
  const patchCat = (id: string, p: Partial<BoardBadge>) =>
    patchBoard(sel.id, { cats: sel.cats.map(c => (c.id === id ? { ...c, ...p } : c)) });

  const colorCells = (b: BoardBadge, patch: (p: Partial<BoardBadge>) => void) => (
    <>
      <span className="cp-lb">배경</span>
      <ColorField value={b.bg} onChange={hex => patch({ bg: hex })} />
      <span className="cp-lb">테두리</span>
      <ColorField value={b.border} onChange={hex => patch({ border: hex })} />
      <span className="cp-lb">글씨</span>
      <ColorField value={b.fg} onChange={hex => patch({ fg: hex })} />
    </>
  );

  return (
    <div className="set-sec">
      <h3>게시판 관리</h3>
      <div className="d">게시판 생성·삭제와 게시판별 스킨·권한·말머리 — 변경 즉시 메뉴·목록·글쓰기에 반영</div>

      <h3 style={{ marginTop: 20 }}>게시판 목록</h3>
      <div className="d">⠿ 드래그로 메뉴 순서 · 이름은 상단 메뉴와 페이지 타이틀에 그대로 표시 · 리스트 스킨(기본형/티켓형) 게시판마다 지정 — 글쓰기·댓글 권한은 메뉴 관리에서</div>
      <DragList items={boards} keyOf={b => b.id} onReorder={setBoards}
        render={b => (
          <div className="set-row" style={{ width: '100%' }}>
            <div className="l" style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
              <span className="drag-h">⠿</span>
              <KInput value={b.name} onChange={e => patchBoard(b.id, { name: e.target.value })}
                style={{ width: 110 }} />
              {b.id === MAIN_BOARD_ID && <span className="pill">기본</span>}
            </div>
            <div className="cp-group" style={{ justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <div className="mini-seg">
                {(['list', 'ticket'] as BoardSkin[]).map(s => (
                  <button key={s} className={b.skin === s ? 'on' : ''}
                    onClick={() => patchBoard(b.id, { skin: s })}>{s === 'list' ? '기본형' : '티켓형'}</button>
                ))}
              </div>
              {/* 목록 글씨색 (v1.9) — 미지정이면 테마 기본색 */}
              <span className="cp-lb">글씨</span>
              <ColorField value={b.fg ?? '#2c3037'} onChange={hex => patchBoard(b.id, { fg: hex })} />
              {b.fg && (
                <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                  onClick={() => patchBoard(b.id, { fg: undefined })}>기본색</button>
              )}
              {b.id !== MAIN_BOARD_ID && (
                <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                  onClick={() => del.ask(`게시판 「${b.name}」를 삭제하시겠습니까?`, () => {
                    setBoards(boards.filter(x => x.id !== b.id));
                    if (catBoard === b.id) setCatBoard(MAIN_BOARD_ID);
                  }, '메뉴에서 사라지지만 이 게시판에 쓴 글 데이터는 보존됩니다 (3장 원칙).')}>DELETE</button>
              )}
            </div>
          </div>
        )} />
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}
          onClick={() => setBoards([...boards, {
            id: newId(), name: '새 게시판', desc: '게시판 설명을 입력하세요',
            skin: 'list', permWrite: 'member', permComment: 'member', cats: DEFAULT_BOARD_CATS,
          }])}>＋ ADD BOARD</button>
      </div>

      <hr style={{ margin: '24px 0', border: 'none', borderTop: '1.5px solid var(--line)' }} />

      <h3>말머리</h3>
      <div className="d">게시판을 고른 뒤 ⠿ 드래그로 순서 · 이름 수정 · 추가/삭제 — 이름을 바꿔도 기존 글은 이전 이름으로 남습니다</div>
      {boards.length > 1 && (
        <div className="mini-seg" style={{ marginBottom: 12 }}>
          {boards.map(b => (
            <button key={b.id} className={sel.id === b.id ? 'on' : ''} onClick={() => setCatBoard(b.id)}>{b.name}</button>
          ))}
        </div>
      )}
      <DragList items={sel.cats} keyOf={c => c.id} onReorder={setCats}
        render={c => (
          <div className="set-row" style={{ width: '100%' }}>
            <div className="l" style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
              <span className="drag-h">⠿</span>
              <span style={boardBadgeStyle(c)}>{c.label || '말머리'}</span>
            </div>
            <div className="cp-group" style={{ justifyContent: 'flex-end' }}>
              <KInput value={c.label} onChange={e => patchCat(c.id, { label: e.target.value })}
                style={{ width: 90, textAlign: 'right' }} />
              {colorCells(c, p => patchCat(c.id, p))}
              <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                onClick={() => del.ask(`말머리 「${c.label}」를 삭제하시겠습니까?`, () =>
                  patchBoard(sel.id, { cats: sel.cats.filter(x => x.id !== c.id) }),
                  '이 말머리로 쓴 기존 글은 유지되며 중립색 뱃지로 표시됩니다.')}>DELETE</button>
            </div>
          </div>
        )} />
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}
          onClick={() => setCats([...sel.cats, { id: newId(), label: '새 말머리', bg: '#eef0f2', border: '#d7dae0', fg: '#5d636d' }])}>＋ ADD</button>
      </div>

      <hr style={{ margin: '24px 0', border: 'none', borderTop: '1.5px solid var(--line)' }} />

      <h3>시스템 뱃지</h3>
      <div className="d">공지 · 비밀 · 접힘 — 색만 수정 (삭제 불가)</div>
      {st.system.map(b => (
        <div key={b.id} className="set-row">
          <div className="l"><span style={boardBadgeStyle(b)}>{b.label}</span></div>
          <div className="cp-group" style={{ justifyContent: 'flex-end' }}>
            {colorCells(b, p => patchSystem(b.id, p))}
          </div>
        </div>
      ))}

      <hr style={{ margin: '24px 0', border: 'none', borderTop: '1.5px solid var(--line)' }} />

      <h3>갤러리 유형 뱃지</h3>
      <div className="d">그림백업의 로그/단일 표시 — 라벨·색 수정 (삭제 불가)</div>
      {st.gallery.map(b => (
        <div key={b.id} className="set-row">
          <div className="l"><span style={boardBadgeStyle(b)}>{b.label || '유형'}</span></div>
          <div className="cp-group" style={{ justifyContent: 'flex-end' }}>
            <KInput value={b.label} onChange={e => patchGallery(b.id, { label: e.target.value })}
              style={{ width: 90, textAlign: 'right' }} />
            {colorCells(b, p => patchGallery(b.id, p))}
          </div>
        </div>
      ))}

      {/* 갤러리 말머리 (v2.0 사용자 요청) — 예전에는 코드에 박혀 있어 바꿀 수 없었다.
          여러 개로 만든 갤러리마다 따로 정한다 (v2.0 사용자 요청) */}
      <h3 style={{ marginTop: 20 }}>갤러리 말머리</h3>
      <div className="d">
        그림백업 글쓰기에서 고르는 말머리 — ⠿ 드래그로 순서 · 추가·수정·삭제 자유
        {galSecs.length > 1 && <><br />갤러리마다 따로 정합니다 — <b>손대기 전까지는 기본 갤러리의 말머리를 그대로 씁니다</b></>}
      </div>
      {galSecs.length > 1 && (
        <div className="mini-seg" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
          {galSecs.map(s2 => (
            <button key={s2.id} className={galSec === s2.id ? 'on' : ''} onClick={() => setGalSec(s2.id)}>{s2.name}</button>
          ))}
        </div>
      )}
      <DragList items={galCats} keyOf={c => c.id} onReorder={next => setGalleryCats(galSec, next)}
        render={c => (
          <div className="set-row" style={{ width: '100%' }}>
            <div className="l" style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
              <span className="drag-h">⠿</span>
              <span style={boardBadgeStyle(c)}>{c.label || '말머리'}</span>
            </div>
            <div className="cp-group" style={{ justifyContent: 'flex-end' }}>
              <KInput value={c.label} onChange={e => patchGalleryCat(galSec, c.id, { label: e.target.value })}
                style={{ width: 100, textAlign: 'right' }} />
              {colorCells(c, p => patchGalleryCat(galSec, c.id, p))}
              <span className="fx" data-tip="말머리 삭제"
                onClick={() => del.ask(`말머리 「${c.label}」를 삭제하시겠습니까?`,
                  () => removeGalleryCat(galSec, c.id),
                  '이미 이 말머리로 등록된 글은 그대로 남습니다.')}>✕</span>
            </div>
          </div>
        )} />
      <button className="btn btn-ghost" style={{ marginTop: 8, padding: '7px 14px', fontSize: 11 }}
        onClick={() => addGalleryCat(galSec)}>＋ 말머리 추가</button>

      <hr style={{ margin: '24px 0', border: 'none', borderTop: '1.5px solid var(--line)' }} />
      {/* 갤러리·다이어리 등도 여러 개로 (v2.0 사용자 요청) — 목록이 몇 개인지는 여기 한곳에서 */}
      <SectionsBlock />

      {del.element}
    </div>
  );
}
