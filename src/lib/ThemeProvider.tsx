'use client';
// 테마 컨텍스트 (5.1, v1.9 개정) — 모드별 독립 설정값 + 드래프트/저장 분리 + 프리셋
// · 모드 전환은 각 모드의 수정본을 불러올 뿐 리셋하지 않음
// · 포인트 자동은 기준색/톤을 "변경했을 때만" 전체 재파생
// · 변경은 즉시 미리보기(DOM)되지만 저장은 [SAVE]를 눌러야 확정 — 새로고침 시 저장본으로 복귀
// TODO(0차→): Supabase 연결 시 site_settings 테이블로 저장 위치 이동
import React, { createContext, useContext, useEffect, useLayoutEffect, useMemo, useState, useCallback } from 'react';
import {
  ThemeMode, PointTone, ThemeVars, ThemeState, ThemeStore, ThemePreset,
  DARK_THEME, LIGHT_THEME, DEFAULT_THEME_STORE, defaultVarsFor, derivePointTheme, themeToCssVars,
} from './theme';
import { newId } from './postStore';
import { getBlob } from './blobStore';
import { getRawSetting, setSetting } from './settingStore';

/** 페이지 배경 그라데이션 (자관별 지정, v2.0) — 색 2개 + 각도 */
export interface PageBg { g1: string; g2: string; angle: number }

interface ThemeCtx {
  /** 페이지 임시 테마 (자관·커미션 페이지 테마컬러) — 벗어나면 null로 원복, 저장되지 않음 */
  setPageTheme: (color: string | null, tone?: PointTone) => void;
  /** 페이지 배경만 따로 (v2.0 사용자 요청 — 자관별 배경 그라데이션).
   *  테마컬러(setPageTheme)가 팔레트 전체를 바꾸는 것과 달리 배경 두 색·각도만 덮어쓴다. */
  setPageBg: (bg: PageBg | null) => void;
  /** 현재(드래프트) 상태 — 기존 소비자 호환 형태 {mode, pointTone, vars} */
  state: ThemeState;
  dirty: boolean;                              // 저장 안 된 변경 존재
  setMode: (m: ThemeMode) => void;             // 모드 전환 — 그 모드의 수정본 로드 (리셋 아님)
  setPointAccent: (hex: string) => void;       // 포인트 자동: 변경 시에만 재파생
  setPointTone: (t: PointTone) => void;
  setVar: <K extends keyof ThemeVars>(key: K, value: ThemeVars[K]) => void; // 현재 모드의 수정본에 반영
  resetMode: (m: ThemeMode) => void;           // 선택 리셋 — 해당 모드만 초기값으로
  save: () => void;                            // 드래프트 → 실제 저장 (localStorage + FOUC 맵)
  discard: () => void;                         // 드래프트 폐기 → 저장본으로 복귀
  presets: ThemePreset[];
  savePreset: (name: string) => void;          // 현재 모드의 드래프트 값을 프리셋으로 저장 (즉시 저장)
  applyPreset: (id: string) => void;           // 프리셋 → 커스텀 모드에 적용 (드래프트)
  removePreset: (id: string) => void;
  /** 방문자가 보는 명암 (UFO 스킨) — 커스텀 모드면 null(관리자 색 그대로, 토글 없음) */
  scheme: Scheme | null;
  /** 방문자 라이트/다크 전환 — 이 기기에만 저장 (사이트 설정은 그대로) */
  toggleScheme: () => void;
}

export type Scheme = 'light' | 'dark';

const Ctx = createContext<ThemeCtx | null>(null);
const STORAGE_KEY = 'ohome.theme.v2';
const LEGACY_KEY = 'ohome.theme.v1';
/** 첫 페인트 전에 적용할 CSS 변수 맵 (layout.tsx 인라인 스크립트가 읽음 — FOUC 방지) */
const CSS_KEY = 'ohome.themeCss.v1';
const PRESET_KEY = 'ohome.themePresets.v1';
/** 방문자 명암 선택 · 그 명암으로 칠한 CSS 맵 — 사람마다 다른 값이라 서버 설정이 아닌 이 기기 localStorage에만 둔다.
 *  layout.tsx 인라인 스크립트가 첫 페인트 전에 SCHEME_CSS_KEY를 먼저 읽는다 */
