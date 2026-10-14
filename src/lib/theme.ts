// 테마 시스템 — 기획서 5.1
// 모드 4종: 라이트 / 다크(기본) / 포인트 자동(다크·라이트 톤) / 완전 커스텀
// 모든 색은 순수 hex로 저장(환경설정 hex 입력란과 1:1) — 반투명이 필요한 곳은
// themeToCssVars 에서 고정 알파를 적용해 CSS 변수로 변환한다.
import { adjust, hexToHsl, hslToHex, withAlpha } from './color';

export type ThemeMode = 'light' | 'dark' | 'point' | 'custom';
export type PointTone = 'dark' | 'light';

/** 환경설정에서 항목별로 제어되는 테마 변수 (5.1 상세 설정 항목) */
export interface ThemeVars {
  // 배경 그라데이션 (시작색 → 끝색)
  bgG1: string; bgG2: string;
  // 배경 확장 (v1.9): 그라데이션/이미지 선택 · 그라데이션 각도 · 이미지(IndexedDB)와 블러
  bgType?: 'gradient' | 'image';
  bgAngle?: number;          // 그라데이션 각도 (deg, 기본 180)
  bgImageId?: string;        // 배경 이미지 파일 id (IndexedDB)
  bgBlur?: number;           // 배경 이미지 블러 px (0 = 없음)
  // 카드(패널·게시판 리스트·필터 등) 배경/글씨 (v1.9) — 보조 글씨색은 글씨색에서 자동 파생
  cardBg?: string; cardFg?: string;
  // 상단메뉴: 배경 · 글씨 · 호버 글씨(v1.9 분리) · 로고 글씨
  topBg: string; topFg: string; topHv: string; topBrand: string;
  // 하위메뉴 드롭다운: 배경 · 글씨 · 호버(오버레이 색)
  ddBg: string; ddFg: string; ddHv: string;
  // 페이지 타이틀 / 설명
  pageTitle: string; pageDesc: string;
  // 페이지 헤더 표시 (v1.9): 둘 다 / 제목만 / 설명만 / 둘 다 안 띄움
  pageHead?: 'both' | 'title' | 'desc' | 'none';
  // 모바일 헤더 (v1.9 사용자 요청): PC 설정과 동일 / 모바일에서만 생략
  pageHeadM?: 'same' | 'none';
  // BGM 플레이어
  bgmBg: string; bgmFg: string; bgmIc: string; bgmVol: string;
  // 스크롤바: 색 · 테두리색
  sbThumb: string; sbBd: string;
  // 검색창 (6.4 공통 검색): 배경 · 글씨 · 아이콘/플레이스홀더 · 테두리
  searchBg?: string; searchFg?: string; searchIc?: string; searchBd?: string;
  // 진한 버튼(btn-dark) — 배경·글씨·호버 3색. 체크박스·선택 필터 칩에도 공통 적용 (v1.9 사용자 피드백)
  btnDark?: string; btnDarkFg?: string; btnDarkHv?: string;
  // 스티커 메모 보드 (v1.9 사용자 피드백) — 메모장 배치 판·메인 미니보드 배경/테두리
  // (기존 고정 rgba가 라이트 모드에서 안 보이던 문제)
  memoBoard?: string; memoBoardBd?: string;
  // 캐릭터 탭 리스트 (v1.9 사용자 피드백) — 좌측 아이콘 탭: 배경·글씨·선택 배경·선택 글씨
  tabBg?: string; tabFg?: string; tabOnBg?: string; tabOnFg?: string;
  // 스위치 탭 (v2.0 사용자 요청) — 게시판 말머리·갤러리 보기 전환 등. 고른 쪽은 진한 버튼색을 그대로 따라가고
  // 여기서 정하는 것은 「안 고른 쪽」의 판 배경과 글씨색
  segBg?: string; segFg?: string;
  // 위젯 (v2.0 사용자 요청) — 메인·사이드에 얹히는 카드. 미지정이면 카드 색을 그대로 따라간다.
  // wgBorder를 켜야 테두리를 그린다(기본은 그림자만, 지금까지의 모습)
  wgBg?: string; wgTitle?: string; wgFg?: string;
  wgBorder?: boolean; wgBd?: string;
  // 이미지 편집(크롭) 배경 (v1.9 사용자 피드백) — 투명 PNG 위치 지정 시 보이는 판
  cropBg?: string;
  // 입력 포커스 (v1.9 사용자 요청) — 인풋·텍스트에리어·드롭다운·에디터 공통
  // focusColor: 테두리·링 색 / focusRing: 링 방식(은은한 글로우 · 선명한 라인 · 없음) / focusW: 링 두께 px
  focusColor?: string; focusRing?: 'glow' | 'line' | 'none'; focusW?: number;
  // 포인트 컬러
  accent: string; accentSoft: string;
  // 모서리 둥글기(px)
  radius: number; radiusS: number;
  // 블록(패널·카드) 그림자 세기 % — 0 = 없음, 100 = 기본, 200 = 최대
  shadow: number;
  // 드롭다운(하위메뉴·프로필 메뉴) 그림자 세기 % — 블록 그림자와 별개 (없는 편이 예쁠 때가 있음)
  ddShadow?: number;
  // 드롭섀도우 색 (블록·드롭다운 공통, 기본 검정)
  shColor?: string;
}

