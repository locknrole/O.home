'use client';
// 썸네일 크롭 편집기 (6.1 v1.8) — 드래그(이동) + 확대/축소, 규격 고정 비율, 3분할 가이드
// 원본은 건드리지 않고 크롭 좌표만 저장. 좌표는 프레임 크기에 대한 비율(fraction)이라
// 어떤 크기의 썸네일에서도 동일하게 재현됨.
// 이미지는 항상 "원본 비율 그대로" 프레임을 덮도록 배치 — object-fit:cover처럼 초장부터
// 잘려나가는 영역이 없어, 이동하면 원본의 어느 부분이든 볼 수 있음.
import React, { useEffect, useRef, useState } from 'react';
import { Modal } from './Modal';
import { useThumbSrc } from '@/lib/blobStore';

/** 이보다 크게 확대한 크롭은 썸네일(짧은 변 640px)로는 흐려진다 — 원본을 쓴다 */
const THUMB_MAX_ZOOM = 1.6;

/** x·y = 프레임 크기 대비 중심 오프셋 비율 (-0.5~0.5 근방), scale = 배율 */
export interface CropValue { x: number; y: number; scale: number }
export type CropAspect = '3:4' | '4:3' | '16:9' | '1:1';

const RATIO: Record<CropAspect, number> = { '3:4': 3 / 4, '4:3': 4 / 3, '16:9': 16 / 9, '1:1': 1 };

/** 커버 배치 스타일 — 원본 비율 유지, 프레임을 항상 덮음 (편집기와 표시가 동일 수식)
 *  wide: 이미지가 프레임보다 가로로 긴 형태인지 (natR >= frameR) → 높이 기준 커버, 가로가 넘침 */
export function coverImgStyle(crop: CropValue | undefined, wide: boolean): React.CSSProperties {
  const c = crop ?? { x: 0, y: 0, scale: 1 };
  return {
    position: 'absolute',
    left: `${(0.5 + c.x) * 100}%`,
    top: `${(0.5 + c.y) * 100}%`,
    transform: 'translate(-50%,-50%)',
    maxWidth: 'none',
    ...(wide ? { height: `${c.scale * 100}%`, width: 'auto' } : { width: `${c.scale * 100}%`, height: 'auto' }),
  };
}

/** 다른 비율의 틀에서 잡은 크롭을 지금 틀에 옮긴다 (v2.0 사용자 제보 — AU 목록 정사각 칸에서 그림이 엉뚱하게 잘림).
 *  크롭 값은 「틀 크기 대비 비율」이라 4:3 틀에서 잡은 값을 1:1 틀에 그대로 쓰면 다른 곳이 보인다.
 *  그래서 원래 틀에서 보이던 영역의 **가운데 지점**과 **세로로 보이던 양**을 그림 기준으로 구해
 *  새 틀에서도 그 영역이 보이도록 다시 계산한다. 새 틀이 그림 밖으로 나가지 않게 가운데를 조인다.
 *  R = 그림 가로/세로, from = 크롭을 잡은 틀의 가로/세로, to = 지금 틀의 가로/세로 */
export function adaptCrop(c: CropValue, R: number, from: number, to: number): CropValue {
  // 원래 틀(세로 1 기준)에서의 그림 크기
  const w1 = R >= from ? c.scale * R : c.scale * from;
  const h1 = w1 / R;
  const u = 0.5 - (c.x * from) / w1;   // 틀 가운데가 가리키던 그림 위 지점 (0~1)
  const v = 0.5 - c.y / h1;
  let vh = 1 / h1;                     // 세로로 보이던 비율
  // 새 틀에서 같은 세로 양을 보여 주되, 가로가 그림을 넘으면 넘지 않게 줄인다
  if (vh * to / R > 1) vh = R / to;
  vh = Math.min(vh, 1);
  const h2 = 1 / vh, w2 = h2 * R;      // 새 틀(세로 1 기준)에서의 그림 크기
  const vw = to / w2;
  const cu = Math.min(Math.max(u, vw / 2), 1 - vw / 2);
  const cv = Math.min(Math.max(v, vh / 2), 1 - vh / 2);
  const scale = R >= to ? h2 : w2 / to;
  return { x: ((0.5 - cu) * w2) / to, y: (0.5 - cv) * h2, scale };
}