const SCHEME_KEY = 'ohome.scheme.v1';
const SCHEME_CSS_KEY = 'ohome.schemeCss.v1';

/* 라이트·다크는 고칠 수 없는 프리셋이다 — 스킨에서 고친 값은 perMode가 아니라 skin 덧씌움에 들어간다(setVar).
   그래서 저장본의 perMode.light/dark는 「저장하던 때의 기본값」일 뿐이라, 늘 현재 프리셋을 쓴다
   (안 그러면 스킨을 바꿔도 예전에 저장한 사이트는 예전 색에 머문다) */
const normalize = (s: Partial<ThemeStore> | null | undefined): ThemeStore => ({
  ...DEFAULT_THEME_STORE,
  ...(s ?? {}),
  perMode: {
    light: DEFAULT_THEME_STORE.perMode.light,
    dark: DEFAULT_THEME_STORE.perMode.dark,
    point: { ...DEFAULT_THEME_STORE.perMode.point, ...(s?.perMode?.point ?? {}) },
    custom: { ...DEFAULT_THEME_STORE.perMode.custom, ...(s?.perMode?.custom ?? {}) },
  },
});

/** 이 저장본이 방문자에게 보이는 명암 — 커스텀이면 null(관리자 색 그대로) */
const schemeOf = (d: ThemeStore, viewer: Scheme | null): Scheme | null =>
  d.mode === 'custom' ? null
    : viewer ?? (d.mode === 'light' ? 'light' : d.mode === 'dark' ? 'dark' : d.pointTone);

/** 스킨 모드에서 실제로 칠하는 값 — 스킨 팔레트 + (포인트 모드면 기준색) + 헤더 표시 옵션 + 디자인 탭 덧씌움.
 *  화면·환경설정 칸·FOUC 맵·프리셋 저장이 모두 이 값을 쓴다 — 보이는 색과 고치는 색이 어긋나지 않게
 *  (예전엔 칸에 포인트 모드의 옛 팔레트가 떠 있다가, 하나만 고쳐도 그 옛 팔레트가 커스텀으로 복사돼 색이 통째로 바뀌었다) */
function skinVars(d: ThemeStore, scheme: Scheme): ThemeVars {
  const preset = scheme === 'light' ? LIGHT_THEME : DARK_THEME;
  const site = d.perMode[d.mode];
  return {
    ...preset,
    ...(d.mode === 'point' ? { accent: d.pointAccent, accentSoft: derivePointTheme(d.pointAccent, scheme).accentSoft } : {}),
    pageHead: site.pageHead, pageHeadM: site.pageHeadM,
    ...(d.skin?.[scheme] ?? {}),
  };
}