export interface ThemeState {
  mode: ThemeMode;
  pointTone: PointTone;
  vars: ThemeVars;
}

/* UFO 스킨 (티스토리 Gravity 스킨 결) — 흰/먹색 한 장 바탕 + 1px 선 + 그림자 없음.
   라이트는 베이지(#E3D4C7), 다크는 민트(#C7E3D4)가 포인트. 페이지 바탕과 카드가 같은 색이고
   카드는 선으로만 구분한다 (skin.css가 --line을 칠한다) */

/** 다크 모드 (기본 디폴트) — UFO 스킨 다크: 먹색 바탕 + 민트 */
export const DARK_THEME: ThemeVars = {
  bgG1: '#1f1f1f', bgG2: '#1f1f1f',
  bgType: 'gradient', bgAngle: 180, bgBlur: 0,
  cardBg: '#1f1f1f', cardFg: '#fcfcfc',
  topBg: '#1f1f1f', topFg: '#fcfcfc', topHv: '#c7e3d4', topBrand: '#fcfcfc',
  ddBg: '#292929', ddFg: '#fcfcfc', ddHv: '#ffffff',
  pageTitle: '#c7e3d4', pageDesc: '#7f7f7f',
  bgmBg: '#292929', bgmFg: '#fcfcfc', bgmIc: '#9a9a9a', bgmVol: '#c7e3d4',
  sbThumb: '#c7e3d4', sbBd: '#1f1f1f',
  searchBg: '#1f1f1f', searchFg: '#fcfcfc', searchIc: '#7f7f7f', searchBd: '#3b3b3b',
  btnDark: '#c7e3d4', btnDarkFg: '#1f1f1f', btnDarkHv: '#b3d6c3',
  memoBoard: '#292929', memoBoardBd: '#3b3b3b',
  tabBg: '#292929', tabFg: '#9a9a9a', tabOnBg: '#c7e3d4', tabOnFg: '#1f1f1f',
  segBg: '#292929', segFg: '#9a9a9a',
  wgTitle: '#c7e3d4', wgBorder: true, wgBd: '#3b3b3b',
  cropBg: '#292929',
  focusColor: '#c7e3d4',
  accent: '#eb622e', accentSoft: '#f4a27f',
  radius: 14, radiusS: 10, shadow: 0, ddShadow: 60,
};

