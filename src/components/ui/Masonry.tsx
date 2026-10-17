'use client';
// 핀터레스트형 메이슨리 (갤러리 v2.0 사용자 요청) — 이미지 원래 비율 그대로, 가장 짧은 열에 차곡차곡.
// 배치는 「열 폭 × 이미지 비율 + 정보줄 높이」만으로 계산한다(DOM 측정 없음) — 같은 입력이면 같은 자리.
// 앞 항목들의 비율이 전부 확인된 항목까지만 보여 준다: 뒤늦게 로드된 앞 이미지 때문에
// 이미 보이는 카드가 다른 열로 튀는 일이 없다(아직 안 보이는 항목만 자리가 정해지기를 기다린다).
// 가로로 긴 그림(wideRatio 이하)은 열 두 개 폭을 차지한다 (v2.0 사용자 요청 — 한 칸에선 너무 작게 보여서).
// 이웃한 두 열 중 바닥이 가장 높이 있는(=덜 쌓인) 쌍에 놓고, 두 열 높이가 맞을 때까지 잠깐 미뤄 빈칸을 줄인다. 2열이면 곧 한 줄 전체.
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

export function Masonry<T extends { id: string }>({
  items, renderItem, itemProps, infoH, minCol = 200, maxCols = 5, gap = 14, wideRatio = 0, complete = true, onReadyChange,
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
  /** 세로/가로 비가 이 값 이하인(가로로 긴) 항목은 두 칸 폭 — 0이면 끔. 0.67 ≈ 3:2(가로가 세로의 1.5배) */
  wideRatio?: number;
  /** 이 뒤로 더 올 항목이 없는지 — 무한 스크롤로 묶음이 남았으면 false (끝의 긴 항목이 다음 묶음으로 빈칸을 채우게 기다린다) */
  complete?: boolean;
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
  /* 자리 계산 — 항목 순서대로 쌓되, 가로로 긴 항목은 이웃한 두 열의 높이가 거의 맞을 때까지 잠깐 미룬다
     (v2.0 사용자 요청 — 두 칸 그림 위 짧은 열에 빈칸이 보여서, 순서가 조금 바뀌어도 좋다고 함).
     미루는 동안 뒤의 보통 항목이 짧은 열을 먼저 채운다. 최대 WAIT_MAX개까지만 기다리고 그래도 안 맞으면 그냥 놓는다.
     자리는 앞에서부터만 정해지므로, 한 번 놓인(화면에 뜬) 항목은 뒤 항목이 로드되거나 묶음이 늘어도 움직이지 않는다 */
  const WAIT_MAX = 4;
  const tol = colW * 0.2;                       // 이 정도 차이면 「높이가 맞았다」로 본다
  const pos: ({ left: number; top: number; h: number; w: number } | undefined)[] = [];
  const pending: { i: number; r: number; waited: number }[] = [];
  const bestPair = () => {
    let c = 0, top = Infinity, diff = 0;
    for (let k = 0; k < n - 1; k++) {
      const t = Math.max(heights[k], heights[k + 1]);
      if (t < top) { top = t; c = k; diff = Math.abs(heights[k] - heights[k + 1]); }
    }
    return { c, top, diff };
  };
  const placeWide = (i: number, r: number) => {
    // 두 칸 폭 — 이웃한 두 열의 바닥 중 낮은 쪽(더 아래)에 맞춰 놓는다. 덜 쌓인 쌍을 고른다
    const { c, top } = bestPair();
    const wide = colW * 2 + gap;
    const h = wide * r + infoH;
    pos[i] = { left: c * (colW + gap), top, h, w: wide };
    heights[c] = heights[c + 1] = top + h + gap;
  };
  const flushPending = (force: boolean) => {
    while (pending.length) {
      const first = pending[0];
      if (!force && first.waited < WAIT_MAX && bestPair().diff > tol) break;
      placeWide(first.i, first.r);
      pending.shift();
    }
  };
  let reachedEnd = true;
  for (let i = 0; i < items.length; i++) {
    const r = ratios[items[i].id];
    if (r == null || colW <= 0) { reachedEnd = false; break; }   // 앞이 아직이면 여기서 멈춘다
    if (wideRatio > 0 && r <= wideRatio && n >= 2) {
      pending.push({ i, r, waited: 0 });
    } else {
      const col = heights.indexOf(Math.min(...heights));
      const h = colW * r + infoH;
      pos[i] = { left: col * (colW + gap), top: heights[col], h, w: colW };
      heights[col] += h + gap;
      pending.forEach(p => { p.waited++; });
    }
    flushPending(false);
  }
  // 끝까지 왔는데 아직 기다리는 긴 항목 — 더 올 항목이 없으면(complete) 지금 놓고,
  // 다음 묶음이 올 예정이면 그 항목들로 빈칸을 채울 수 있게 계속 기다린다
  if (reachedEnd && complete) flushPending(true);
  const placed = pos.filter(Boolean).length;
  const height = placed ? Math.max(...heights) - gap : 0;
  // 무한 스크롤용 「다 자리 잡음」 — 기다리는 긴 항목은 다음 묶음을 받아야 놓이므로 막지 않는다
  const allReady = reachedEnd && placed + (complete ? 0 : pending.length) === items.length;

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
              width: (p ? p.w : colW) || undefined,   // 가로로 긴 항목은 두 칸 폭
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
