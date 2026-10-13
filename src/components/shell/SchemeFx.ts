'use client';
// 라이트/다크 전환 연출 (UFO 스킨 v2.0 사용자 요청) — 버튼에서 외계인이 탄 UFO가 날아올라 메뉴 바 바로 오른쪽에 멈추고,
// 견인 빔이 닿은 바닥에서부터 새 명암이 원형으로 번진 뒤 UFO는 왼쪽 위로 떠난다.
//
// 모양은 로고 옆 아이콘(TopBar BrandIcon)과 같은 결: 선만, 둥근 끝, 테마 포인트색(--primary-ink) 단색.
// 탑승한 외계인은 다크모드 로고의 외계인 얼굴을 그대로 줄여 넣었다. 색은 지금 명암의 포인트색으로 떠서,
// 새 명암이 번지고 나면 새 포인트색으로 넘어간다.
//
// 색이 번지는 부분은 View Transitions API — 바꾸기 전/후 화면을 찍어 두고 새 화면에 원형 clip-path를 키운다.
// 그래서 toggle()은 flushSync 안에서 실행해 바뀐 색이 그 자리에서 DOM에 칠해져야 한다(ThemeProvider는 layout effect로 칠한다).
// UFO는 view-transition-name으로 따로 떼어 두어 화면 스냅샷에 묻히지 않고 위에 떠 있다.
// 지원하지 않는 브라우저는 UFO만 날고 색은 한 번에 바뀐다. 「동작 줄이기」 설정이면 연출 없이 바로 바꾼다.
import { flushSync } from 'react-dom';

type VT = { ready: Promise<void>; finished: Promise<void>; skipTransition?: () => void };
type DocVT = Document & { startViewTransition?: (cb: () => void) => VT };

/** UFO 그림 72×160 — 위 0~40이 접시(외계인 탑승), 그 아래가 빔. 선·빔 모두 currentColor 단색 */
const UFO_SVG = `
<svg viewBox="0 0 72 160" width="72" height="160" fill="none" stroke="currentColor"
  stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <defs>
    <linearGradient id="ufoFxBeam" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" style="stop-color:currentColor;stop-opacity:.42"/>
      <stop offset="1" style="stop-color:currentColor;stop-opacity:0"/>
    </linearGradient>
  </defs>
  <g class="beam">
    <polygon points="27,37 45,37 68,160 4,160" fill="url(#ufoFxBeam)" stroke="none"/>
    <path d="M27 38 7 156M45 38l20 118" stroke-dasharray="3 6" opacity=".75"/>
  </g>
  <!-- 유리 돔 · 접시 · 아랫단 -->
  <path d="M15 28a21 20 0 0 1 42 0"/>
  <ellipse cx="36" cy="29.5" rx="32" ry="7.5"/>
  <path d="M15 34.5c6 3.6 36 3.6 42 0"/>
  <circle class="lt" cx="22" cy="31" r="1.6" fill="currentColor" stroke="none"/>
  <circle class="lt" cx="36" cy="32.6" r="1.6" fill="currentColor" stroke="none"/>
  <circle class="lt" cx="50" cy="31" r="1.6" fill="currentColor" stroke="none"/>
  <!-- 탑승한 외계인 — 로고의 외계인(24칸)을 0.8배로, 접시 윗선(y22) 위에 앉힌다.
       맨 나중에 그리고 얼굴 안을 바탕색으로 채워 돔·접시 선이 얼굴을 지나가지 않게. 더듬이만 돔 위로 살짝 나온다 -->
  <g transform="translate(36 15.5) scale(.8) translate(-12 -12.5)">
    <path d="M9 6 7 3M15 6l2-3" vector-effect="non-scaling-stroke"/>
    <circle cx="7" cy="2.6" r="1" fill="currentColor" stroke="none"/>
    <circle cx="17" cy="2.6" r="1" fill="currentColor" stroke="none"/>
    <path class="face" d="M12 5c-4.4 0-7 2.8-7 6.2 0 4 3.6 7.4 7 8.8 3.4-1.4 7-4.8 7-8.8C19 7.8 16.4 5 12 5z" vector-effect="non-scaling-stroke"/>
    <path d="M8.6 11.2c1.2.2 2 1 2.2 2.3M15.4 11.2c-1.2.2-2 1-2.2 2.3" vector-effect="non-scaling-stroke"/>
  </g>
</svg>`;

const W_UFO = 72;
const SAUCER_CY = 24;          // 그림 안에서 접시 중심 y
const BEAM_FLOOR = 160;        // 빔 바닥 y — 새 명암이 여기서 번지기 시작
const wait = (ms: number) => new Promise(r => setTimeout(r, ms));
const inkNow = () => getComputedStyle(document.documentElement).getPropertyValue('--primary-ink').trim() || 'currentColor';
let busy = false;              // 연출 중 연타 무시

