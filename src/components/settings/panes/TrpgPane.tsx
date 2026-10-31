'use client';
import { useEffect, useState } from 'react';
import { ColorField } from '@/components/ui/ColorField';
import { KInput, KCheck } from '@/components/ui/Kit';
import { useTrpgSettings, DOTORI_STATUS_KEYS, DotoriStatus, dotoriBadgeStyle } from '@/lib/galleryStore';
import { useMenuSettings, MenuSettings, PLAYLOG_COLS } from '@/lib/menuStore';
import { getPageText, setPageText } from '@/components/ui/PageText';

/** TRPG 탭 (4.15, v1.9) — 도토리 상태 카테고리 라벨 + 뱃지 색 + 플레이기록 표시 열 */
export function TrpgPane() {
  const [settings, patch] = useTrpgSettings();
  const [ms, patchMenu] = useMenuSettings();   // 플레이기록 표시 열 (4.16 — 저장 위치는 메뉴 설정)
  // 비밀번호 걸린 로그의 안내 문구 (pagetext 'trpg-lock-desc')
  const [lockDesc, setLockDesc] = useState('');
  useEffect(() => { setLockDesc(getPageText('trpg-lock-desc', '비밀번호를 입력하면 열람할 수 있습니다')); }, []);
  const patchStatus = (k: DotoriStatus, p: Partial<(typeof settings.statuses)[DotoriStatus]>) =>
    patch({ statuses: { ...settings.statuses, [k]: { ...settings.statuses[k], ...p } } });
  // 균등 칸 그리드 — 항목 폭이 라벨 길이에 안 흔들려 PC/모바일 두 줄이 세로로 정렬됨 (v1.9)
  const colToggle = (list: string[], k: keyof MenuSettings) => (
    <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${PLAYLOG_COLS.length}, 1fr)`, gap: 6, justifyItems: 'center' }}>
      {PLAYLOG_COLS.map(c => (
        <KCheck key={c.key} label={c.label} checked={list.includes(c.key)}
          onChange={v => patchMenu({ [k]: v ? [...list, c.key] : list.filter(x => x !== c.key) } as Partial<MenuSettings>)} />
      ))}
    </div>
  );
  return (
    <div className="set-sec">
      {/* 비밀번호 걸린 로그의 안내 문구 — 관리자는 그 화면을 볼 수 없어 여기서 편집 (사용자 요청) */}
      <h3>로그 열람 안내 문구</h3>
      <div className="d">비밀번호를 건 로그에 들어갔을 때 보이는 문구입니다 — 관리자에게는 그 화면이 뜨지 않아 여기서 고칩니다</div>
      <div className="set-row" style={{ alignItems: 'center' }}>
        <div className="l"><b>비밀번호 안내</b><small>비우면 기본 문구로 표시됩니다</small></div>
        <KInput value={lockDesc}
          onChange={e => { setLockDesc(e.target.value); setPageText('trpg-lock-desc', e.target.value); }}
          placeholder="비밀번호를 입력하면 열람할 수 있습니다" style={{ width: 300 }} />
      </div>

      <h3>도토리 상태 카테고리</h3>
      <div className="d">라벨과 뱃지 색(배경/테두리/글씨) — 카드 뱃지는 공수표·일정 확정만 표시</div>
      {DOTORI_STATUS_KEYS.map(k => {
        const st = settings.statuses[k];
        return (
          <div key={k} className="set-row" style={{ alignItems: 'center' }}>
            <div className="l">
              <span className="dt-badge" style={{ ...dotoriBadgeStyle(st), position: 'static' }}>{st.label || '상태'}</span>
            </div>
            <div className="cp-group" style={{ justifyContent: 'flex-end' }}>
              <KInput value={st.label} onChange={e => patchStatus(k, { label: e.target.value })}
                style={{ width: 100, textAlign: 'right' }} />
              <span className="cp-lb">배경</span>
              <ColorField value={st.bg} onChange={hex => patchStatus(k, { bg: hex })} />
              <span className="cp-lb">테두리</span>
              <ColorField value={st.border} onChange={hex => patchStatus(k, { border: hex })} />
              <span className="cp-lb">글씨</span>
              <ColorField value={st.fg} onChange={hex => patchStatus(k, { fg: hex })} />
            </div>
          </div>
        );
      })}

      {/* 플레이기록 표시 열 — PC/모바일 각각 (4.16 v1.8 · v1.9에서 TRPG 탭 하단 배치) */}
      <hr style={{ margin: '24px 0', border: 'none', borderTop: '1.5px solid var(--line)' }} />
      <h3>플레이기록 표시 열</h3>
      <div className="d">PC와 모바일에서 보여줄 열을 각각 선택 (기본: PC 전체 7열 · 모바일 Date/Scenario/Role/Playtime)</div>
      {/* 라벨 폭 고정 — PC/모바일 폭 차이로 두 줄 체크박스 시작점이 어긋나던 것 정렬 (v1.9) */}
      <div className="set-row" style={{ flexWrap: 'wrap' }}>
        <div className="l" style={{ width: 64, flexShrink: 0 }}><b>PC</b></div>
        {colToggle(ms.playlogPc, 'playlogPc')}
      </div>
      <div className="set-row" style={{ flexWrap: 'wrap' }}>
        <div className="l" style={{ width: 64, flexShrink: 0 }}><b>모바일</b></div>
        {colToggle(ms.playlogMobile, 'playlogMobile')}
      </div>
    </div>
  );
}
