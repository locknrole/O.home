'use client';
// 환경설정 탭 여러 곳이 같이 쓰는 조각 (v2.1 — settings/page.tsx에서 분리)
import { useTheme } from '@/lib/ThemeProvider';
import { ThemeVars } from '@/lib/theme';
import { ColorField } from '@/components/ui/ColorField';

/** 색 항목 한 쌍 렌더 헬퍼 */
export function CP({ label, k, def }: { label?: string; k: keyof ThemeVars; def?: string }) {
  const { state, setVar } = useTheme();
  // def: 값이 없을 때 실제로 적용되는 기본색 (예: 입력 포커스 = 포인트색)
  return (
    <>
      {label && <span className="cp-lb">{label}</span>}
      <ColorField value={String(state.vars[k] ?? def ?? '#888888')} onChange={hex => setVar(k, hex as never)} />
    </>
  );
}