/** 라이트 모드 — UFO 스킨 라이트: 흰 바탕 + 베이지. 베이지 원색은 글씨로 쓰기엔 옅어 제목은 한 톤 진하게 */
export const LIGHT_THEME: ThemeVars = {
  bgG1: '#ffffff', bgG2: '#ffffff',
  bgType: 'gradient', bgAngle: 180, bgBlur: 0,
  cardBg: '#ffffff', cardFg: '#444444',
  topBg: '#ffffff', topFg: '#444444', topHv: '#b89c84', topBrand: '#444444',
  ddBg: '#ffffff', ddFg: '#444444', ddHv: '#000000',
  pageTitle: '#c4a88f', pageDesc: '#7f7f7f',
  bgmBg: '#ffffff', bgmFg: '#444444', bgmIc: '#7f7f7f', bgmVol: '#c4a88f',
  sbThumb: '#e3d4c7', sbBd: '#ffffff',
  searchBg: '#ffffff', searchFg: '#444444', searchIc: '#7f7f7f', searchBd: '#eaeaea',
  btnDark: '#e3d4c7', btnDarkFg: '#444444', btnDarkHv: '#d8c4b2',
  memoBoard: '#fbfbfb', memoBoardBd: '#eaeaea',
  tabBg: '#fbfbfb', tabFg: '#7f7f7f', tabOnBg: '#e3d4c7', tabOnFg: '#444444',
  segBg: '#fbfbfb', segFg: '#7f7f7f',
  wgTitle: '#c4a88f', wgBorder: true, wgBd: '#f2f2f2',
  cropBg: '#f2f2f2',
  focusColor: '#e3d4c7',
  accent: '#eb622e', accentSoft: '#f4a27f',
  radius: 14, radiusS: 10, shadow: 0, ddShadow: 30,
};

/**
 * 포인트 자동 모드 (v1.8 확정) — 포인트 컬러 하나로 전체 팔레트 파생.
 * 톤(다크/라이트) 선택 가능, 파생값은 세부 항목 hex 란에 전부 채워짐 (v1.9).
 */
export function derivePointTheme(accent: string, tone: PointTone): ThemeVars {
  const { h, s } = hexToHsl(accent);
  const c = (sat: number, lig: number) => hslToHex({ h, s: Math.min(1, s * sat), l: lig });
  const accentSoft = adjust(accent, cc => ({ l: Math.min(0.75, cc.l + 0.18), s: cc.s * 0.8 }));

  if (tone === 'dark') {
    return {
      bgG1: c(0.28, 0.2), bgG2: c(0.32, 0.07),
      bgType: 'gradient', bgAngle: 180, bgBlur: 0,
      cardBg: c(0.12, 0.985), cardFg: c(0.4, 0.14),
      topBg: c(0.3, 0.09), topFg: c(0.14, 0.68), topHv: c(0.2, 0.97), topBrand: c(0.12, 0.95),
      ddBg: c(0.28, 0.11), ddFg: c(0.14, 0.78), ddHv: '#ffffff',
      pageTitle: c(0.1, 0.93), pageDesc: c(0.12, 0.62),
      bgmBg: c(0.3, 0.08), bgmFg: c(0.1, 0.94), bgmIc: c(0.12, 0.82), bgmVol: c(0.1, 0.9),
      sbThumb: c(0.22, 0.38), sbBd: c(0.3, 0.1),
      searchBg: c(0.26, 0.14), searchFg: c(0.1, 0.9), searchIc: c(0.12, 0.6), searchBd: c(0.22, 0.24),
      btnDark: c(0.38, 0.12), btnDarkFg: c(0.08, 0.97), btnDarkHv: c(0.38, 0.19), /* 채도 살짝↑ 명도 아주 약간↓ — 컬러감 (v1.9 사용자 피드백) */
      memoBoard: c(0.26, 0.17), memoBoardBd: c(0.22, 0.27),
      tabBg: c(0.26, 0.22), tabFg: c(0.14, 0.68), tabOnBg: c(0.12, 0.985), tabOnFg: c(0.4, 0.14),
      cropBg: c(0.24, 0.19),
      accent, accentSoft,
      radius: 14, radiusS: 9, shadow: 100, ddShadow: 100,
    };
  }
  // 라이트 톤 — 호버 글씨색은 어두운 포인트색 파생 (흰 배경 위 흰 글씨 방지, v1.9)
  const deepAccent = adjust(accent, cc => ({ l: Math.min(cc.l, 0.38) }));
  return {
    bgG1: c(0.25, 0.95), bgG2: c(0.3, 0.86),
    bgType: 'gradient', bgAngle: 180, bgBlur: 0,
    cardBg: c(0.15, 0.99), cardFg: c(0.4, 0.14),
    topBg: c(0.35, 0.97), topFg: c(0.3, 0.38), topHv: deepAccent, topBrand: c(0.45, 0.22),
    ddBg: c(0.3, 0.98), ddFg: c(0.3, 0.3), ddHv: '#000000',
    pageTitle: c(0.45, 0.22), pageDesc: c(0.2, 0.5),
    bgmBg: c(0.3, 0.98), bgmFg: c(0.4, 0.24), bgmIc: c(0.3, 0.4), bgmVol: c(0.4, 0.3),
    sbThumb: c(0.2, 0.72), sbBd: c(0.25, 0.88),
    searchBg: c(0.3, 0.99), searchFg: c(0.4, 0.24), searchIc: c(0.2, 0.55), searchBd: c(0.25, 0.84),
    btnDark: c(0.33, 0.4), btnDarkFg: c(0.1, 0.99), btnDarkHv: c(0.33, 0.46), // 라이트 톤 — 뮤트 버튼 (대비 완화 · 채도 살짝↑ 명도 약간↓, v1.9)
    memoBoard: c(0.2, 0.9), memoBoardBd: c(0.22, 0.8),
    tabBg: c(0.22, 0.88), tabFg: c(0.3, 0.42), tabOnBg: c(0.15, 0.99), tabOnFg: c(0.4, 0.14),
    cropBg: c(0.2, 0.89),
    accent, accentSoft,
    radius: 14, radiusS: 9, shadow: 30, ddShadow: 30, // 라이트 톤도 그림자 약하게 (30%)
  };
}

