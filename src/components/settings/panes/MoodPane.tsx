'use client';
import { ColorField } from '@/components/ui/ColorField';
import { KInput } from '@/components/ui/Kit';
import { DragList } from '@/components/ui/DragList';
import { useConfirmDelete } from '@/components/ui/Modal';
import { DiaryPost, DIARY_SEED } from '@/lib/diaryStore';
import { newId } from '@/lib/postStore';
import { SymbolInput } from '@/components/ui/SymbolInput';
import { useLocalList } from '@/lib/postStore';
import { Mood, MOOD_SEED, moodTint } from '@/lib/diaryStore';

/** 무드 리스트 탭 (5.2 — 다이어리 무드: 이름/아이콘/색 추가·수정·삭제·순서) */
export function MoodPane() {
  const [moods, setMoods] = useLocalList<Mood>('ohome.moods.v1', MOOD_SEED);
  const [diaries] = useLocalList<DiaryPost>('ohome.diary.v1', DIARY_SEED);
  const del = useConfirmDelete();
  const patchMood = (id: string, p: Partial<Mood>) =>
    setMoods(moods.map(m => (m.id === id ? { ...m, ...p } : m)));
  return (
    <div className="set-sec">
      <h3>무드 리스트</h3>
      <div className="d">다이어리에서 고를 무드 — 이름 · 아이콘(이모지/특수문자) · 색 · ⠿ 드래그로 순서</div>

      <DragList items={moods} keyOf={m => m.id} onReorder={setMoods}
        render={m => (
          <div className="set-row" style={{ width: '100%' }}>
            <div className="l" style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
              <span className="drag-h">⠿</span>
              <span style={{
                width: 30, height: 30, borderRadius: '50%',
                // 줄높이 1 — 상자가 아니라 글자를 가운데로 (v2.0 사용자 발견)
                display: 'flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1,
                background: moodTint(m.color), color: m.color, fontSize: 14,
              }}>{m.icon}</span>
            </div>
            <div className="cp-group" style={{ justifyContent: 'flex-end' }}>
              {/* 아이콘 — 클릭하면 특수문자 프리셋, 직접 입력도 가능 (v1.9) */}
              <SymbolInput value={m.icon} onChange={v => patchMood(m.id, { icon: v })}
                style={{ width: 46, textAlign: 'center' }} />
              <KInput value={m.name} onChange={e => patchMood(m.id, { name: e.target.value })}
                style={{ width: 110 }} />
              <ColorField value={m.color} onChange={hex => patchMood(m.id, { color: hex })} />
              <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                onClick={() => {
                const used = diaries.filter(d => d.moodId === m.id).length;
                del.ask(`무드 「${m.name}」를 삭제하시겠습니까?`, () => setMoods(moods.filter(x => x.id !== m.id)),
                  used > 0 ? `이 무드로 쓴 일기 ${used}개는 유지되지만 아이콘이 기본 표시로 바뀝니다.` : undefined);
              }}>DELETE</button>
            </div>
          </div>
        )} />
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}
          onClick={() => setMoods([...moods, { id: newId(), name: '새 무드', icon: '✦', color: '#8a8f98' }])}>
          ＋ ADD MOOD
        </button>
      </div>
      {del.element}
    </div>
  );
}
