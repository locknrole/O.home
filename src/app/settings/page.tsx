'use client';
// 환경설정 (기획서 5장) — 0차: 「디자인」 탭(테마) 실동작.
// 나머지 카테고리는 해당 기능 마일스톤에서 함께 구현.
import { Suspense, useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useTheme } from '@/lib/ThemeProvider';
import { ConfirmModal } from '@/components/ui/Modal';
import { useSiteDraft } from '@/lib/siteStore';
import { useRouter, useSearchParams } from 'next/navigation';
import { useFonts } from '@/lib/fontStore';
import { PageTitle, EditableDesc } from '@/components/ui/PageText';
import dynamic from 'next/dynamic';

/* 탭은 고를 때 불러온다 (v2.1) — 3,400줄짜리 한 파일이라 어느 탭을 열든 전부(백업·이전 엔진, 규칙·스키마 문자열 포함)를
   내려받았다. 탭별 파일로 나눠 지금 보는 탭 코드만 받는다 */
const PaneLoading = () => <div className="set-sec"><div className="d">불러오는 중…</div></div>;
const DesignPane = dynamic(() => import('@/components/settings/panes/DesignPane').then(m => m.DesignPane), { loading: PaneLoading });
const MainPagePane = dynamic(() => import('@/components/settings/panes/MainPagePane').then(m => m.MainPagePane), { loading: PaneLoading });
const WidgetsPane = dynamic(() => import('@/components/settings/panes/WidgetsPane').then(m => m.WidgetsPane), { loading: PaneLoading });
const BoardPane = dynamic(() => import('@/components/settings/panes/BoardPane').then(m => m.BoardPane), { loading: PaneLoading });
const RelQPane = dynamic(() => import('@/components/settings/panes/RelQPane').then(m => m.RelQPane), { loading: PaneLoading });
const MemberPane = dynamic(() => import('@/components/settings/panes/MemberPane').then(m => m.MemberPane), { loading: PaneLoading });
const MoodPane = dynamic(() => import('@/components/settings/panes/MoodPane').then(m => m.MoodPane), { loading: PaneLoading });
const CursorPane = dynamic(() => import('@/components/settings/panes/CursorPane').then(m => m.CursorPane), { loading: PaneLoading });
const DataPane = dynamic(() => import('@/components/settings/panes/DataPane').then(m => m.DataPane), { loading: PaneLoading });
const MenuPane = dynamic(() => import('@/components/settings/panes/MenuPane').then(m => m.MenuPane), { loading: PaneLoading });
const TrpgPane = dynamic(() => import('@/components/settings/panes/TrpgPane').then(m => m.TrpgPane), { loading: PaneLoading });
const MemoPane = dynamic(() => import('@/components/settings/panes/MemoPane').then(m => m.MemoPane), { loading: PaneLoading });
const ThreadPane = dynamic(() => import('@/components/settings/panes/ThreadPane').then(m => m.ThreadPane), { loading: PaneLoading });
const CommPane = dynamic(() => import('@/components/settings/panes/CommPane').then(m => m.CommPane), { loading: PaneLoading });
const BgmPane = dynamic(() => import('@/components/settings/panes/BgmPane').then(m => m.BgmPane), { loading: PaneLoading });
const FontPane = dynamic(() => import('@/components/settings/panes/FontPane').then(m => m.FontPane), { loading: PaneLoading });

const CATEGORIES = [
  '디자인', '메인 페이지', '위젯', '메뉴 관리', '게시판 관리', '자관 질문', '커미션', 'TRPG', '감상타래', '메모장',
  '폰트', '마우스 커서', 'BGM', '무드 리스트', '회원/보안', '데이터 백업',
] as const;

