'use client';
// 사이드바 상단 G1 배너 (v2.0 사용자 요청) — 필름 액자 속 애니메이션 장면 일곱 개를 지금 메뉴에 맞춰 바꿔 보여 준다.
// 장면 그림은 claude.ai 디자인 「locknrole 메뉴 전환 애니메이션」의 최종본 Pick_J11(라이트)·Pick_J11_dark(다크)에서 뽑은
// public/g1/scene-N.svg · scene-N-dark.svg — 각 파일 안에 자기 애니메이션 CSS가 들어 있어 <img>로 띄워도 움직인다.
// 바뀔 때마다 새로 띄워 등장 연출이 다시 돈다. 어느 메뉴에도 해당하지 않는 페이지(글 상세 등)에서는 직전 장면을 그대로 둔다.
// 다크모드는 민트·초록 그림, 커스텀 테마는 라이트 그림. PC는 사이드바 맨 위, 모바일·태블릿은 상단 바 맨 위 (skin.css).
import React, { useEffect, useState } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { useTheme } from '@/lib/ThemeProvider';

/** 장면 순서 = 그림 파일 번호 (scene-1.svg …) — 이름은 화면에 띄우지 않고 찾아보기용으로만 */
const SCENES = ['숲 UFO', '도심', '라이터', '오렌지 클로즈업', '밀밭 드라이브', '지구와 달', '산사의 범종'];

/* 메뉴 → 장면 (사용자 지정): 메인=숲 UFO · 일기=도심 · 백업=지구와 달(우주) · 로그=라이터 · 감상=오렌지 ·
   trpg=밀밭 드라이브 · 방명록=산사의 범종.
   메뉴는 환경설정 > 메뉴 관리에서 정한 주소로 맞춘다 — 메뉴 주소를 바꾸면 여기도 같이 바꿔야 한다 */
const LOG_BOARD_ID = 'mv811m86jk9h';   // 「로그」 게시판 (/board?b=…)
function sceneFor(path: string, board: string | null): number | null {
  if (path === '/') return 0;                                    // 메인
  if (path.startsWith('/diary')) return 1;                       // 일기
  if (path === '/board' || path === '/board/write') {
    if (board === LOG_BOARD_ID) return 2;                        // 로그
    if (!board) return 5;                                        // 백업 (기본 게시판)
    return null;
  }
  if (path.startsWith('/gallery')) return 3;                     // 감상
  if (path.startsWith('/trpg')) return 4;                        // trpg
  if (path.startsWith('/guest')) return 6;                       // 방명록
  return null;
}

export function G1Banner() {
  const pathname = usePathname();
  const params = useSearchParams();
  const [scene, setScene] = useState(0);
  const board = params.get('b');
  const { scheme } = useTheme();
  const tone = scheme === 'dark' ? '-dark' : '';   // 다크모드면 민트·초록 그림
  useEffect(() => {
    const s = sceneFor(pathname, board);
    if (s != null) setScene(s);
  }, [pathname, board]);

  /* 모바일·태블릿 — 본문을 아래로 스크롤하면 배너를 위로 접어 올리고, 맨 위로 돌아오면 다시 펼친다 (v2.0 사용자 요청).
     상단 바가 늘 화면에 붙어 있어 배너가 자리를 계속 차지했다. 접힘 기준에 간격을 둬 경계에서 깜빡이지 않게.
     PC는 배너가 사이드바에 있어 본문 스크롤과 무관 — skin.css가 모바일에서만 접힘을 적용한다 */
  const [tucked, setTucked] = useState(false);
  useEffect(() => {
    const host = document.getElementById('appMain');
    if (!host) return;
    const onScroll = () => setTucked(t => {
      if (t) return host.scrollTop > 4;
      // 스크롤할 거리가 긴 페이지(400px 넘게)에서만 접는다 — 메인처럼 조금만 내려가는 페이지는 배너를 그대로 두고
      // (사용자 요청), 짧은 페이지에서 접혔다 펴졌다 반복하지도 않게
      return host.scrollTop > 40 && host.scrollHeight - host.clientHeight > 400;
    });
    onScroll();
    host.addEventListener('scroll', onScroll, { passive: true });
    return () => host.removeEventListener('scroll', onScroll);
  }, []);
  // 다른 페이지로 가면 새 페이지는 맨 위에서 시작하니 배너도 다시 펼친다
  useEffect(() => { setTucked(false); }, [pathname]);

  return (
    <div className={`g1-banner${tucked ? ' tucked' : ''}`} aria-hidden>
      <div className="g1-frame">
        {/* key — 장면이 바뀔 때 새로 띄워 그림 안의 등장 연출이 다시 돈다 */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img key={scene + tone} src={`/g1/scene-${scene + 1}${tone}.svg`} alt="" draggable={false} />
      </div>
      {/* 나머지 장면은 미리 받아 둔다 — 메뉴를 옮길 때 빈 액자가 보이지 않게 */}
      <div hidden>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {SCENES.map((_, i) => i !== scene && <img key={i + tone} src={`/g1/scene-${i + 1}${tone}.svg`} alt="" />)}
      </div>
    </div>
  );
}