/** 크롭 없이 위쪽 기준으로 채우기 — 세로로 긴 그림을 가운데로 자르면 얼굴(윗부분)이 잘려서 (v2.0) */
function topCrop(R: number, to: number): CropValue {
  if (R >= to) return { x: 0, y: 0, scale: 1 };       // 가로로 긴 그림은 위아래가 안 잘린다
  const h = to / R;                                    // 틀 세로 1 기준 그림 높이
  return { x: 0, y: h / 2 - 0.5, scale: 1 };
}

/** 프레임 채움 크롭 이미지 — 컨테이너·원본 비율을 측정해 커버 방향을 자동 결정.
 *  부모는 position:relative(또는 absolute)여야 함.
 *  from: 크롭을 잡은 틀의 비율(가로/세로) — 지금 틀과 다르면 adaptCrop으로 옮긴다.
 *  anchorTop: 크롭이 없을 때 가운데 대신 위쪽 기준으로 */
export function CropImg({ src, crop, alt, from, anchorTop, onError }: {
  src: string; crop?: CropValue; alt?: string; from?: number; anchorTop?: boolean;
  /** 썸네일이 안 받아질 때 원본으로 바꾸는 데 쓴다 (useThumbSrc) */
  onError?: () => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const natRef = useRef<{ w: number; h: number } | null>(null);
  const [fit, setFit] = useState<{ wide: boolean; crop?: CropValue } | null>(null);
  const compute = () => {
    const r = wrapRef.current?.getBoundingClientRect();
    const n = natRef.current;
    if (!(r && n && r.width > 1 && r.height > 1)) return;
    const R = n.w / n.h, to = r.width / r.height;
    let c = crop;
    if (c && from && Math.abs(from - to) > 0.01) c = adaptCrop(c, R, from, to);
    else if (!c && anchorTop) c = topCrop(R, to);
    setFit({ wide: R >= to, crop: c });
  };
  useEffect(() => {
    compute();
    const el = wrapRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(compute);
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, crop, from, anchorTop]);
  return (
    <div ref={wrapRef} style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt ?? ''} draggable={false} loading="lazy" decoding="async" onError={onError}
        onLoad={e => { const im = e.currentTarget; natRef.current = { w: im.naturalWidth, h: im.naturalHeight }; compute(); }}
        style={fit == null ? { opacity: 0 } : coverImgStyle(fit.crop, fit.wide)} />
    </div>
  );
}

/** 파일 참조 + 크롭을 적용해 표시하는 썸네일 (없으면 플레이스홀더) */
export function CroppedBlobImg({ fileRef, crop, ph, label, alt, from, anchorTop, thumb }: {
  fileRef?: string; crop?: CropValue; ph?: string; label?: string; alt?: string;
  /** 크롭을 잡은 틀의 비율(가로/세로) — 다른 비율 칸에 쓸 때 넘기면 같은 부분이 보이게 옮긴다 */
  from?: number;
  /** 크롭이 없을 때 위쪽 기준으로 채우기 (세로 그림의 얼굴이 잘리지 않게) */
  anchorTop?: boolean;
  /** 목록 칸처럼 작게 보이는 자리 — 썸네일로 받는다 (v2.1). 크게 확대한 크롭은 흐려지므로 원본 유지 */
  thumb?: boolean;
}) {
  const [url, onError] = useThumbSrc(fileRef, !!thumb && (crop?.scale ?? 1) <= THUMB_MAX_ZOOM);
  if (!url) {
    return <div className={`ph ${ph ?? ''}`} style={{ width: '100%', height: '100%' }}>{label && <span>{label}</span>}</div>;
  }
  return <CropImg src={url} crop={crop} alt={alt} from={from} anchorTop={anchorTop} onError={onError} />;
}