function SettingsInner() {
  const { isAdmin } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const [tab, setTabState] = useState<(typeof CATEGORIES)[number]>('디자인');
  // 탭별 주소 (v1.9 사용자 요청) — /settings?tab=… : 뒤로가기로 이전 탭 복귀, 회원 상세에서 돌아오기 등
  const urlTab = params.get('tab');
  useEffect(() => {
    if (urlTab && (CATEGORIES as readonly string[]).includes(urlTab)) setTabState(urlTab as (typeof CATEGORIES)[number]);
    else if (!urlTab) setTabState('디자인');
  }, [urlTab]);
  const setTab = (t: (typeof CATEGORIES)[number]) => {
    setTabState(t);
    router.push(`/settings?tab=${encodeURIComponent(t)}`);
  };

  // 모바일에서는 환경설정 미제공 (v1.9 사용자 확정 — 수정할 정보량이 모바일에 맞지 않음)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(max-width:620px)');
    const f = () => setIsMobile(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);

  /* 미리보기는 이 페이지 안에서만 — SAVE 없이 벗어나면 저장본으로 원복 (v1.9).
     **색만 지키고 있었다** (v2.0 사용자 발견 — 「폰트 바꾸고 SAVE 안 했는데 화면 전환이 되고
     적용돼 있어」). 디자인 탭의 SAVE는 색·역할 폰트·로고/탭 제목 **셋**을 함께 저장하는데,
     이탈 경고와 원복은 색(useTheme)만 보고 있었다. 나머지 둘은 모듈·프로바이더에 사는
     드래프트라 페이지를 떠나도 사라지지 않아, 저장한 것처럼 계속 적용된 채로 남았다. */
  const { dirty: themeDirty, discard: themeDiscard, save: themeSave } = useTheme();
  const { rolesDirty, saveRoles, discardRoles } = useFonts();
  const siteDraft = useSiteDraft();
  const dirty = themeDirty || rolesDirty || siteDraft.dirty;
  const save = () => { themeSave(); saveRoles(); siteDraft.save(); };
  const discard = () => { themeDiscard(); discardRoles(); siteDraft.discard(); };
  const themeRef = useRef({ dirty, discard });
  themeRef.current = { dirty, discard };
  useEffect(() => () => { if (themeRef.current.dirty) themeRef.current.discard(); }, []);

  // 미저장 변경이 있을 때 상단바로 이동하려 하면 경고 (v1.9 — 캡처 단계에서 클릭 보류)
  const [leaveAsk, setLeaveAsk] = useState(false);
  const pendingClick = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onCapture = (e: MouseEvent) => {
      if (!themeRef.current.dirty) return;
      const t = e.target as HTMLElement | null;
      const hit = t?.closest?.('.topbar a, .topbar button, .topbar .brand') as HTMLElement | null;
      if (!hit) return;
      e.preventDefault();
      e.stopPropagation();
      pendingClick.current = hit;
      setLeaveAsk(true);
    };
    document.addEventListener('click', onCapture, true);
    return () => document.removeEventListener('click', onCapture, true);
  }, []);
  const leaveWith = (action: 'save' | 'discard') => {
    if (action === 'save') save(); else discard();
    setLeaveAsk(false);
    const el = pendingClick.current;
    pendingClick.current = null;
    // dirty 해제 후 보류했던 클릭 재실행 → 원래 목적지로 이동
    setTimeout(() => el?.click(), 30);
  };

  if (!isAdmin) {
    return (
      <section className="page">
        <div className="page-head"><PageTitle>SETTINGS</PageTitle><p>관리자 전용 페이지</p></div>
        <div className="panel" style={{ textAlign: 'center', padding: 56 }}>
          <p style={{ fontSize: 13, color: 'var(--faint)' }}>관리자로 로그인하면 환경설정을 사용할 수 있습니다.</p>
        </div>
      </section>
    );
  }
  if (isMobile) {
    return (
      <section className="page">
        <div className="page-head"><PageTitle>SETTINGS</PageTitle><p>PC 전용 페이지</p></div>
        <div className="panel" style={{ textAlign: 'center', padding: 56 }}>
          <p style={{ fontSize: 13, color: 'var(--faint)' }}>환경설정은 PC 화면에서 이용할 수 있습니다.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <div className="page-head">
        <PageTitle>SETTINGS</PageTitle>
        {/* 관리자 클릭 수정 가능 (v1.9 — 다른 페이지 설명과 동일) */}
        <EditableDesc k="settings-desc" def="노코드 커스터마이징 — 모든 컨트롤은 자체 UI 킷 (기본 브라우저 UI 미사용)" />
      </div>

      {/* 미저장 테마 변경 이탈 경고 (v1.9) */}
      <ConfirmModal open={leaveAsk} title="테마가 저장되지 않았습니다"
        body="이대로 이동하면 미리보기 중인 변경사항이 사라지고 저장된 테마로 돌아갑니다."
        onClose={() => { pendingClick.current = null; setLeaveAsk(false); }}
        buttons={[
          { label: '저장 후 이동', kind: 'dark', onClick: () => leaveWith('save') },
          { label: '저장하지 않고 이동', kind: 'ghost', onClick: () => leaveWith('discard') },
          { label: 'CANCEL', kind: 'ghost', onClick: () => { pendingClick.current = null; setLeaveAsk(false); } },
        ]} />
      <div className="settings-layout">
        <div className="panel set-nav">
          {CATEGORIES.map(c => (
            <button key={c} className={tab === c ? 'on' : ''} onClick={() => setTab(c)}>{c}</button>
          ))}
        </div>
        <div className="panel" style={{ padding: 26 }}>
          {tab === '디자인' ? (
            <DesignPane />
          ) : tab === '메인 페이지' ? (
            <MainPagePane />
          ) : tab === '위젯' ? (
            <WidgetsPane />
          ) : tab === '메뉴 관리' ? (
            <MenuPane />
          ) : tab === '게시판 관리' ? (
            <BoardPane />
          ) : tab === '자관 질문' ? (
            <RelQPane />
          ) : tab === '커미션' ? (
            <CommPane />
          ) : tab === 'TRPG' ? (
            <TrpgPane />
          ) : tab === '감상타래' ? (
            <ThreadPane />
          ) : tab === '메모장' ? (
            <MemoPane />
          ) : tab === '무드 리스트' ? (
            <MoodPane />
          ) : tab === 'BGM' ? (
            <BgmPane />
          ) : tab === '폰트' ? (
            <FontPane />
          ) : tab === '마우스 커서' ? (
            <CursorPane />
          ) : tab === '회원/보안' ? (
            <MemberPane />
          ) : tab === '데이터 백업' ? (
            <DataPane />
          ) : (
            <div className="set-sec">
              <h3>{tab}</h3>
              {/* (v1.9) 개발 마일스톤 문구 제거 — 배포본에는 노출하지 않음 */}
              <div className="d">설정 항목이 없습니다</div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

export default function SettingsPage() {
  // useSearchParams는 Suspense 경계 필요 (Next App Router) — 탭별 주소 (v1.9)
  return <Suspense fallback={<section className="page" />}><SettingsInner /></Suspense>;
}
