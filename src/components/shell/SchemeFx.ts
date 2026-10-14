'use client';
// 라이트/다크 전환 연출 (UFO 스킨 v2.0 사용자 요청) — 누른 버튼을 중심으로 새 명암이 동그랗게 번진다.
// (한때 UFO가 날아와 빔을 쏘는 연출이었으나, 사용자 요청으로 원형 번짐만 남겼다)
//
// View Transitions API — 바꾸기 전/후 화면을 찍어 두고 새 화면에 원형 clip-path를 키운다.
// 그래서 toggle()은 flushSync 안에서 실행해 바뀐 색이 그 자리에서 DOM에 칠해져야 한다(ThemeProvider는 layout effect로 칠한다).
// 지원하지 않는 브라우저는 그냥 한 번에 바뀐다. 「동작 줄이기」 설정이면 연출 없이 바로 바꾼다.
import { flushSync } from 'react-dom';

type VT = { ready: Promise<void>; finished: Promise<void>; skipTransition?: () => void };
type DocVT = Document & { startViewTransition?: (cb: () => void) => VT };

const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
let busy = false;              // 연출 중 연타 무시

/**
 * @param from   눌린 버튼 위치 — 여기서부터 번진다
 * @param toggle 실제 명암 전환 (ThemeProvider.toggleScheme)
 */
export function playSchemeSwitch(from: DOMRect | null, toggle: () => void) {
  if (busy) return;
  const doc = document as DocVT;
  if (typeof window === 'undefined' || !doc.startViewTransition
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { toggle(); return; }
  busy = true;
  const root = document.documentElement;
  const vw = window.innerWidth, vh = window.innerHeight;
  const ox = from ? from.left + from.width / 2 : vw / 2;
  const oy = from ? from.top + from.height / 2 : vh / 2;
  const r = Math.hypot(Math.max(ox, vw - ox), Math.max(oy, vh - oy));   // 가장 먼 모서리까지

  let switched = false;
  // 한 번만 — 늦게 도는 전환 콜백과 finally의 안전장치가 겹쳐 두 번 뒤집히지 않게
  const flip = () => { if (switched) return; switched = true; toggle(); };
  const run = async () => {
    try {
      root.classList.add('scheme-switching');   // 전환 중 CSS transition을 꺼서 새 화면이 중간색으로 찍히지 않게
      const vt = doc.startViewTransition!(() => flushSync(flip));
      // 화면이 그려지지 않는 상태(탭 전환·창 가림 등)면 전환이 시작되지 못한다 — 기다리지 않고 건너뛴다
      const started = await Promise.race([vt.ready.then(() => true, () => false), wait(1200).then(() => false)]);
      if (started) {
        root.animate(
          { clipPath: [`circle(0px at ${ox}px ${oy}px)`, `circle(${r}px at ${ox}px ${oy}px)`] },
          { duration: 650, easing: 'cubic-bezier(.55,0,.25,1)', pseudoElement: '::view-transition-new(root)' },
        );
        await Promise.race([vt.finished.catch(() => undefined), wait(1600)]);
      } else {
        vt.skipTransition?.();
        flip();
      }
    } finally {
      flip();   // 연출이 중간에 실패해도 명암은 바뀌어야 한다 (이미 바뀌었으면 아무것도 안 함)
      root.classList.remove('scheme-switching');
      busy = false;
    }
  };
  void run();
}