function applyToDom(vars: ThemeVars) {
  const css = themeToCssVars(vars);
  const root = document.documentElement;
  for (const [k, v] of Object.entries(css)) root.style.setProperty(k, v);
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [saved, setSaved] = useState<ThemeStore>(DEFAULT_THEME_STORE);
  const [draft, setDraft] = useState<ThemeStore>(DEFAULT_THEME_STORE);
  const [presets, setPresets] = useState<ThemePreset[]>([]);
  const [pageColor, setPageColor] = useState<{ color: string; tone?: PointTone } | null>(null);
  const [pageBg, setPageBgState] = useState<PageBg | null>(null);   // 자관별 배경 (v2.0)
  const [loaded, setLoaded] = useState(false);   // 저장본 로드 전 기본 다크를 DOM에 쓰지 않기 (FOUC 방지)
  const [viewerScheme, setViewerScheme] = useState<Scheme | null>(null);   // 방문자가 직접 고른 명암 (없으면 사이트 기본)

  // 방문자 명암 — 커스텀 모드는 관리자가 손수 정한 색이라 건드리지 않는다
  const scheme: Scheme | null = schemeOf(draft, viewerScheme);
  // 지금 보이는 값 (스킨이면 스킨 팔레트 + 덧씌움, 커스텀이면 관리자 값)
  const shown: ThemeVars = useMemo(() => (scheme ? skinVars(draft, scheme) : draft.perMode[draft.mode]), [draft, scheme]);
  const toggleScheme = useCallback(() => {
    const next: Scheme = scheme === 'dark' ? 'light' : 'dark';
    setViewerScheme(next);
    try { localStorage.setItem(SCHEME_KEY, next); } catch { /* 무시 */ }
  }, [scheme]);

  // 최초 로드 — v2 우선, 없으면 v1 마이그레이션 (기존 vars를 해당 모드의 수정본으로 승계)
  useEffect(() => {
    try {
      const raw = getRawSetting(STORAGE_KEY);
      if (raw) {
        const st = normalize(JSON.parse(raw));
        setSaved(st); setDraft(st);
        try { setSetting(CSS_KEY, themeToCssVars(st.perMode[st.mode])); } catch { /* 무시 */ }
      } else {
        const legacy = getRawSetting(LEGACY_KEY);
        if (legacy) {
          const old = JSON.parse(legacy) as { mode?: ThemeMode; pointTone?: PointTone; vars?: ThemeVars };
          const mode = old.mode ?? 'dark';
          const vars = { ...DARK_THEME, ...(old.vars ?? {}) };
          const st = normalize({
            mode, pointTone: old.pointTone ?? 'dark', pointAccent: vars.accent,
            perMode: { ...DEFAULT_THEME_STORE.perMode, [mode]: vars },
          });
          setSaved(st); setDraft(st);
          try {
            setSetting(STORAGE_KEY, st);
            setSetting(CSS_KEY, themeToCssVars(st.perMode[st.mode]));
          } catch { /* 무시 */ }
        }
      }
      const pr = getRawSetting(PRESET_KEY);
      if (pr) setPresets(JSON.parse(pr));
      const vs = localStorage.getItem(SCHEME_KEY);
      if (vs === 'light' || vs === 'dark') setViewerScheme(vs);
    } catch { /* 무시하고 기본 테마 */ }
    setLoaded(true);
  }, []);

  // 드래프트 변경 시 DOM 즉시 반영 (미리보기) — 저장은 save()에서만.
  // 로드 전에는 건드리지 않음 — 첫 페인트의 인라인 FOUC 맵을 기본 다크로 덮어써 깜빡이는 것 방지 (v1.9)
  // layout effect — 명암 전환 연출(SchemeFx)이 flushSync 안에서 바뀐 색을 바로 찍을 수 있게 렌더 직후 동기로 칠한다
  useLayoutEffect(() => {
    if (!loaded) return;
    /* 캐릭터·자관 테마컬러는 색만 바꾸는 것 — 파생 팔레트가 ThemeVars를 통째로 새로 만들어
       **표시 옵션까지 기본값으로 리셋**되던 것을 사이트 설정에서 이어받는다 (v2.0 사용자 제보 —
       「헤더 설명을 껐는데 커스텀 테마 캐릭터 상세에서만 다시 보인다」) */
    const site = draft.perMode[draft.mode];
    const root = document.documentElement;
    if (scheme) {
      /* UFO 스킨 — 라이트·다크·포인트 모드는 방문자가 고른 명암의 스킨 팔레트(+ 디자인 탭 덧씌움)로 칠한다.
         캐릭터·자관 테마컬러는 팔레트를 통째로 바꾸지 않고 포인트색만 바꾼다
         (먹색/흰 한 장 바탕이 페이지마다 뒤집히지 않게) */
      const siteVars = shown;
      applyToDom(pageColor
        ? { ...siteVars, accent: pageColor.color, accentSoft: derivePointTheme(pageColor.color, scheme).accentSoft }
        : siteVars);
      root.dataset.scheme = scheme;
      try { localStorage.setItem(SCHEME_CSS_KEY, JSON.stringify({ scheme, css: themeToCssVars(siteVars) })); } catch { /* 무시 */ }
    } else {
      applyToDom(pageColor
        ? {
          ...derivePointTheme(pageColor.color, pageColor.tone ?? draft.pointTone),
          pageHead: site.pageHead, pageHeadM: site.pageHeadM,
        }
        : site);
      root.dataset.scheme = 'custom';
      try { localStorage.removeItem(SCHEME_CSS_KEY); } catch { /* 무시 */ }
    }
    // 페이지 배경 지정 (v2.0) — 팔레트를 적용한 뒤에 배경 세 값만 덮어쓴다.
    // 이 effect가 팔레트를 다시 칠하므로 순서상 여기서 덮어야 남는다.
    if (pageBg) {
      root.style.setProperty('--bg-g1', pageBg.g1);
      root.style.setProperty('--bg-g2', pageBg.g2);
      root.style.setProperty('--bg-angle', `${pageBg.angle}deg`);
      root.style.setProperty('--bg-image', 'none');   // 사이트 배경 이미지가 덮지 않게
    }
  }, [draft, pageColor, pageBg, loaded, scheme, shown]);

  // 배경 이미지 (v1.9) — IndexedDB 파일을 blob URL로 풀어 --bg-image 적용 (그라데이션 모드면 해제)
  useEffect(() => {
    if (!loaded) return;
    const vars = shown;
    const root = document.documentElement;
    if (vars.bgType === 'image' && vars.bgImageId && !pageColor && !pageBg) {
      const ref = vars.bgImageId;
      /* **주소면 그대로 쓴다** (v2.0 사용자 발견 — 「배경에 사진을 올렸는데 안 바뀐다」).
         서버 모드에서는 올린 이미지가 저장소의 공개 주소로 저장되는데, 여기서만 그것을
         `getBlob`으로 **다시 내려받아** blob 주소로 바꾸고 있었다. 그 fetch는 저장소의
         CORS 설정에 걸리면 조용히 실패한다 — 화면 어디에도 오류가 안 뜨고 배경만 안 바뀐다.
         다른 이미지들은 전부 주소를 그대로 쓰므로(useBlobUrl) 잘 나왔다. 여기만 예외였다. */
      if (/^(https?:|data:|blob:)/.test(ref)) {
        root.style.setProperty('--bg-image', `url("${ref}")`);
        return () => { root.style.removeProperty('--bg-image'); };
      }
      // 브라우저 저장(IndexedDB) 파일 id — 그때만 풀어서 blob 주소를 만든다
      let cancelled = false;
      let url: string | null = null;
      getBlob(ref).then(b => {
        if (cancelled || !b) return;
        url = URL.createObjectURL(b);
        root.style.setProperty('--bg-image', `url("${url}")`);
      });
      return () => {
        cancelled = true;
        root.style.removeProperty('--bg-image');
        if (url) URL.revokeObjectURL(url);
      };
    }
    root.style.removeProperty('--bg-image');
  }, [shown, pageColor, pageBg, loaded]);

  const dirty = useMemo(() => JSON.stringify(saved) !== JSON.stringify(draft), [saved, draft]);

  const setMode = useCallback((mode: ThemeMode) =>
    setDraft(d => ({ ...d, mode })), []);

  const setPointAccent = useCallback((hex: string) =>
    setDraft(d => ({
      ...d, mode: 'point', pointAccent: hex,
      perMode: { ...d.perMode, point: derivePointTheme(hex, d.pointTone) },
    })), []);

  const setPointTone = useCallback((tone: PointTone) =>
    setDraft(d => ({
      ...d, mode: 'point', pointTone: tone,
      perMode: { ...d.perMode, point: derivePointTheme(d.pointAccent, tone) },
    })), []);

  // 세부 수정 — 커스텀 모드는 그 값에 그대로 반영.
  // 스킨 모드(라이트/다크/포인트)는 커스텀으로 넘기지 않고, 지금 보고 있는 명암의 덧씌움(skin)에 넣는다 (v2.0 —
  // 예전 방식대로 커스텀으로 복사하면 스킨이 아닌 옛 팔레트가 복사돼 색이 통째로 날아가고 명암 버튼도 사라졌다).
  // 저장은 SAVE에서.
  const setVar = useCallback(<K extends keyof ThemeVars>(key: K, value: ThemeVars[K]) =>
    setDraft(d => {
      const sc = schemeOf(d, viewerScheme);
      if (!sc) return { ...d, perMode: { ...d.perMode, custom: { ...d.perMode.custom, [key]: value } } };
      return { ...d, skin: { ...d.skin, [sc]: { ...(d.skin?.[sc] ?? {}), [key]: value } } };
    }), [viewerScheme]);

  // 선택 리셋 — 지정한 모드만 초기값으로 (드래프트, 저장은 SAVE에서).
  // 스킨 덧씌움도 함께 비운다: 라이트→라이트 덧씌움, 다크→다크 덧씌움, 포인트→둘 다
  const resetMode = useCallback((m: ThemeMode) =>
    setDraft(d => ({
      ...d,
      perMode: { ...d.perMode, [m]: defaultVarsFor(m, d.pointAccent, d.pointTone) },
      skin: m === 'custom' ? d.skin
        : m === 'point' ? {}
          : { ...d.skin, [m]: undefined },
    })), []);

  const save = useCallback(() => {
    setDraft(d => {
      setSaved(d);
      try {
        setSetting(STORAGE_KEY, d);
        const sc = schemeOf(d, viewerScheme);
        setSetting(CSS_KEY, themeToCssVars(sc ? skinVars(d, sc) : d.perMode[d.mode])); // FOUC 맵 동기화 — 보이는 값으로
      } catch { /* quota 등 무시 */ }
      return d;
    });
  }, [viewerScheme]);

  const discard = useCallback(() => setDraft(saved), [saved]);

  // 프리셋 — 즉시 저장 (드래프트와 무관한 별도 보관함)
  const persistPresets = (list: ThemePreset[]) => {
    setPresets(list);
    try { setSetting(PRESET_KEY, list); } catch { /* 무시 */ }
  };
  const savePreset = useCallback((name: string) => {
    setDraft(d => {
      const sc = schemeOf(d, viewerScheme);
      persistPresets([...presets, { id: newId(), name, vars: sc ? skinVars(d, sc) : d.perMode[d.mode] }]);   // 보이는 값으로
      return d;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [presets, viewerScheme]);
  const applyPreset = useCallback((id: string) => {
    const p = presets.find(x => x.id === id);
    if (!p) return;
    setDraft(d => ({ ...d, mode: 'custom', perMode: { ...d.perMode, custom: { ...p.vars } } }));
  }, [presets]);
  const removePreset = useCallback((id: string) =>
    persistPresets(presets.filter(p => p.id !== id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [presets]);

  const setPageTheme = useCallback((color: string | null, tone?: PointTone) =>
    setPageColor(color ? { color, tone } : null), []);
  const setPageBg = useCallback((bg: PageBg | null) => setPageBgState(bg), []);

  // 기존 소비자 호환 — state.vars = 지금 보이는 값 (환경설정 칸이 화면과 같은 색을 띄우게)
  const state: ThemeState = useMemo(() => ({
    mode: draft.mode, pointTone: draft.pointTone, vars: shown,
  }), [draft, shown]);

  return (
    <Ctx.Provider value={{
      state, dirty, setMode, setPointAccent, setPointTone, setVar,
      resetMode, save, discard, presets, savePreset, applyPreset, removePreset, setPageTheme, setPageBg,
      scheme, toggleScheme,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export function useTheme(): ThemeCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