/** 머무는 자리 — 메뉴 바(세로 사이드바) 바로 오른쪽, 본문이 시작하는 곳. 상단 바(좁은 화면)면 왼쪽 가장자리 */
function hoverSpot(vw: number, vh: number) {
  const side = document.querySelector('.topbar')?.getBoundingClientRect();
  let x = 56;
  if (side && side.width < vw * 0.6) x = side.right + W_UFO / 2 + 20;   // 세로 사이드바가 있는 PC 배치
  // 세로는 화면 가운데보다 조금 위 — 빔 바닥이 화면 안에 들어오게 (사용자 요청으로 30px 위로)
  const y = Math.max(60, Math.min(vh * 0.42 - 30, vh - BEAM_FLOOR + SAUCER_CY - 24));
  return { x, y };
}

/**
 * @param from   눌린 버튼 위치 — UFO가 여기서 출발
 * @param toggle 실제 명암 전환 (ThemeProvider.toggleScheme)
 */
export function playSchemeSwitch(from: DOMRect | null, toggle: () => void) {
  if (busy) return;
  if (typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { toggle(); return; }
  busy = true;
  const root = document.documentElement;
  const vw = window.innerWidth, vh = window.innerHeight;
  const { x: hx, y: hy } = hoverSpot(vw, vh);
  const sx = from ? from.left + from.width / 2 : 40, sy = from ? from.top + from.height / 2 : 40;
  const at = (x: number, y: number, extra = '') => `translate(${x - W_UFO / 2}px, ${y - SAUCER_CY}px) ${extra}`;

  const fx = document.createElement('div');
  fx.className = 'ufo-fx';
  fx.innerHTML = UFO_SVG;
  fx.style.color = inkNow();          // 지금 명암의 포인트색으로 등장
  document.body.appendChild(fx);

  let switched = false;
  // 한 번만 — 늦게 도는 전환 콜백과 finally의 안전장치가 겹쳐 두 번 뒤집히지 않게
  const flip = () => { if (switched) return; switched = true; toggle(); };
  const run = async () => {
    try {
      // 1) 버튼에서 튀어 올라 휘어진 궤적으로 메뉴 바 오른쪽까지
      await fx.animate([
        { transform: at(sx, sy, 'scale(.15) rotate(-30deg)'), opacity: 0 },
        { transform: at(Math.max(40, (sx + hx) / 2 + 60), (sy + hy) / 2 - 40, 'scale(.75) rotate(14deg)'), opacity: 1, offset: 0.55 },
        { transform: at(hx, hy + 8, 'scale(1.04) rotate(-4deg)'), offset: 0.85 },
        { transform: at(hx, hy, 'scale(1) rotate(0deg)'), opacity: 1 },
      ], { duration: 640, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'forwards' }).finished;

      // 2) 견인 빔
      fx.classList.add('beam-on');
      await wait(240);

      // 3) 빔 바닥에서 새 명암이 원형으로 번진다 — 왼쪽에서 오른쪽으로 쓸고 지나가는 모양
      const ox = hx, oy = hy - SAUCER_CY + BEAM_FLOOR;
      const r = Math.hypot(Math.max(ox, vw - ox), Math.max(oy, vh - oy));
      root.classList.add('scheme-switching');   // 전환 중 CSS transition을 꺼서 새 화면이 중간색으로 찍히지 않게
      const doc = document as DocVT;
      if (doc.startViewTransition) {
        const vt = doc.startViewTransition(() => flushSync(flip));
        // 화면이 그려지지 않는 상태(탭 전환·창 가림 등)면 전환이 시작되지 못한다 — 기다리지 않고 건너뛴다
        const started = await Promise.race([vt.ready.then(() => true, () => false), wait(1200).then(() => false)]);
        if (started) {
          root.animate(
            { clipPath: [`circle(0px at ${ox}px ${oy}px)`, `circle(${r}px at ${ox}px ${oy}px)`] },
            { duration: 900, easing: 'cubic-bezier(.55,0,.25,1)', pseudoElement: '::view-transition-new(root)' },
          );
          await Promise.race([vt.finished.catch(() => undefined), wait(2000)]);
        } else {
          vt.skipTransition?.();
          flip();
        }
      } else {
        flip();
        await wait(350);
      }
      root.classList.remove('scheme-switching');
      fx.style.color = inkNow();      // 새 명암의 포인트색으로 (CSS transition으로 부드럽게)

      // 4) 빔을 거두고 왼쪽 위로 떠난다
      await wait(280);
      fx.classList.remove('beam-on');
      await wait(140);
      await fx.animate([
        { transform: at(hx, hy), opacity: 1 },
        { transform: at(hx + 14, hy + 10, 'rotate(8deg)'), offset: 0.2 },
        { transform: at(-110, -90, 'scale(.35) rotate(-18deg)'), opacity: 0.4 },
      ], { duration: 560, easing: 'cubic-bezier(.6,0,.85,.35)', fill: 'forwards' }).finished;
    } finally {
      flip();   // 연출이 중간에 실패해도 명암은 바뀌어야 한다 (이미 바뀌었으면 아무것도 안 함)
      root.classList.remove('scheme-switching');
      fx.remove();
      busy = false;
    }
  };
  void run();
}
