'use client';
import { KToggle } from '@/components/ui/Kit';
import { useMemoSettings } from '@/lib/memoStore';

/** 메모장 탭 (4.6) — 작성 권한 + 작성자 표시 */
export function MemoPane() {
  const [settings, patch] = useMemoSettings();
  return (
    <div className="set-sec">
      <h3>스티커 메모장</h3>
      <div className="d">포스트잇 보드 옵션 — 배치·순서는 저장되어 모두에게 동일</div>
      <div className="set-row">
        <div className="l"><b>회원 작성 허용</b><small>끄면 관리자만 메모를 붙일 수 있습니다</small></div>
        <KToggle checked={settings.allowMember} onChange={v => patch({ allowMember: v })} />
      </div>
      <div className="set-row">
        <div className="l"><b>작성자 표시</b><small>포스트잇 상단에 작성자 닉네임 표시</small></div>
        <KToggle checked={settings.showAuthor} onChange={v => patch({ showAuthor: v })} />
      </div>
    </div>
  );
}