export function themeForMode(mode: ThemeMode, accent: string, tone: PointTone, custom: ThemeVars): ThemeVars {
  switch (mode) {
    case 'light': return LIGHT_THEME;
    case 'dark': return DARK_THEME;
    case 'point': return derivePointTheme(accent, tone);
    case 'custom': return custom;
  }
}

/* ---------- 모드별 독립 설정 저장소 (v1.9 — 모드 전환이 수정값을 리셋하지 않음) ---------- */
export interface ThemeStore {
  mode: ThemeMode;
  pointTone: PointTone;
  pointAccent: string;                     // 포인트 자동 기준색 (변경 시에만 재파생)
  perMode: Record<ThemeMode, ThemeVars>;   // 각 모드의 수정본 — 탭을 바꿔도 유지
  /** UFO 스킨 덧씌움 (v2.0) — 라이트·다크·포인트 모드에서 디자인 탭으로 고친 값. 명암별로 따로 둔다.
   *  스킨 팔레트(LIGHT_THEME/DARK_THEME) 위에 얹히고, 모드는 커스텀으로 넘어가지 않는다 */
  skin?: { light?: Partial<ThemeVars>; dark?: Partial<ThemeVars> };
}

/** 모드별 초기값 (선택 리셋용) */
export function defaultVarsFor(mode: ThemeMode, accent: string, tone: PointTone): ThemeVars {
  switch (mode) {
    case 'light': return LIGHT_THEME;
    case 'dark': return DARK_THEME;
    case 'point': return derivePointTheme(accent, tone);
    case 'custom': return DARK_THEME; // 커스텀 초기 상태 = 기본(다크)
  }
}

export const DEFAULT_THEME_STORE: ThemeStore = {
  mode: 'dark', pointTone: 'dark', pointAccent: '#a63a45',
  perMode: {
    light: LIGHT_THEME,
    dark: DARK_THEME,
    point: derivePointTheme('#a63a45', 'dark'),
    custom: DARK_THEME,
  },
};

