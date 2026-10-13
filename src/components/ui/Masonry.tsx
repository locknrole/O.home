'use client';
// 핀터레스트형 메이슨리 (갤러리 v2.0 사용자 요청) — 이미지 원래 비율 그대로, 가장 짧은 열에 차곡차곡.
// 배치는 「열 폭 × 이미지 비율 + 정보줄 높이」만으로 계산한다(DOM 측정 없음) — 같은 입력이면 같은 자리.
// 앞 항목들의 비율이 전부 확인된 항목까지만 보여 준다: 뒤늦게 로드된 앞 이미지 때문에
// 이미 보이는 카드가 다른 열로 튀는 일이 없다(아직 안 보이는 항목만 자리가 정해지기를 기다린다).
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export function Masonry<T extends { id: string }>({
  items, renderItem, itemProps, infoH, minCol = 200, maxCols = 5, gap = 14, onReadyChange,
}: {
  items: T[];
  /** report(세로/가로 비) — 이미지가 로드되면(또는 자리표시면 즉시) 한 번 알려 준다 */
  renderItem: (item: T, i: number, report: (ratio: number) => void) => React.ReactNode;
  /** 카드 래퍼에 얹을 속성 — 클릭·우클릭·편집모드 드래그 정렬 등 */
  itemProps?: (item: T, i: number) => Record<string, unknown>;
  /** 이미지 아래 정보줄 높이 px (카드 높이 = 열 폭 × 비율 + infoH) */
  infoH: number;
  minCol?: number;
  maxCols?: number;
  gap?: number;
  /** 지금 받은 항목이 전부 자리를 잡았는지 — 무한 스크롤이 다음 묶음을 부를 때 본다 */
  onReadyChange?: (allReady: boolean) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(0);
  const [ratios, setRatios] = useState<Record<string, number>>({});

  useLayoutEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setW(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const report = useCallback((id: string, r: number) => {
    if (!(r > 0) || !isFinite(r)) r = 0.75;
    setRatios(m => (m[id] === r ? m : { ...m, [id]: r }));
  }, []);

  const n = Math.max(2, Math.min(maxCols, Math.floor((w + gap) / (minCol + gap)) || 2));
  const colW = w > 0 ? (w - gap * (n - 1)) / n : 0;
  const heights = new Array<number>(n).fill(0);
  const pos: { left: number; top: number; h: number }[] = [];
  for (const it of items) {
    const r = ratios[it.id];
    if (r == null || colW <= 0) break;   // 앞이 아직이면 여기서 멈춘다 — 보이는 카드는 다시 움직이지 않는다
    const col = heights.indexOf(Math.min(...heights));
    const h = colW * r + infoH;
    pos.push({ left: col * (colW + gap), top: heights[col], h });
    heights[col] += h + gap;
  }
  const ready = pos.length;
  const height = ready ? Math.max(...heights) - gap : 0;
  const allReady = ready === items.length;

  useEffect(() => { onReadyChange?.(allReady); }, [allReady, onReadyChange]);

  return (
    <div ref={wrapRef} className="masonry" style={{ height, ['--mz-info' as string]: `${infoH}px` }}>
      {items.map((it, i) => {
        const p = pos[i];
        const extra = itemProps?.(it, i) ?? {};
        const { style: extraStyle, ...rest } = extra as { style?: React.CSSProperties };
        return (
          <div key={it.id} {...rest} className={`mz-item ${p ? 'on' : ''}`}
            style={{
              ...extraStyle,
              width: colW || undefined,
              ...(p
                ? { transform: `translate(${p.left}px, ${p.top}px)`, height: p.h }
                // 자리를 기다리는 동안 — 보이지 않게 두고 이미지만 미리 받는다
                : { visibility: 'hidden', pointerEvents: 'none' }),
            }}>
            {renderItem(it, i, r => report(it.id, r))}
          </div>
        );
      })}
    </div>
  );
}