export function CropEditor({ open, src, aspect, aspectLabel, initial, onClose, onApply }: {
  open: boolean;
  src: string;
  aspect: CropAspect | number;     // 게시판 규격 프리셋 또는 임의 비율(가로/세로 — 예: 현재 배너 비율)
  aspectLabel?: string;            // 비율 표기 대체 문구 (임의 비율일 때)
  initial?: CropValue;
  onClose: () => void;
  onApply: (crop: CropValue) => void;
}) {
  const [crop, setCrop] = useState<CropValue>(initial ?? { x: 0, y: 0, scale: 1 });
  const frameRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<HTMLDivElement>(null);
  const [natR, setNatR] = useState<number | null>(null);  // 원본 가로/세로 비
  const frameR = typeof aspect === 'number' ? aspect : RATIO[aspect];
  const aspectText = aspectLabel ?? (typeof aspect === 'number' ? `${aspect.toFixed(2)}:1` : aspect);
  const wide = natR != null ? natR >= frameR : true;

  useEffect(() => {
    if (open) setCrop(initial ?? { x: 0, y: 0, scale: 1 });
  }, [open, initial]);

  // 이미지가 항상 프레임을 가득 채우도록 오프셋 클램프 — 빈 공간이 보이는 상태 방지.
  // 커버 크기는 비율만으로 계산 (프레임 픽셀 크기 불필요 — x·y와 같은 fraction 단위)
  const clamp = (c: CropValue): CropValue => {
    const scale = Math.min(3, Math.max(1, c.scale));
    if (natR == null) return { ...c, scale };
    const coverW = wide ? natR / frameR : 1;   // 프레임 폭 대비 이미지 표시 폭
    const coverH = wide ? 1 : frameR / natR;   // 프레임 높이 대비 이미지 표시 높이
    const maxX = Math.max(0, (scale * coverW - 1) / 2);
    const maxY = Math.max(0, (scale * coverH - 1) / 2);
    return {
      scale,
      x: Math.min(maxX, Math.max(-maxX, c.x)),
      y: Math.min(maxY, Math.max(-maxY, c.y)),
    };
  };

  const onPan = (e: React.PointerEvent) => {
    e.preventDefault();
    const r = frameRef.current!.getBoundingClientRect();
    const sx = e.clientX, sy = e.clientY;
    const bx = crop.x, by = crop.y;
    const mv = (ev: PointerEvent) => {
      setCrop(c => clamp({
        ...c,
        x: bx + (ev.clientX - sx) / r.width,
        y: by + (ev.clientY - sy) / r.height,
      }));
    };
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  const setZoomFromPointer = (clientX: number) => {
    const r = zoomRef.current!.getBoundingClientRect();
    const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
    setCrop(c => clamp({ ...c, scale: 1 + t * 2 })); // 1x ~ 3x
  };

  const onZoomDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    setZoomFromPointer(e.clientX);
    const mv = (ev: PointerEvent) => setZoomFromPointer(ev.clientX);
    const up = () => { window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', mv);
    window.addEventListener('pointerup', up);
  };

  return (
    <Modal open={open} onClose={onClose} title="썸네일 영역 지정"
      desc={`크롭 비율 ${aspectText} — 드래그로 이동, 슬라이더/휠로 확대 · 원본은 잘리지 않음`}
      actions={<>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        <button className="btn btn-dark" onClick={() => onApply(crop)}>APPLY</button>
      </>}>
      <div
        ref={frameRef}
        className="crop-frame"
        // 세로 480px 이내로 캡 — 세로형(3:4)도 모달 전체가 약 700px 안에서 해결됨
        style={{
          aspectRatio: String(frameR),
          width: `min(100%, ${Math.round(480 * frameR)}px)`,
          margin: '0 auto',
        }}
        onPointerDown={onPan}
        onWheel={e => {
          setCrop(c => clamp({ ...c, scale: c.scale - Math.sign(e.deltaY) * 0.08 }));
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="" draggable={false} style={coverImgStyle(crop, wide)}
          onLoad={e => { const im = e.currentTarget; if (im.naturalHeight > 0) setNatR(im.naturalWidth / im.naturalHeight); }} />
        <div className="grid-ov" />
      </div>
      <div className="crop-foot">
        <span style={{ fontSize: 11, color: 'var(--faint)' }}>확대 {crop.scale.toFixed(2)}×</span>
        {/* 자체 줌 슬라이더 (기본 range 미사용 — 7장) */}
        <div ref={zoomRef} onPointerDown={onZoomDrag}
          style={{ flex: 1, maxWidth: 220, height: 4, borderRadius: 4, background: '#d7dae0', position: 'relative', cursor: 'var(--cur-pointer,pointer)' }}>
          <i style={{
            position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 4,
            width: `${((crop.scale - 1) / 2) * 100}%`, background: 'var(--accent)',
          }} />
          <i style={{
            position: 'absolute', top: '50%', left: `${((crop.scale - 1) / 2) * 100}%`,
            width: 14, height: 14, borderRadius: '50%', background: '#fff', transform: 'translate(-50%,-50%)',
            boxShadow: '0 1px 5px rgba(0,0,0,.35)',
          }} />
        </div>
        <button className="btn btn-ghost" style={{ padding: '5px 11px', fontSize: 11 }}
          onClick={() => setCrop({ x: 0, y: 0, scale: 1 })}>초기화</button>
      </div>
    </Modal>
  );
}
