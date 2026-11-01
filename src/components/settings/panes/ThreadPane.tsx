'use client';
import { useState } from 'react';
import { ColorField } from '@/components/ui/ColorField';
import { KInput } from '@/components/ui/Kit';
import { DragList } from '@/components/ui/DragList';
import { useConfirmDelete } from '@/components/ui/Modal';
import { newId } from '@/lib/postStore';
import { useThreadSettings, ThreadWork, THREAD_SEED, ThreadCat, threadBadgeStyle, threadCats, threadCatsPatch } from '@/lib/threadStore';
import { useSections, MAIN_SEC, inSection } from '@/lib/sectionStore';
import { useLocalList } from '@/lib/postStore';

/** 감상타래 탭 (4.17) — 분류 리스트 관리 + 기본 보기 */
export function ThreadPane() {
  const [settings, patch] = useThreadSettings();
  const [works] = useLocalList<ThreadWork>('ohome.threads.v1', THREAD_SEED);
  const del = useConfirmDelete();
  /* 분류는 감상타래마다 따로 (v2.0 사용자 요청) — 여러 개로 만들었으면 어느 것의 분류를
     고칠지 먼저 고른다. 하나뿐이면 고를 것이 없으니 선택 줄을 아예 두지 않는다. */
  const { list } = useSections();
  const secs = list('threads');
  const [secId, setSecId] = useState(MAIN_SEC);
  const cur = secs.find(s => s.id === secId) ? secId : MAIN_SEC;
  const cats = threadCats(settings, cur);
  const setCats = (next: ThreadCat[]) => patch(threadCatsPatch(settings, cur, next));
  const patchCat = (id: string, p: Partial<ThreadCat>) =>
    setCats(cats.map(c => (c.id === id ? { ...c, ...p } : c)));
  return (
    <div className="set-sec">
      <h3>기본 보기</h3>
      <div className="d">감상타래 메뉴에 들어왔을 때 먼저 보일 보기</div>
      <div className="set-row">
        <div className="l"><b>첫 화면</b><small>타래 보기 / 리스트 보기(포스터 카드 그리드)</small></div>
        <div className="mini-seg">
          <button className={settings.defaultView === 'thread' ? 'on' : ''}
            onClick={() => patch({ defaultView: 'thread' })}>타래 보기</button>
          <button className={settings.defaultView === 'list' ? 'on' : ''}
            onClick={() => patch({ defaultView: 'list' })}>리스트 보기</button>
        </div>
      </div>

      <h3 style={{ marginTop: 26 }}>분류 리스트</h3>
      <div className="d">
        작품 분류 뱃지 — 이름 · 배경/테두리/글씨색 · ⠿ 드래그로 순서 · 추가/삭제
        {secs.length > 1 && <><br />감상타래마다 따로 정합니다 — <b>손대기 전까지는 기본 감상타래의 분류를 그대로 씁니다</b></>}
      </div>
      {secs.length > 1 && (
        <div className="mini-seg" style={{ flexWrap: 'wrap', marginBottom: 10 }}>
          {secs.map(s => (
            <button key={s.id} className={cur === s.id ? 'on' : ''} onClick={() => setSecId(s.id)}>{s.name}</button>
          ))}
        </div>
      )}
      <DragList items={cats} keyOf={c => c.id} onReorder={next => setCats(next)}
        render={c => (
          <div className="set-row" style={{ width: '100%' }}>
            <div className="l" style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
              <span className="drag-h">⠿</span>
              <span className="pill" style={threadBadgeStyle(c)}>{c.label || '분류'}</span>
            </div>
            <div className="cp-group" style={{ justifyContent: 'flex-end' }}>
              <KInput value={c.label} onChange={e => patchCat(c.id, { label: e.target.value })}
                style={{ width: 100, textAlign: 'right' }} />
              <span className="cp-lb">배경</span>
              <ColorField value={c.bg ?? '#1d2025'} onChange={hex => patchCat(c.id, { bg: hex })} />
              <span className="cp-lb">테두리</span>
              <ColorField value={c.border ?? c.bg ?? '#1d2025'} onChange={hex => patchCat(c.id, { border: hex })} />
              <span className="cp-lb">글씨</span>
              <ColorField value={c.fg ?? '#ffffff'} onChange={hex => patchCat(c.id, { fg: hex })} />
              <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                onClick={() => {
                  const used = works.filter(w => w.catId === c.id && inSection(w.secId, cur)).length;
                  del.ask(`분류 「${c.label}」를 삭제하시겠습니까?`,
                    () => setCats(cats.filter(x => x.id !== c.id)),
                    used > 0 ? `이 분류의 타래 ${used}개는 유지되지만 분류가 「기타」로 표시됩니다.` : undefined);
                }}>DELETE</button>
            </div>
          </div>
        )} />
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}
          onClick={() => setCats([...cats, { id: newId(), label: '새 분류' }])}>
          ＋ ADD
        </button>
      </div>
      {del.element}
    </div>
  );
}
