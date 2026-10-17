'use client';
// 상단 바 — 기획서 3장(계층 메뉴) + 4.0(프로필 드롭다운 · 편집모드 · 그리드 토글)
// 로고 클릭 = 메인 이동 (v1.5) · 상위 메뉴 클릭 = 첫 하위 페이지 이동 (v1.8)
// 편집모드 중 페이지 이동 시도 → 종료 확인 모달 (v1.8)
import React, { Suspense, useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { boardEntries, useMenuSettings, buildMenu } from '@/lib/menuStore';
import { useBoards } from '@/lib/boardStore';
import { useSections, sectionMenuEntries } from '@/lib/sectionStore';
import { useCustomLinks, linkEntries } from '@/lib/linkStore';
import { useSiteSettings } from '@/lib/siteStore';
import { useAuth } from '@/lib/auth';
import { useMainStore } from '@/lib/mainStore';
import { useBlobUrl } from '@/lib/blobStore';
import { refreshPage } from '@/lib/pageRefresh';
import { useToast } from '@/components/ui/Toast';
import { KToggle } from '@/components/ui/Kit';
import { useTheme } from '@/lib/ThemeProvider';
import { playSchemeSwitch } from '@/components/shell/SchemeFx';
import { G1Banner } from '@/components/shell/G1Banner';
import {
  Notif, NotifType, NOTIF_EVENT, NOTIF_TYPE_LABEL,
  readNotifs, markRead, markAllRead, clearReadNotifs, notifSettings, setNotifSetting, syncNotifs, selfTestNotif,
} from '@/lib/notifStore';
import { subscribeTable } from '@/lib/db';

/* UFO 스킨 — 로고 옆 작은 장식. 라이트는 UFO, 다크는 외계인 (skin.css가 data-scheme으로 하나만 보인다) */
const BrandIcon = () => (
  <span className="brand-ico" aria-hidden>
    <svg className="ufo" viewBox="0 0 24 24"><path d="M8 11a4 4 0 0 1 8 0" /><ellipse cx="12" cy="12.5" rx="9" ry="2.6" /><path d="M9 16.5 7.5 20M15 16.5l1.5 3.5" /></svg>
    <svg className="alien" viewBox="0 0 24 24"><path d="M9 6 7 3M15 6l2-3" /><path d="M12 5c-4.4 0-7 2.8-7 6.2 0 4 3.6 7.4 7 8.8 3.4-1.4 7-4.8 7-8.8C19 7.8 16.4 5 12 5z" /><path d="M8.6 11.2c1.2.2 2 1 2.2 2.3M15.4 11.2c-1.2.2-2 1-2.2 2.3" /></svg>
  </span>
);

const MoonIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" /></svg>
);
const SunIcon = () => (
  <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="4" /><path d="M12 2.5v1.5M12 20v1.5M5.3 5.3l1 1M17.7 17.7l1 1M2.5 12H4M20 12h1.5M5.3 18.7l1-1M17.7 6.3l1-1" /></svg>
);

const ListIcon = () => (
  <svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10" /></svg>
);

const BellIcon = () => (
  <svg viewBox="0 0 24 24">
    <path d="M6 9.5a6 6 0 0 1 12 0c0 4.2 1.6 5.6 2.2 6.3H3.8C4.4 15.1 6 13.7 6 9.5Z" />
    <path d="M10 18.8a2.1 2.1 0 0 0 4 0" />
  </svg>
);

