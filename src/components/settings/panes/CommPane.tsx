'use client';
import { ColorField } from '@/components/ui/ColorField';
import { KStep, KInput, KSelect } from '@/components/ui/Kit';
import { useConfirmDelete } from '@/components/ui/Modal';
import { newId } from '@/lib/postStore';
import { useCommSettings, badgeStyle, CommBadge, CommSettings } from '@/lib/commStore';

/** 커미션 탭 (4.18) — 뱃지 모양·커미션/신청자 뱃지 스타일·전체 슬롯·신청자 리스트 공개범위·썸네일 비율 */
function CommBadgeRows({ list, shape, onChange, fixedIds }: {
  list: CommBadge[]; shape: 'round' | 'pill';
  onChange: (next: CommBadge[]) => void;
  fixedIds: string[];                      // 기본 제공 뱃지 — 삭제 불가
}) {
  const del = useConfirmDelete();
  const patch = (id: string, p: Partial<CommBadge>) =>
    onChange(list.map(b => (b.id === id ? { ...b, ...p } : b)));
  return (
    <>
      {list.map(b => (
        <div key={b.id} className="set-row" style={{ alignItems: 'center' }}>
          {/* 왼쪽: 뱃지 미리보기 하나만 (4.18 — 라벨 중복 표기 없음) */}
          <div className="l"><span style={badgeStyle(b, shape)}>{b.label || '뱃지'}</span></div>
          {/* 오른쪽 묶음: 글씨 인풋(맨 앞·오른쪽 정렬) + 배경/테두리/글씨색 */}
          <div className="cp-group" style={{ justifyContent: 'flex-end' }}>
            <KInput value={b.label} onChange={e => patch(b.id, { label: e.target.value })}
              style={{ width: 90, textAlign: 'right' }} />
            <span className="cp-lb">배경</span>
            <ColorField value={b.bg} onChange={hex => patch(b.id, { bg: hex })} />
            <span className="cp-lb">테두리</span>
            <ColorField value={b.border} onChange={hex => patch(b.id, { border: hex })} />
            <span className="cp-lb">글씨</span>
            <ColorField value={b.fg} onChange={hex => patch(b.id, { fg: hex })} />
            {!fixedIds.includes(b.id) && (
              <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                onClick={() => del.ask(`뱃지 「${b.label}」를 삭제하시겠습니까?`, () => onChange(list.filter(x => x.id !== b.id)), '이 뱃지를 쓰던 항목은 뱃지 없음으로 표시됩니다.')}>DELETE</button>
            )}
          </div>
        </div>
      ))}
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}
          onClick={() => onChange([...list, { id: newId(), label: '새 뱃지', bg: '#5d636d', border: '#4a505a', fg: '#ffffff' }])}>
          ＋ ADD BADGE
        </button>
      </div>
      {del.element}
    </>
  );
}

export function CommPane() {
  const [st, patch] = useCommSettings();
  return (
    <div className="set-sec">
      <h3>커미션</h3>
      <div className="d">커미션 리스트·상세·신청자 리스트의 뱃지와 슬롯 설정 — 변경 즉시 반영</div>

      <div className="set-row">
        <div className="l"><b>썸네일 비율</b><small>커미션 갤러리 전체에 일괄 적용</small></div>
        <div className="mini-seg">
          <button className={st.ratio === '3:4' ? 'on' : ''} onClick={() => patch({ ratio: '3:4' })}>3:4 세로</button>
          <button className={st.ratio === '4:3' ? 'on' : ''} onClick={() => patch({ ratio: '4:3' })}>4:3 가로</button>
        </div>
      </div>

      <div className="set-row">
        <div className="l"><b>뱃지 모양</b><small>커미션·신청자 뱃지 공통</small></div>
        <div className="mini-seg">
          <button className={st.badgeShape === 'round' ? 'on' : ''} onClick={() => patch({ badgeShape: 'round' })}>라운드 스퀘어</button>
          <button className={st.badgeShape === 'pill' ? 'on' : ''} onClick={() => patch({ badgeShape: 'pill' })}>동그란 필</button>
        </div>
      </div>

      <div className="set-row">
        <div className="l"><b>전체 슬롯</b><small>동시에 받을 수 있는 총 슬롯 — 리스트 상단에 남은/전체로 표시 (수동 갱신)</small></div>
        <div style={{ display: 'flex', gap: 14, alignItems: 'center' }}>
          <span style={{ fontSize: 11.5, color: 'var(--sub)' }}>총</span>
          <KStep value={st.totalSlot} min={1} max={50} onChange={v => patch({ totalSlot: v, totalUsed: Math.min(st.totalUsed, v) })} />
          <span style={{ fontSize: 11.5, color: 'var(--sub)' }}>사용</span>
          <KStep value={st.totalUsed} min={0} max={st.totalSlot} onChange={v => patch({ totalUsed: v })} />
        </div>
      </div>

      <div className="set-row">
        <div className="l"><b>슬롯 표시 기준</b><small>리스트·상세에 3/5로 적을 때 앞 숫자를 무엇으로 볼지 — 운영 방식에 따라 다릅니다</small></div>
        <div className="mini-seg">
          <button className={(st.slotDisplay ?? 'used') === 'used' ? 'on' : ''} onClick={() => patch({ slotDisplay: 'used' })}>채워진 슬롯</button>
          <button className={st.slotDisplay === 'remain' ? 'on' : ''} onClick={() => patch({ slotDisplay: 'remain' })}>남은 슬롯</button>
        </div>
      </div>

      <div className="set-row">
        <div className="l"><b>신청자 리스트 공개범위</b><small>리스트 자체의 공개 — 각 신청 내용은 별개(관리자/허용된 본인만)</small></div>
        <KSelect minWidth={130} value={st.applyVisibility} onChange={v => patch({ applyVisibility: v as CommSettings['applyVisibility'] })}
          options={[
            { value: 'public', label: '전체공개' },
            { value: 'member', label: '멤버공개' },
            { value: 'private', label: '비공개' },
          ]} />
      </div>

      <div className="set-row">
        <div className="l"><b>신청 휴지통 보관 기간</b><small>휴지통으로 옮긴 신청을 며칠 두었다가 없앨지 — 기간이 지나면 목록을 열 때 자동으로 사라집니다</small></div>
        <KStep value={st.trashDays ?? 30} min={1} max={365} suffix="일" onChange={v => patch({ trashDays: v })} />
      </div>

      <h3 style={{ marginTop: 26 }}>커미션 뱃지</h3>
      <div className="d">기본 3종(모집중·마감·준비중)은 고정 제공 — 글씨·색은 자유 수정</div>
      <CommBadgeRows list={st.commBadges} shape={st.badgeShape} fixedIds={['open', 'closed', 'ready']}
        onChange={next => patch({ commBadges: next })} />

      <hr style={{ margin: '24px 0', border: 'none', borderTop: '1.5px solid var(--line)' }} />

      <h3>신청자 리스트 뱃지</h3>
      <div className="d">대기·작업중·완료 — 커미션 뱃지와 색 변수 별도</div>
      <CommBadgeRows list={st.applyBadges} shape={st.badgeShape} fixedIds={['wait', 'working', 'done']}
        onChange={next => patch({ applyBadges: next })} />
    </div>
  );
}