/** 저장해 둔 테마 프리셋 (v1.9 — 드롭다운에서 커스텀으로 적용) */
export interface ThemePreset { id: string; name: string; vars: ThemeVars }

/** ThemeVars → CSS 변수 매핑 (globals.css 의 var() 이름과 1:1) */
export function themeToCssVars(t: ThemeVars): Record<string, string> {
  // 블록 그림자 — 세기 %에 따라 알파 스케일 (0 = none) · 색은 shColor (기본 검정)
  const hex = (t.shColor ?? '#000000').replace('#', '');
  const hf = hex.length === 3 ? hex.split('').map(ch => ch + ch).join('') : hex;
  const rgb = `${parseInt(hf.slice(0, 2), 16) || 0},${parseInt(hf.slice(2, 4), 16) || 0},${parseInt(hf.slice(4, 6), 16) || 0}`;
  const k = Math.max(0, Math.min(200, t.shadow ?? 100)) / 100;
  const sh = (y: number, blur: number, alpha: number) =>
    k === 0 ? 'none' : `0 ${y}px ${blur}px rgba(${rgb},${Math.min(1, alpha * k).toFixed(3)})`;
  // 드롭다운 그림자 — 별도 세기 (기본 100%)
  const kd = Math.max(0, Math.min(200, t.ddShadow ?? 100)) / 100;
  // 카드 글씨 — 보조(sub)·옅은(faint) 색은 지정한 글씨색의 명도에서 자동 파생 (v1.9)
  const cardFg = t.cardFg ?? '#1d2025';
  const fgDark = hexToHsl(cardFg).l < 0.5;
  const cardSub = adjust(cardFg, cc => ({ l: fgDark ? Math.min(0.85, cc.l + 0.25) : Math.max(0.15, cc.l - 0.22) }));
  const cardFaint = adjust(cardFg, cc => ({ l: fgDark ? Math.min(0.92, cc.l + 0.45) : Math.max(0.3, cc.l - 0.38), s: cc.s * 0.6 }));
  // 입력 포커스 (v1.9) — 미지정이면 포인트색 기반 글로우 3px
  const focusC = t.focusColor ?? t.accent;
  const focusRing = t.focusRing ?? 'glow';
  const focusW = Math.max(0, Math.min(6, t.focusW ?? 3));
  return {
    '--bg-angle': `${t.bgAngle ?? 180}deg`,
    '--bg-blur': `${Math.max(0, t.bgBlur ?? 0)}px`,
    '--panel-solid': t.cardBg ?? '#fbfbfc',
    '--panel': withAlpha(t.cardBg ?? '#fcfcfd', 0.94),
    '--ink': cardFg, '--sub': cardSub, '--faint': cardFaint,
    '--sh-sm': sh(8, 26, 0.22),   // 작은 카드
    '--sh-md': sh(10, 40, 0.25),  // 패널·배너
    '--sh-lg': sh(24, 70, 0.5),   // 모달
    '--sh-dd': kd === 0 ? 'none' : `0 14px 40px rgba(${rgb},${Math.min(1, 0.5 * kd).toFixed(3)})`,
    '--bg-g1': t.bgG1, '--bg-g2': t.bgG2,
    '--top-bg': withAlpha(t.topBg, 0.84), '--top-fg': t.topFg, '--top-hv': t.topHv, '--top-brand': t.topBrand,
    '--dd-bg': withAlpha(t.ddBg, 0.97), '--dd-fg': t.ddFg, '--dd-hv': withAlpha(t.ddHv, 0.09),
    '--page-title': t.pageTitle, '--page-desc': t.pageDesc,
    // 페이지 헤더 표시 옵션 (v1.9) — 모바일 생략은 CSS 미디어쿼리가 --ph-m을 보고 처리
    '--ph-title': (t.pageHead ?? 'both') === 'both' || t.pageHead === 'title' ? 'block' : 'none',
    '--ph-desc': (t.pageHead ?? 'both') === 'both' || t.pageHead === 'desc' ? 'block' : 'none',
    '--ph-title-m': (t.pageHeadM ?? 'same') === 'none' ? 'none'
      : ((t.pageHead ?? 'both') === 'both' || t.pageHead === 'title' ? 'block' : 'none'),
    '--ph-desc-m': (t.pageHeadM ?? 'same') === 'none' ? 'none'
      : ((t.pageHead ?? 'both') === 'both' || t.pageHead === 'desc' ? 'block' : 'none'),
    '--bgm-bg': withAlpha(t.bgmBg, 0.9), '--bgm-fg': t.bgmFg, '--bgm-ic': t.bgmIc, '--bgm-vol': t.bgmVol,
    '--sb-thumb': t.sbThumb, '--sb-bd': t.sbBd,
    '--search-bg': t.searchBg ?? '#232830', '--search-fg': t.searchFg ?? '#e8eaee',
    '--search-ic': t.searchIc ?? '#8b919b', '--search-bd': t.searchBd ?? '#3a404a',
    '--accent': t.accent, '--accent-soft': t.accentSoft,
    // 진한 버튼 3색 — 호버 미지정 시 배경에서 살짝 밝게 자동 파생
    '--btn-dark': t.btnDark ?? '#1d2025',
    '--btn-dark-fg': t.btnDarkFg ?? '#ffffff',
    '--btn-dark-hv': t.btnDarkHv ?? adjust(t.btnDark ?? '#1d2025', cc => ({ l: Math.min(1, cc.l + 0.07) })),
    // 스티커 메모 보드 (v1.9)
    '--memo-board': t.memoBoard ?? '#2a2f37',
    '--memo-board-bd': t.memoBoardBd ?? '#3a404b',
    // 이미지 편집(크롭) 배경 (v1.9)
    '--crop-bg': t.cropBg ?? '#2c313a',
    // 입력 포커스 (v1.9) — 테두리색 + 링(글로우: 반투명 번짐 / 라인: 선명한 테두리 / 없음)
    '--focus-bd': focusC,
    '--focus-ring': focusRing === 'none' || focusW === 0
      ? 'none'
      : focusRing === 'line'
        ? `0 0 0 ${focusW}px ${focusC}`
        : `0 0 0 ${focusW}px ${withAlpha(focusC, 0.16)}`,
    // 캐릭터 탭 리스트 (v1.9) — 배경·글씨·선택 배경·선택 글씨
    '--tab-bg': t.tabBg ?? '#3a4049',
    '--tab-fg': t.tabFg ?? '#aab0ba',
    '--tab-on-bg': t.tabOnBg ?? '#fbfbfc',
    '--tab-on-fg': t.tabOnFg ?? '#1d2025',
    // 스위치 탭 — 안 고른 쪽 (v2.0) · 고른 쪽은 --btn-dark 3색을 그대로 쓴다
    '--seg-bg': t.segBg ?? '#f0f1f3',
    '--seg-fg': t.segFg ?? '#8a8f98',
    // 위젯 (v2.0 사용자 요청) — 안 정하면 카드 색을 그대로 따라간다(지금까지의 모습).
    // 배경만 반투명 처리하는 것은 카드와 같은 규칙 — 배경 이미지를 깔았을 때 비쳐 보이게 한다
    '--wg-bg': t.wgBg ? withAlpha(t.wgBg, 0.94) : withAlpha(t.cardBg ?? '#fcfcfd', 0.94),
    '--wg-title': t.wgTitle ?? 'var(--faint)',
    '--wg-fg': t.wgFg ?? 'var(--ink)',
    // 테두리는 켤 때만 그린다 — 끄면 0이라 지금까지처럼 그림자만 남는다
    '--wg-bd-w': t.wgBorder ? '1px' : '0px',
    '--wg-bd': t.wgBd ?? 'var(--line)',
    '--radius': `${t.radius}px`, '--radius-s': `${t.radiusS}px`,
  };
}