export function TopBar() {
  const { user, isAdmin, logout } = useAuth();
  const { editOn, editAvailable, gridOn, setGridOn, toggleEdit, requestExit, guardNav } = useMainStore();
  const router = useRouter();
  const pathname = usePathname();
  const toast = useToast();
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  // 모바일 카테고리 목록 (v2.0 사용자 요청 — 「메인 말고는 모바일에서 메뉴를 볼 수가 없다」).
  // 모바일·태블릿에서만 명암 버튼 옆에 버튼이 보이고(skin.css), 누르면 상단 바 아래로 목록이 펼쳐진다
  const [catOpen, setCatOpen] = useState(false);
  const catRef = useRef<HTMLDivElement>(null);
  const [menuSet, , menuLoaded] = useMenuSettings(); // 메뉴 관리 (5.2) — 노출·순서·이름
  const { boards, loaded: boardsLoaded } = useBoards(); // 다중 게시판 (5.2) — 게시판 그룹에 동적 반영
  const { map: secMap } = useSections();
  const { links } = useCustomLinks();                    // 커스텀 링크 (v2.0 사용자 요청)                 // 여러 개로 만든 섹션 (v2.0) — 갤러리·다이어리 등
  // 저장 설정 로드 전에는 메뉴·로고를 그리지 않음 — 새로고침 시 기본 구성이 깜빡이는 것 방지 (v1.9)
  const ready = menuLoaded && boardsLoaded;
  const menu = ready
    ? buildMenu(menuSet, [...boardEntries(boards), ...sectionMenuEntries(secMap), ...linkEntries(links)], { loggedIn: !!user, isAdmin, id: user?.id })
    : [];
  const [site, , siteLoaded] = useSiteSettings();    // 로고 텍스트/서브/정렬 (5.2)
  const avatarSrc = useBlobUrl(user?.avatarUrl);     // 프로필 이미지 (마이페이지, v1.9)
  const userRef = useRef<HTMLDivElement>(null);
  const { scheme, toggleScheme } = useTheme();       // 방문자 라이트/다크 (UFO 스킨)

  useEffect(() => {
    if (!catOpen) return;
    const close = (e: MouseEvent) => { if (!catRef.current?.contains(e.target as Node)) setCatOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [catOpen]);
  useEffect(() => { setCatOpen(false); }, [pathname]);   // 다른 페이지로 가면 닫는다

  useEffect(() => {
    if (!menuOpen && !notifOpen) return;
    const close = (e: MouseEvent) => {
      if (!userRef.current?.contains(e.target as Node)) { setMenuOpen(false); setNotifOpen(false); }
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [menuOpen, notifOpen]);

  // 알림 (4.13) — 발생 지점의 커스텀 이벤트로 갱신
  const [notifs, setNotifs] = useState<Notif[]>([]);
  const [notifVer, setNotifVer] = useState(0); // 설정 토글 리렌더용
  useEffect(() => {
    const load = () => { setNotifs(readNotifs()); setNotifVer(v => v + 1); };
    load();
    window.addEventListener(NOTIF_EVENT, load);
    window.addEventListener('storage', load); // 다른 탭
    return () => { window.removeEventListener(NOTIF_EVENT, load); window.removeEventListener('storage', load); };
  }, []);
  /* 서버에 쌓인 내 알림 받아 오기 (v2.0 포크 제보 — 기기 보관이라 남이 남긴 알림이 안 왔다).
     접속할 때 한 번 + 실시간 신호(새 행) + 창에 돌아올 때(30초 간격 제한은 syncNotifs가 건다) */
  useEffect(() => {
    if (!user) return;
    void syncNotifs(user.id, true);
    const off = subscribeTable('notifications', () => void syncNotifs(user.id, true));
    const onFocus = () => void syncNotifs(user.id);
    window.addEventListener('focus', onFocus);
    return () => { off(); window.removeEventListener('focus', onFocus); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);
  const myNotifs = user ? notifs.filter(n => n.toUserId === user.id) : [];
  const unread = myNotifs.filter(n => !n.read);
  // 메뉴 점 — 안 읽은 알림이 가리키는 페이지 (해당 메뉴 뱃지, 4.13)
  const dotHrefs = new Set(unread.map(n => n.href));
  const fmtNd = (iso: string) => {
    const d = new Date(iso);
    return `${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  };
  const mySet = user ? notifSettings(user.id) : null;
  void notifVer;

  // 편집모드 중에는 이동 전에 종료 확인 (v1.8)
  // 지금 보고 있는 메뉴를 다시 누르면 그 페이지를 새로 불러옴 — 다시 접속하는 느낌 (v1.9 사용자 요청)
  const nav = (href: string) => {
    // 커스텀 링크에 다른 사이트 풀주소를 걸 수 있다 (v2.0) — 외부는 새 창으로
    if (/^https?:\/\//.test(href)) { window.open(href, '_blank'); return; }
    if (guardNav(href)) return;
    // 같은 메뉴 재클릭 — 브라우저 새로고침 대신 페이지만 처음 상태로 다시 그림 (BGM이 끊기지 않게, v1.9).
    // **쿼리까지 비교해야 한다** (v2.0 사용자 문의로 발견) — 경로만 보면 /board?b=2 에서 /board 를
    // 눌렀을 때 '같은 메뉴'로 착각해 이동이 통째로 막힌다. 여러 개로 만든 게시판·갤러리·다이어리가
    // 전부 같은 경로에 쿼리로 갈리므로, 기본 항목으로 돌아갈 수가 없었다.
    const cur = pathname + window.location.search;
    if (href === cur) { refreshPage(); return; }
    router.push(href);
  };

  // 상위 메뉴 개수 무제한 (v1.9) — 바 폭을 넘치는 항목은 「⋯」 드롭다운으로 자동 이동 (priority+)
  const gnbRef = useRef<HTMLElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visCount, setVisCount] = useState(menu.length);
  const menuKey = menu.map(m => m.label).join('|');
  useEffect(() => {
    const gnbEl = gnbRef.current, mEl = measureRef.current;
    if (!gnbEl || !mEl) return;
    const GAP = 2;
    const compute = () => {
      const avail = gnbEl.clientWidth;
      const kids = Array.from(mEl.children) as HTMLElement[];
      // 세로 사이드바·가로 스크롤 줄(UFO 스킨)은 넘침이 없다 — 스킨 CSS가 --gnb-all:1로 알린다
      if (avail <= 0 || getComputedStyle(gnbEl).getPropertyValue('--gnb-all').trim() === '1') { // gnb 숨김(모바일)·미표시 상태 — 측정 불가 시 전체 표시
        setVisCount(kids.length - 1);
        return;
      }
      const moreW = kids[kids.length - 1]?.offsetWidth ?? 40;   // 마지막 = ⋯ 측정용
      const widths = kids.slice(0, -1).map(k => k.offsetWidth);
      const total = widths.reduce((a, w) => a + w, 0) + GAP * Math.max(0, widths.length - 1);
      let count = widths.length;
      if (total > avail) {
        const limit = avail - moreW - GAP;
        let used = 0; count = 0;
        for (const w of widths) {
          if (used + w > limit) break;
          used += w + GAP; count++;
        }
      }
      setVisCount(c => (c === count ? c : count));
    };
    compute();
    const ro = new ResizeObserver(compute);
    ro.observe(gnbEl); ro.observe(mEl);
    window.addEventListener('resize', compute);
    return () => { ro.disconnect(); window.removeEventListener('resize', compute); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menuKey]);
  const visMenu = menu.slice(0, visCount);
  const moreMenu = menu.slice(visCount);

  return (
    <header className="topbar">
      {/* 사이드바 상단 G1 배너 — 메뉴에 따라 장면이 바뀐다 (PC 사이드바에서만, skin.css) */}
      <Suspense fallback={null}><G1Banner /></Suspense>
      {/* 로고 — 텍스트·서브타이틀·정렬은 환경설정 > 디자인 (5.2) */}
      <div className="brand" onClick={() => nav('/')}>
        {/* 제목·소제목 숨김은 환경설정 > 디자인 「로고 표시」 (v2.0 사용자 요청) */}
        {siteLoaded && !site.hideTitle && <span className="brand-row"><BrandIcon />{site.title}</span>}
        {siteLoaded && !site.hideSubtitle && site.subtitle && <small className={`al-${site.align}`}>{site.subtitle}</small>}
      </div>

      <nav className="gnb" ref={gnbRef}>
        {visMenu.map(item =>
          item.children ? (
            <div className="grp" key={item.label}>
              {/* 상위 클릭 → 첫 하위 페이지 (v1.8) · 안 읽은 알림이 있는 메뉴에 점 (4.13) */}
              <button onClick={() => nav(item.children![0].href)}>
                {item.label}{item.children.some(c => dotHrefs.has(c.href)) && <small className="nd">●</small>}
              </button>
              <div className="sub">
                {item.children.map(c => (
                  <button key={c.href} onClick={() => nav(c.href)}>
                    {c.label}{dotHrefs.has(c.href) && <small className="nd">●</small>}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <button
              key={item.label}
              className={pathname === item.href ? 'on' : ''}
              onClick={() => nav(item.href!)}
            >
              {item.label}{dotHrefs.has(item.href!) && <small className="nd">●</small>}
            </button>
          )
        )}
        {/* 넘친 상위 메뉴 — ⋯ 드롭다운 (그룹은 캡션+하위, 단독은 바로 이동) */}
        {moreMenu.length > 0 && (
          <div className="grp more">
            <button aria-label="더보기">
              ⋯{moreMenu.some(m => (m.children ?? [{ href: m.href! }]).some(c => dotHrefs.has(c.href!))) && <small className="nd">●</small>}
            </button>
            <div className="sub">
              {moreMenu.map(item =>
                item.children ? (
                  <div className="sub-grp" key={item.label}>
                    <div className="sub-cap">{item.label}</div>
                    {item.children.map(c => (
                      <button key={c.href} onClick={() => nav(c.href)}>
                        {c.label}{dotHrefs.has(c.href) && <small className="nd">●</small>}
                      </button>
                    ))}
                  </div>
                ) : (
                  <button key={item.label} onClick={() => nav(item.href!)}>
                    {item.label}{dotHrefs.has(item.href!) && <small className="nd">●</small>}
                  </button>
                ))}
            </div>
          </div>
        )}
        {/* 폭 측정용 사본 (보이지 않음) — 마지막 항목은 ⋯ 버튼 폭 */}
        <div className="gnb gnb-measure" ref={measureRef} aria-hidden>
          {menu.map(item => <button key={item.label} tabIndex={-1}>{item.label}{item.children && <span> ▾</span>}</button>)}
          <button tabIndex={-1}>⋯</button>
        </div>
      </nav>

      {/* 도구 줄 (UFO 스킨) — 사이드바에서는 로고 아래 한 줄로 모인다 */}
      <div className="side-tools">
      {/* 카테고리 목록 열기 — 모바일·태블릿 전용, 다크모드 버튼 왼쪽 (PC는 사이드바가 늘 보여 skin.css가 숨긴다) */}
      <button className="btn-cat" aria-label="카테고리" aria-expanded={catOpen}
        onClick={e => { e.stopPropagation(); setCatOpen(o => !o); }}>
        <ListIcon />
      </button>
      {/* 라이트/다크 전환 — 방문자 각자 (커스텀 테마면 관리자 색 그대로라 숨김) */}
      {scheme && (
        <button className="btn-scheme"
          onClick={e => playSchemeSwitch(e.currentTarget.getBoundingClientRect(), toggleScheme)}
          aria-label={scheme === 'dark' ? '라이트 모드로' : '다크 모드로'} data-tip={scheme === 'dark' ? '라이트 모드' : '다크 모드'}>
          {scheme === 'dark' ? <SunIcon /> : <MoonIcon />}
        </button>
      )}
      {/* 위젯 추가 — 그리드 토글 왼쪽 (v1.9 사용자 확정: 본문 하단 버튼 대체) */}
      {editOn && pathname === '/' && (
        <button className="btn btn-ghost" style={{ height: 27, padding: '0 11px', fontSize: 10.5, whiteSpace: 'nowrap' }}
          onClick={() => window.dispatchEvent(new Event('ohome-add-widget'))}>＋ 위젯</button>
      )}
      {/* 그리드 토글 — 메인에서 편집모드 켰을 때만 (v1.9) */}
      <KToggle
        className={`grid-chip ${editOn && pathname === '/' ? 'show' : ''}`}
        label="그리드"
        checked={gridOn}
        onChange={setGridOn}
      />
      {/* 편집중 표시 — 클릭 시 종료 확인 (v1.8) */}
      <span className={`edit-flag ${editOn ? 'show' : ''}`} onClick={() => requestExit()}>
        ✎ 편집중
      </span>

      {/* 사용자 영역 — 비로그인: 로그인 버튼 / 로그인: 프로필 드롭다운 (3장 주석, 4.0) */}
      {user ? (
        <div className="user-wrap" ref={userRef}>
          <div className="user-chip" onClick={() => setMenuOpen(o => !o)}>
            {/* 알림 종 (4.13) — 클릭 시 알림 드롭다운 (프로필 메뉴와 별개) */}
            <span className="badge-dot" data-n={String(Math.min(9, unread.length))}
              onClick={e => { e.stopPropagation(); setMenuOpen(false); setNotifOpen(o => !o); }}>
              <BellIcon />
            </span>
            {/* 기본 아바타는 이니셜 없이 단색/그라데이션 (v1.9) */}
            <div className="avatar" style={!avatarSrc && user.avatarColor ? { background: user.avatarColor } : undefined}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {avatarSrc && <img src={avatarSrc} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
            </div>
            {user.nickname} <span style={{ fontSize: 9, color: '#8d939d' }}>▾</span>
          </div>
          {/* 알림 드롭다운 — 목록 + 모두 읽음 + 항목별 on/off (4.13) */}
          <div className={`user-menu notif-menu ${notifOpen ? 'open' : ''}`}>
            <div className="nh">
              <b>알림</b>
              {unread.length > 0 && (
                <button className="all" onClick={() => markAllRead(user.id)}>모두 읽음</button>
              )}
              {/* 읽은 알림은 하루 뒤 저절로 사라지지만, 바로 치우고 싶을 때 (v2.0 사용자 요청) */}
              {myNotifs.some(n => n.read) && (
                <button className="all" onClick={() => clearReadNotifs(user.id)}>읽은 알림 정리</button>
              )}
            </div>
            {myNotifs.length === 0 && <p className="empty">알림이 없습니다</p>}
            {myNotifs.slice(0, 12).map(n => (
              <button key={n.id} className={`nt ${n.read ? 'rd' : ''}`}
                onClick={() => { markRead(n.id); setNotifOpen(false); nav(n.href); }}>
                <b>{n.title}</b>
                {n.body && <span>{n.body}</span>}
                <small>{fmtNd(n.date)}</small>
              </button>
            ))}
            {mySet && (
              <div className="nset">
                {(Object.keys(NOTIF_TYPE_LABEL) as NotifType[])
                  .filter(k => k !== 'guest' || isAdmin) // 방명록 알림은 관리자 항목
                  .map(k => (
                    <label key={k} className="row">
                      <span>{NOTIF_TYPE_LABEL[k]}</span>
                      <KToggle checked={mySet[k]} onChange={v => setNotifSetting(user.id, k, v)} />
                    </label>
                  ))}
                {/* 전달 자가진단 (v2.0) — 서버 저장→읽기를 실제로 해 보고 결과를 알려 준다 */}
                <button className="all" style={{ marginTop: 2 }}
                  onClick={async () => { toast(await selfTestNotif(user.id)); void syncNotifs(user.id, true); }}>
                  알림 전달 확인
                </button>
              </div>
            )}
          </div>
          <div className={`user-menu ${menuOpen ? 'open' : ''}`}>
            <button onClick={() => { setMenuOpen(false); nav('/mypage'); }}>마이페이지</button>
            {isAdmin && (
              <>
                {/* 편집모드 항목은 지원 페이지에서만 노출 (편집 중이면 끄기 위해 항상 표시) */}
                {(editAvailable || editOn) && (
                  <button onClick={() => { setMenuOpen(false); toggleEdit(); }}>
                    편집모드 {editOn ? '끄기' : '켜기'}
                  </button>
                )}
                <button onClick={() => { setMenuOpen(false); nav('/settings'); }}>환경설정</button>
              </>
            )}
            <button onClick={() => { setMenuOpen(false); logout(); }}>로그아웃</button>
          </div>
        </div>
      ) : (
        <button className="login-link" onClick={() => nav('/login')}>로그인</button>
      )}
      </div>

      {/* 모바일 카테고리 목록 — 사이드바와 같은 메뉴(공개 범위·순서·이름 그대로). 고르면 이동하고 닫힌다 */}
      {catOpen && (
        <div className="cat-pop" ref={catRef}>
          {menu.map(item =>
            item.children ? (
              <div className="cp-grp" key={item.label}>
                <div className="cp-cap">{item.label}</div>
                {item.children.map(c => (
                  <button key={c.href} onClick={() => { setCatOpen(false); nav(c.href); }}>
                    {c.label}{dotHrefs.has(c.href) && <small className="nd">●</small>}
                  </button>
                ))}
              </div>
            ) : (
              <button key={item.label} className={pathname === item.href ? 'on' : ''}
                onClick={() => { setCatOpen(false); nav(item.href!); }}>
                {item.label}{dotHrefs.has(item.href!) && <small className="nd">●</small>}
              </button>
            ))}
        </div>
      )}
    </header>
  );
}
