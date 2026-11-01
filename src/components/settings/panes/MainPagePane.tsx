'use client';
import { useState } from 'react';
import { KToggle } from '@/components/ui/Kit';
import { DragList } from '@/components/ui/DragList';
import { useMainStore, WIDGET_META, MULTI_TYPES, widgetLabel } from '@/lib/mainStore';
import { ConfirmModal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';

/** 메인 페이지 탭 (v1.9 확정) — 모바일 표시 토글 + 모바일 세로 나열 순서
    토글은 모바일에서만 뺀다(사용자 확정) — PC 메인 구성은 편집모드의 [＋ 위젯]·우클릭 삭제로 */
export function MainPagePane() {
  const { state, setMobileOff, setMobileOrder, resetMain } = useMainStore();
  const toast = useToast();
  const [resetAsk, setResetAsk] = useState(false);   // 기본 구성 확인 (v1.9)
  // 모바일 순서 목록 — 배너·회원정보창도 일반 위젯이라 함께 (v2.0)
  const orderable = state.mobileOrder
    .map(id => state.widgets.find(w => w.id === id))
    .filter((w): w is NonNullable<typeof w> => !!w);

  return (
    <div className="set-sec">
      {/* 제목 + 설명은 다른 탭과 똑같은 흐름(h3 → .d)으로 두고, 기본 구성 버튼만 우상단에 띄움
          (버튼 높이가 제목줄을 늘려 설명문이 떨어져 보이던 문제 — v1.9 사용자 피드백) */}
      <div style={{ position: 'relative' }}>
        <h3>메인 페이지</h3>
        <button className="btn btn-ghost" style={{ position: 'absolute', right: 0, top: -3, padding: '6px 14px', fontSize: 11 }}
          onClick={() => setResetAsk(true)}>기본 구성</button>
      </div>
      <ConfirmModal open={resetAsk} title="메인 페이지를 기본 구성으로 되돌릴까요?"
        body="추가한 위젯과 배치·크기·모바일 순서가 전부 처음 상태로 돌아갑니다. 되돌린 뒤에는 복구할 수 없습니다."
        onClose={() => setResetAsk(false)}
        buttons={[
          { label: 'RESET', kind: 'accent', onClick: () => { resetMain(); setResetAsk(false); toast('메인 페이지가 기본 구성으로 돌아갔습니다'); } },
          { label: 'CANCEL', kind: 'ghost', onClick: () => setResetAsk(false) },
        ]} />
      <div className="d">모바일 표시 여부 + 모바일 세로 나열 순서 — ⠿ 드래그로 순서 변경</div>

      {/* 메인 레이아웃은 고정 캔버스 하나 — 반응형 옵션 제거 (v1.9, PC/모바일 두 가지만) */}
      <DragList
        items={orderable}
        keyOf={w => w.id}
        onReorder={list => setMobileOrder(list.map(w => w.id))}
        render={(w, i) => (
          <div className="set-row" style={{ width: '100%' }}>
            <div className="l" style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
              <span className="mw-no">{i + 1}</span>
              <span className="drag-h">⠿</span>
              <div>
                {/* 뱃지는 이름 옆에 — b가 블록이라 사이에 두면 설명문 줄로 내려감 (v1.9 사용자 피드백) */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <b>{widgetLabel(state.widgets, w)}</b>
                  {MULTI_TYPES.includes(w.type) && <span className="pill">중복 추가 가능</span>}
                </div>
                <small>{WIDGET_META[w.type].desc}</small>
              </div>
            </div>
            <KToggle checked={!w.mOff} onChange={v => setMobileOff(w.id, !v)} />
          </div>
        )}
      />
      <p className="hint">토글을 끄면 <b>모바일에서만</b> 빠지고 PC 메인에는 그대로 표시됩니다 · 순서는 <b>모바일 세로 나열 순서</b> — PC 배치는 메인에서 편집모드로 자유 조정</p>
      <p className="hint">메인에서 위젯을 완전히 빼거나 더하려면 편집모드에서 — 추가는 상단바 [＋ 위젯], 삭제는 위젯 우클릭 → 위젯 삭제</p>
      <p className="hint">고정 요소: 슬라이드 배너(최상단) · 회원정보창 — 순서 목록에 포함되지 않음</p>
    </div>
  );
}
