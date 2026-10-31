'use client';
import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { useMembers } from '@/lib/members';
import { KInput, KSelect, KCheck } from '@/components/ui/Kit';
import { DragList } from '@/components/ui/DragList';
import { useConfirmDelete, ConfirmModal, Modal } from '@/components/ui/Modal';
import { newId } from '@/lib/postStore';
import { useCommSettings } from '@/lib/commStore';
import { useBoards, BoardPerm, MAIN_BOARD_ID } from '@/lib/boardStore';
import { useMenuSettings, MenuPerm, MenuVis, MenuGroupNode, MenuLeaf, defaultTree, newGroupId, menuLabelFor, boardEntries, IMG_PROTECT_AREAS } from '@/lib/menuStore';
import { FEATURES } from '@/lib/menu';
import { useSections, sectionsOf, sectionMenuEntries, MAIN_SEC } from '@/lib/sectionStore';
import { useCustomLinks, linkEntries, toInternalPath } from '@/lib/linkStore';
import { useToast } from '@/components/ui/Toast';
import { getPageText, setPageText } from '@/components/ui/PageText';
import { backend } from '@/lib/backend';
import { CONTENT_COLLECTIONS } from '@/lib/backend/types';
import { visFloorOf } from '@/lib/visFloor';

/** 멤버 선택 모달 (v2.0 사용자 요청) — 「비로그인 숨김」 메뉴를 특정 회원에게만.
 *  검색으로 걸러 체크하고, 비우면 지금까지처럼 로그인한 모든 회원. 관리자는 항상 볼 수 있어 목록에 없다 */
function MemberPickModal({ initial, onApply, onClose, desc }: {
  initial: string[]; onApply: (ids: string[]) => void; onClose: () => void;
  desc?: string;   // 무엇에 대한 선택인지 — 노출 제한/글쓰기 권한이 같은 모달을 쓴다 (v2.0)
}) {
  const pool = useMembers().filter(p => p.id !== 'admin' && p.role !== 'admin');
  const [q, setQ] = useState('');
  const [sel, setSel] = useState<string[]>(initial);
  const t = q.trim().toLowerCase();
  const list = pool.filter(p => !t || p.nickname.toLowerCase().includes(t) || p.id.toLowerCase().includes(t));
  return (
    <Modal open small title="멤버 선택" onClose={onClose}
      desc={desc ?? '체크한 회원(그리고 관리자)에게만 이 메뉴가 보이고 열립니다 — 비우면 로그인한 모든 회원'}
      actions={<>
        <button className="btn btn-ghost" onClick={onClose}>CANCEL</button>
        <button className="btn btn-accent" onClick={() => { onApply(sel); onClose(); }}>적용</button>
      </>}>
      <div style={{ display: 'grid', gap: 9 }}>
        <KInput placeholder="닉네임·아이디 검색" value={q} onChange={e => setQ(e.target.value)} />
        <div style={{ maxHeight: 240, overflow: 'auto', display: 'grid', gap: 4, alignContent: 'start' }}>
          {list.map(p => (
            <KCheck key={p.id}
              label={<span style={{ fontSize: 12.5 }}>{p.nickname} <small style={{ color: 'var(--faint)' }}>{p.id}</small></span>}
              checked={sel.includes(p.id)}
              onChange={v => setSel(s => (v ? [...s, p.id] : s.filter(x => x !== p.id)))} />
          ))}
          {list.length === 0 && (
            <p className="hint" style={{ margin: 0 }}>
              {pool.length === 0 ? '가입한 회원이 없습니다' : '검색과 일치하는 회원이 없습니다'}
            </p>
          )}
        </div>
        {/* 탈퇴 등으로 목록에 없는 선택이 남아 있으면 알려 준다 — 몰래 남아 계속 잠그는 일이 없게 */}
        {sel.some(id => !pool.some(p => p.id === id)) && (
          <p className="hint" style={{ margin: 0 }}>
            회원 목록에 없는 선택 {sel.filter(id => !pool.some(p => p.id === id)).length}건이 있습니다 — 적용하면 그대로 유지됩니다
          </p>
        )}
      </div>
    </Modal>
  );
}

/** 메뉴 관리 탭 (5.2 — 메뉴 선택제) — 노출·순서·이름 + 메뉴별 부속 설정 */
export function MenuPane() {
  const [ms, patch, msLoaded] = useMenuSettings();
  // 글에도 적용 (v2.0 사용자 요청) — 아래 applyVis 참조
  const { user } = useAuth();
  const [visBusy, setVisBusy] = useState(false);
  // 「주소로는 열람 허용」을 켤 때 띄우는 확인 (v2.0 사용자 요청)
  const [openAsk, setOpenAsk] = useState<(() => void) | null>(null);
  const [visAsk, setVisAsk] = useState(false);
  // 멤버 선택 모달 (v2.0 사용자 요청) — 「비로그인 숨김」·갤러리 글쓰기를 특정 회원으로 좁힌다
  const [memAsk, setMemAsk] = useState<{ ids: string[]; apply: (ids: string[]) => void; desc?: string } | null>(null);
  const [commSet, patchComm] = useCommSettings();
  const { boards, loaded: bLoaded, patchBoard } = useBoards();  // 추가 게시판 이름·자동 편입 동기화 + 권한
  const toast = useToast();
  const del = useConfirmDelete();
  const saved = ms.tree ?? defaultTree();
  // 게시판 + 여러 개로 만든 섹션 — 메뉴가 아는 「추가 항목」 전체 (v2.0)
  const { map: secMap } = useSections();
  const { links, setLinks } = useCustomLinks();   // 커스텀 링크 (v2.0 사용자 요청)
  // 새 커스텀 링크 입력 폼 (v2.0 사용자 제보 — 「주소를 적으면 이름 짓기 전에 올라간다」).
  // 예전에는 ADD가 빈 행을 즉시 등록해, 주소를 치는 순간 미배치에 미완성 링크가 나타났다
  const [nlName, setNlName] = useState('');
  const [nlHref, setNlHref] = useState('');
  const extraAll = [...boardEntries(boards), ...sectionMenuEntries(secMap), ...linkEntries(links)];
  const defLabel = (href: string) => menuLabelFor(href, extraAll) ?? href;

  // 드래프트 — 모든 편집(삭제 포함)은 SAVE를 눌러야 실제 메뉴에 반영 (v1.9 사용자 피드백)
  const [draft, setDraft] = useState<MenuGroupNode[] | null>(null);
  const [draftRemoved, setDraftRemoved] = useState<string[] | null>(null);
  const tree = draft ?? saved;
  const removed = draftRemoved ?? ms.removedBoards;
  const dirty = draft !== null && (
    JSON.stringify(draft) !== JSON.stringify(saved)
    || JSON.stringify(removed) !== JSON.stringify(ms.removedBoards));
  // 저장본이 바뀌면(정규화·다른 탭) 편집 전 상태에서만 드래프트 갱신
  const savedKey = JSON.stringify([saved, ms.removedBoards]);
  useEffect(() => {
    if (!msLoaded || !bLoaded) return;
    if (!dirty) { setDraft(saved); setDraftRemoved(ms.removedBoards); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedKey, msLoaded, bLoaded]);

  const setTree = (t: MenuGroupNode[]) => setDraft(t);
  const saveAll = () => { patch({ tree, removedBoards: removed }); toast('메뉴가 저장되었습니다'); };

  /* 이미 올라간 글의 공개범위를 서버에 적용 (v2.0 사용자 요청).
     화면에서 가리는 것만으로는 API를 직접 부르는 사람에게 그대로 보인다 — 서버(RLS)가
     내주지 않게 하려면 행의 공개범위 칸 자체가 좁아야 한다.
     컬렉션을 하나씩 훑어 **비공개 메뉴에 걸린 것만** 골라 그 칸만 갱신한다(내용·순서는 그대로).
     새 글은 저장할 때마다 같은 기준이 자동으로 걸리므로(visFloor) 이 버튼은 **이미 있는 글**용이다. */
  const applyVis = async () => {
    const be = backend();
    if (!be) { toast('서버에 연결돼 있지 않습니다 — 브라우저 저장 모드에는 서버 권한 자체가 없습니다'); return; }
    setVisBusy(true);
    try {
      let n = 0;
      for (const coll of CONTENT_COLLECTIONS) {
        const rows = await be.fetchList(coll);
        const targets = rows.filter(r => visFloorOf(coll, r) !== 'public');
        if (targets.length) n += await be.refreshVis(coll, targets, user?.id ?? null);
      }
      toast(n ? `글 ${n}건을 서버에서도 가렸습니다` : '비공개로 둔 메뉴에 글이 없습니다');
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : '적용하지 못했습니다');
    }
    setVisBusy(false);
  };
  const revert = () => { setDraft(saved); setDraftRemoved(ms.removedBoards); };

  // 이탈 경고 — 미저장 변경이 있는데 상단바·다른 설정 탭으로 이동하려 하면 (테마와 동일 패턴)
  const dirtyRef = useRef(dirty); dirtyRef.current = dirty;
  const [leaveAsk, setLeaveAsk] = useState(false);
  const pendingClick = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const onCapture = (e: MouseEvent) => {
      if (!dirtyRef.current) return;
      const t = e.target as HTMLElement | null;
      const hit = t?.closest?.('.topbar a, .topbar button, .topbar .brand, .set-nav button') as HTMLElement | null;
      if (!hit) return;
      e.preventDefault(); e.stopPropagation();
      pendingClick.current = hit; setLeaveAsk(true);
    };
    document.addEventListener('click', onCapture, true);
    return () => document.removeEventListener('click', onCapture, true);
  }, []);
  const [resetAsk, setResetAsk] = useState(false);   // 기본 구성 리셋 확인 모달
  const [mtab, setMtab] = useState<'basic' | 'perm'>('basic');   // 기본(구성) / 권한 탭 (v1.9)
  // 역극 비로그인 안내 문구 (v1.9 — pagetext 'rp-gate-desc')
  const [rpGate, setRpGate] = useState('');
  useEffect(() => { setRpGate(getPageText('rp-gate-desc', '역극은 로그인한 참여자에게만 표시됩니다')); }, []);
  const leaveWith = (action: 'save' | 'discard') => {
    if (action === 'save') patch({ tree, removedBoards: removed });
    else revert();
    dirtyRef.current = false;
    setLeaveAsk(false);
    const el = pendingClick.current;
    pendingClick.current = null;
    setTimeout(() => el?.click(), 30);   // 보류했던 클릭 재실행 → 원래 목적지로
  };

  /* 트리 정규화(저장본 대상) — 사라진 기능(삭제된 게시판) 제거.
     **새로 만든 것을 자동으로 넣지는 않는다** (v2.0 사용자 확정) — 미배치에 머물게 둔다 */
  useEffect(() => {
    if (!msLoaded || !bLoaded) return;
    let next: MenuGroupNode[] = saved
      .map(g => (g.href
        ? (menuLabelFor(g.href, extraAll) === null ? null : g)
        : { ...g, items: g.items.filter(it => menuLabelFor(it.href, extraAll) !== null) }))
      .filter((g): g is MenuGroupNode => !!g);
    if (JSON.stringify(next) !== JSON.stringify(saved)) patch({ tree: next });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [msLoaded, bLoaded, boards, ms.tree]);

  // 미배치 = 트리에 없는 기능 — 메뉴에 노출되지 않음 (데이터는 보존)
  const placedSet = new Set(tree.flatMap(g => (g.href ? [g.href] : g.items.map(i => i.href))));
  const unplaced = [
    ...FEATURES.filter(f => !placedSet.has(f.href)),
    // 게시판·갤러리·다이어리 등 여러 개로 만든 것도 여기 뜬다 (v2.0 사용자 요청).
    // 자동 배치를 없앴으므로 **만들면 여기 머문다** — 원하는 상위 메뉴에 직접 넣는다
    ...extraAll.map(b => ({ href: b.href, label: b.name })).filter(x => !placedSet.has(x.href)),
  ];

  const patchGroup = (id: string, p: Partial<MenuGroupNode>) =>
    setTree(tree.map(g => (g.id === id ? { ...g, ...p } : g)));
  // 배치 해제 시 게시판이면 자동 편입 제외 목록에 (다시 배치하면 해제) — 드래프트에만
  const markRemoved = (hrefs: string[]) => {
    // 추가 항목(게시판·섹션)은 빼 두면 자동 배치가 다시 넣지 않도록 기억한다 —
    // 기억하지 않으면 빼는 순간 자동 배치가 원래 자리로 되돌려 놓는다
    const known = new Set(extraAll.map(b => b.href));
    const bs = hrefs.filter(h => known.has(h));
    if (bs.length) setDraftRemoved([...new Set([...removed, ...bs])]);
  };
  const removeGroup = (g: MenuGroupNode) => {
    setTree(tree.filter(x => x.id !== g.id));
    markRemoved(g.href ? [g.href] : g.items.map(i => i.href));
  };
  // 삭제는 경고 모달을 거친 뒤 드래프트에 반영 — SAVE를 눌러야 실제 메뉴에서 사라짐
  const askRemoveGroup = (g: MenuGroupNode) => del.ask(
    g.href ? `단독 메뉴 「${g.label}」를 메뉴에서 빼시겠습니까?` : `상위 메뉴 「${g.label}」를 삭제하시겠습니까?`,
    () => removeGroup(g),
    `${g.href ? '이 기능은' : '하위 메뉴는'} 미배치 목록으로 이동하며 데이터는 보존됩니다. SAVE를 눌러야 실제 메뉴에 반영됩니다.`);
  const removeItem = (gid: string, href: string) => {
    setTree(tree.map(g => (g.id === gid ? { ...g, items: g.items.filter(i => i.href !== href) } : g)));
    markRemoved([href]);
  };
  const moveItem = (fromGid: string, it: MenuLeaf, to: string) => {
    const stripped = tree.map(g => (g.id === fromGid ? { ...g, items: g.items.filter(i => i.href !== it.href) } : g));
    if (to === 'solo') {
      setTree([...stripped, { id: newGroupId(), label: it.label ?? defLabel(it.href), href: it.href, items: [], pageTitle: it.pageTitle }]);
    } else {
      setTree(stripped.map(g => (g.id === to ? { ...g, items: [...g.items, it] } : g)));
    }
  };
  const placeUnplaced = (href: string, to: string) => {
    if (to === 'solo') setTree([...tree, { id: newGroupId(), label: defLabel(href), href, items: [] }]);
    else setTree(tree.map(g => (g.id === to ? { ...g, items: [...g.items, { href }] } : g)));
    if (href.startsWith('/board?b=')) setDraftRemoved(removed.filter(h => h !== href));
  };
  const groupOptions = (excludeId?: string) => [
    ...tree.filter(g => !g.href && g.id !== excludeId).map(g => ({ value: g.id, label: `→ ${g.label}` })),
    { value: 'solo', label: '→ 단독 메뉴' },
  ];

  const permSel = (label: string, value: MenuPerm, onChange: (v: MenuPerm) => void) => (
    <KSelect minWidth={110} value={value} onChange={v => onChange(v as MenuPerm)}
      options={[
        { value: 'guest', label: `${label}: 방문자` },
        { value: 'member', label: `${label}: 가입자` },
        { value: 'admin', label: `${label}: 관리자` },
      ]} />
  );
  // 메뉴별 부속 설정 — 기본 탭용 (표시 방식 등)
  const extraFor = (href: string) => {
    switch (href) {
      case '/gallery': return (
        <div className="mini-seg">
          <button className={ms.backupView === 'gal' ? 'on' : ''} onClick={() => patch({ backupView: 'gal' })}>기본: 갤러리</button>
          <button className={ms.backupView === 'list' ? 'on' : ''} onClick={() => patch({ backupView: 'list' })}>기본: 리스트</button>
        </div>
      );
      case '/comm': return (
        <div className="mini-seg">
          <button className={commSet.ratio === '3:4' ? 'on' : ''} onClick={() => patchComm({ ratio: '3:4' })}>비율 3:4</button>
          <button className={commSet.ratio === '4:3' ? 'on' : ''} onClick={() => patchComm({ ratio: '4:3' })}>비율 4:3</button>
        </div>
      );
      // 스케줄러 달 표기 (v1.9) — AUGUST 2026 / 2026.08
      case '/cal': return (
        <div className="mini-seg">
          <button className={(ms.calTitle ?? 'en') === 'en' ? 'on' : ''} onClick={() => patch({ calTitle: 'en' })}>AUGUST 2026</button>
          <button className={ms.calTitle === 'num' ? 'on' : ''} onClick={() => patch({ calTitle: 'num' })}>2026.08</button>
        </div>
      );
      default: return null;
    }
  };

  // 메뉴별 권한 부속 — 권한 탭용 (v1.9)
  const extraPerm = (href: string) => {
    // 역극 — 비로그인 안내 문구 (관리자는 그 화면을 볼 수 없어 여기서 편집)
    if (href === '/rp') {
      return (
        <KInput value={rpGate}
          onChange={e => { setRpGate(e.target.value); setPageText('rp-gate-desc', e.target.value); }}
          placeholder="비로그인 안내 문구" style={{ width: 210, fontSize: 12 }} />
      );
    }
    // 게시판 글쓰기·댓글 권한 (게시판별)
    if (href === '/board' || href.startsWith('/board?b=')) {
      const bid = href === '/board' ? MAIN_BOARD_ID : href.slice('/board?b='.length);
      const bd = boards.find(b => b.id === bid);
      if (!bd) return null;
      return (
        <>
          <KSelect minWidth={110} value={bd.permWrite}
            onChange={v => patchBoard(bd.id, { permWrite: v as BoardPerm })}
            options={[
              { value: 'member', label: '글쓰기: 가입자' },
              { value: 'admin', label: '글쓰기: 관리자' },
            ]} />
          <KSelect minWidth={110} value={bd.permComment}
            onChange={v => patchBoard(bd.id, { permComment: v as BoardPerm })}
            options={[
              { value: 'guest', label: '댓글: 방문자' },
              { value: 'member', label: '댓글: 가입자' },
              { value: 'admin', label: '댓글: 관리자' },
            ]} />
        </>
      );
    }
    if (href === '/loadb') {
      return (
        <>
          {permSel('업로드', ms.roadUpload, v => patch({ roadUpload: v }))}
          {permSel('댓글', ms.roadComment, v => patch({ roadComment: v }))}
        </>
      );
    }
    // 갤러리 글쓰기 권한 (v2.0 사용자 요청) — 갤러리(섹션)마다 · 「글쓰기 멤버」로 특정 회원까지
    if (href === '/gallery' || href.startsWith('/gallery?s=')) {
      const key = href === '/gallery' ? MAIN_SEC : href.slice('/gallery?s='.length);
      // 메뉴 주소에는 별명(slug)이 적혀 있을 수 있다 — id로 통일해 저장
      const gsec = sectionsOf(secMap, 'gallery').find(s2 => s2.id === key || s2.slug === key);
      if (!gsec) return null;
      const gw = ms.galWrite?.[gsec.id] ?? 'member';
      const gwIds = ms.galWriteMembers?.[gsec.id];
      return (
        <>
          {gw === 'member' && (
            <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
              onClick={() => setMemAsk({
                ids: gwIds ?? [],
                desc: '체크한 회원(그리고 관리자)만 이 갤러리에 글을 쓸 수 있습니다 — 비우면 로그인한 모든 회원',
                apply: n => {
                  const next = { ...ms.galWriteMembers };
                  if (n.length) next[gsec.id] = n; else delete next[gsec.id];
                  patch({ galWriteMembers: next });
                },
              })}>
              {gwIds?.length ? `글쓰기 멤버 ${gwIds.length}명` : '글쓰기 멤버'}
            </button>
          )}
          <KSelect minWidth={110} value={gw}
            onChange={v => {
              // 관리자 전용으로 바꾸면 멤버 선택은 함께 지운다 — 몰래 남아 있지 않게 (노출 제한과 같은 규칙)
              const next = { ...ms.galWriteMembers };
              if (v !== 'member') delete next[gsec.id];
              patch({ galWrite: { ...ms.galWrite, [gsec.id]: v as MenuPerm }, galWriteMembers: next });
            }}
            options={[
              { value: 'member', label: '글쓰기: 가입자' },
              { value: 'admin', label: '글쓰기: 관리자' },
            ]} />
        </>
      );
    }
    return null;
  };

  /* 「주소로는 열람 허용」 (v2.0 사용자 요청) — 메뉴·위젯에서는 감추되 들어오는 것만 열어 준다.
     링크로만 돌릴 게시판을 만들려는 용도라, 켤 때 **주소를 아는 사람은 누구나 본다**는 점을
     모달로 분명히 알린다(사용자 요청). 「전부 보임」에서는 이미 열려 있으므로 뜻이 없어 감춘다 */
  const openChk = (v: MenuVis | undefined, open: boolean | undefined, onChange: (nv: boolean) => void) => (
    (v ?? 'all') === 'all' ? null : (
      <KCheck label={<span style={{ fontSize: 11 }}>주소로는 열람 허용</span>} checked={!!open}
        onChange={nv => { if (nv) setOpenAsk(() => () => onChange(true)); else onChange(false); }} />
    )
  );

  // 공개범위 셀렉트 (v1.9) — 메뉴 자체 노출: 전부 / 비로그인 숨김 / 관리자만 (드래프트 — SAVE로 적용)
  const visSel = (v: MenuVis | undefined, onChange: (nv: MenuVis) => void) => (
    <KSelect minWidth={128} value={v ?? 'all'} onChange={nv => onChange(nv as MenuVis)}
      options={[
        { value: 'all', label: '전부 보임' },
        { value: 'member', label: '비로그인 숨김' },
        { value: 'admin', label: '관리자만' },
      ]} />
  );

  /* 멤버 선택 (v2.0 사용자 요청) — 「비로그인 숨김」일 때만 뜨는 버튼.
     검색 모달에서 고른 회원(+관리자)에게만 보이고 들어갈 수 있다 — 비우면 로그인한 모든 회원 */
  const memberBtn = (v: MenuVis | undefined, ids: string[] | undefined, apply: (ids: string[] | undefined) => void) => (
    v !== 'member' ? null : (
      <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
        onClick={() => setMemAsk({ ids: ids ?? [], apply: n => apply(n.length ? n : undefined) })}>
        {ids?.length ? `멤버 ${ids.length}명` : '멤버 선택'}
      </button>
    )
  );
  return (
    <div className="set-sec">
      {/* 제목은 다른 탭과 같은 시작 위치(상단 정렬) — 버튼 줄 높이에 밀려 내려가지 않게 */}
      <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start', marginBottom: 14 }}>
        <h3 style={{ margin: 0 }}>메뉴 관리</h3>
        {dirty && <span style={{ fontSize: 11, color: 'var(--accent)', fontWeight: 600, marginTop: 3 }}>저장 안 된 변경</span>}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <button className="btn btn-ghost" style={{ padding: '6px 14px', fontSize: 11 }}
            onClick={() => setResetAsk(true)}>기본 구성</button>
          <button className="btn btn-ghost" disabled={!dirty} style={{ opacity: dirty ? 1 : 0.45, padding: '6px 14px', fontSize: 11 }}
            onClick={() => { revert(); toast('저장된 메뉴로 되돌렸습니다'); }}>변경 취소</button>
          <button className="btn btn-dark" disabled={!dirty} style={{ opacity: dirty ? 1 : 0.45, padding: '6px 18px', fontSize: 11 }}
            onClick={saveAll}>SAVE</button>
        </div>
      </div>
      {/* 기본(구성) / 권한 탭 (v1.9) — 권한 설정이 길어져 분리 */}
      <div className="mini-seg" style={{ marginBottom: 14 }}>
        <button className={mtab === 'basic' ? 'on' : ''} onClick={() => setMtab('basic')}>기본</button>
        <button className={mtab === 'perm' ? 'on' : ''} onClick={() => setMtab('perm')}>권한</button>
      </div>

      {mtab === 'perm' ? (
        /* ---------- 권한 탭 — 메뉴 공개범위 + 메뉴별 권한 부속 ---------- */
        <div>
          <div className="d">
            공개범위는 메뉴 노출을 정합니다(전부 보임 / 비로그인 숨김 / 관리자만) — SAVE를 눌러야 반영 · 글쓰기·댓글 권한은 즉시 반영
            <br />
            「비로그인 숨김」 옆 <b>멤버 선택</b>으로 특정 회원에게만 보이게 좁힐 수 있습니다 — 비우면 로그인한 모든 회원
            <br />
            <b>주소로는 열람 허용</b>을 켜면 메뉴에서는 계속 감춰 두고 <b>주소를 아는 사람만 들어올 수 있는</b> 메뉴가 됩니다 — 링크로 돌릴 게시판에 씁니다
          </div>
          {tree.map(g => (
            <div key={g.id} style={{ borderBottom: '1px dashed var(--line)', padding: '9px 0' }}>
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <b style={{ fontSize: 13 }}>{g.label}</b>
                {g.href && <small style={{ color: 'var(--faint)', fontSize: 10.5 }}>{g.href}</small>}
                <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  {g.href && extraPerm(g.href)}
                  {openChk(g.vis, g.open, nv => patchGroup(g.id, { open: nv || undefined }))}
                  {memberBtn(g.vis, g.visMembers, ids => patchGroup(g.id, { visMembers: ids }))}
                  {visSel(g.vis, nv => patchGroup(g.id, {
                    vis: nv === 'all' ? undefined : nv,
                    ...(nv === 'all' ? { open: undefined } : {}),
                    ...(nv !== 'member' ? { visMembers: undefined } : {}),
                  }))}
                </div>
              </div>
              {!g.href && g.items.map(it => (
                <div key={it.href} style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', padding: '6px 0 0 22px' }}>
                  <span style={{ fontSize: 12.5 }}>{it.label ?? defLabel(it.href)}</span>
                  <small style={{ color: 'var(--faint)', fontSize: 10.5 }}>{it.href}</small>
                  <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    {extraPerm(it.href)}
                    {openChk(it.vis, it.open, nv => patchGroup(g.id, {
                      items: g.items.map(x => (x.href === it.href ? { ...x, open: nv || undefined } : x)),
                    }))}
                    {memberBtn(it.vis, it.visMembers, ids => patchGroup(g.id, {
                      items: g.items.map(x => (x.href === it.href ? { ...x, visMembers: ids } : x)),
                    }))}
                    {visSel(it.vis, nv => patchGroup(g.id, {
                      items: g.items.map(x => (x.href === it.href
                        ? {
                          ...x, vis: nv === 'all' ? undefined : nv,
                          ...(nv === 'all' ? { open: undefined } : {}),
                          ...(nv !== 'member' ? { visMembers: undefined } : {}),
                        } : x)),
                    }))}
                  </div>
                </div>
              ))}
            </div>
          ))}
          {/* 글에도 적용 (v2.0 사용자 요청) — 공개범위를 서버까지 적용한다 */}
          <div style={{ marginTop: 18, paddingTop: 14, borderTop: '1px solid var(--line)' }}>
            <b style={{ fontSize: 13 }}>열람 비공개 처리</b>
            <div className="d" style={{ marginTop: 4, lineHeight: 1.7 }}>
              위 공개범위는 <b>화면에서 가리는 것</b>이라, 주소나 API를 직접 부르면 글이 그대로 나옵니다.
              이 버튼을 누르면 <b>이미 올라간 글의 공개범위를 서버에 적용</b>해 서버가 아예 내주지 않게 합니다
              — 「비로그인 숨김」은 회원공개로, 「관리자만」은 비공개로.
              <br />
              <b>지금부터 쓰는 글은 누르지 않아도 그렇게 저장됩니다.</b>{' '}
              <span style={{ color: 'var(--accent)' }}>좁히기만 하고 넓히지는 않습니다</span> —
              나중에 다시 공개로 바꾸려면 각 글의 공개범위를 직접 되돌려야 합니다.
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 10 }}>
              <button className="btn btn-dark" disabled={visBusy || dirty}
                onClick={() => setVisAsk(true)}>
                {visBusy ? '적용 중…' : dirty ? 'SAVE 먼저' : '글에도 적용'}
              </button>
            </div>
          </div>
          {/* 멤버 선택 (v2.0 사용자 요청) — 검색으로 골라 그 회원(+관리자)에게만 */}
          {memAsk && (
            <MemberPickModal initial={memAsk.ids} onApply={memAsk.apply} desc={memAsk.desc}
              onClose={() => setMemAsk(null)} />
          )}

          {/* 「주소로는 열람 허용」 확인 (v2.0 사용자 요청) — 켜는 순간 무엇이 열리는지 분명히 */}
          <ConfirmModal open={!!openAsk} title="주소가 있는 모두에게 공개됩니다"
            body={'메뉴에서는 계속 감춰지지만, 이 주소를 아는 사람은 로그인하지 않아도 들어와 볼 수 있습니다. 링크를 받은 사람이 다른 곳에 옮겨 적으면 그 사람들도 볼 수 있습니다. 정말 알려지면 안 되는 내용에는 쓰지 마세요.'}
            onClose={() => setOpenAsk(null)}
            buttons={[
              { label: 'CANCEL', kind: 'ghost', onClick: () => setOpenAsk(null) },
              { label: '알겠습니다', kind: 'dark', onClick: () => { openAsk?.(); setOpenAsk(null); } },
            ]} />

          <ConfirmModal open={visAsk} title="글 공개범위를 서버에 적용할까요?"
            body={'비공개로 둔 메뉴의 글이 서버에서도 가려집니다. 각 글의 공개범위가 바뀌므로, 되돌리려면 글마다 직접 고쳐야 합니다.'}
            onClose={() => setVisAsk(false)}
            buttons={[
              { label: 'CANCEL', kind: 'ghost', onClick: () => setVisAsk(false) },
              { label: '적용', kind: 'dark', onClick: () => { setVisAsk(false); void applyVis(); } },
            ]} />

          {/* 이미지 저장 방지 (v1.9) — 영역별 우클릭·드래그 차단, 관리자 제외 · 즉시 반영 */}
          <div style={{ marginTop: 18 }}>
            <b style={{ fontSize: 13 }}>이미지 저장 방지</b>
            <div className="d" style={{ marginTop: 4 }}>체크한 영역에서 이미지 우클릭 저장·드래그 반출을 막습니다 — 관리자 계정은 제외 · 즉시 반영</div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap', marginTop: 8 }}>
              {IMG_PROTECT_AREAS.map(a => (
                <KCheck key={a.key} label={a.label}
                  checked={(ms.imgProtect ?? []).includes(a.key)}
                  onChange={v => patch({
                    imgProtect: v
                      ? [...(ms.imgProtect ?? []), a.key]
                      : (ms.imgProtect ?? []).filter(k => k !== a.key),
                  })} />
              ))}
            </div>
          </div>
        </div>
      ) : (
      <>
      <DragList items={tree} keyOf={g => g.id} onReorder={setTree}
        render={g => (
          <div style={{ width: '100%', borderBottom: '1px dashed var(--line)', padding: '10px 0' }}>
            <div className="set-row" style={{ border: 'none', padding: 0 }}>
              <div className="l" style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span className="drag-h">⠿</span>
                <KInput value={g.label} onChange={e => patchGroup(g.id, { label: e.target.value })}
                  style={{ width: 110, fontWeight: 700 }} />
                {g.href ? (
                  <>
                    <span className="cp-lb">타이틀</span>
                    <KInput value={g.pageTitle ?? ''} placeholder="기본"
                      onChange={e => patchGroup(g.id, { pageTitle: e.target.value || undefined })}
                      style={{ width: 120, fontSize: 12 }} />
                    <small style={{ color: 'var(--faint)', fontSize: 10.5 }}>단독 · {g.href}</small>
                  </>
                ) : <span className="pill">상위</span>}
              </div>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                {g.href && extraFor(g.href)}
                <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
                  onClick={() => askRemoveGroup(g)}>{g.href ? '빼기' : 'DELETE'}</button>
              </div>
            </div>
            {/* 하위 메뉴 — 그룹 안 순서(⠿)·이름·이동·빼기 + 부속 설정 */}
            {!g.href && (
              <div style={{ padding: '8px 0 0 34px' }}>
                <DragList items={g.items} keyOf={it => it.href}
                  onReorder={items => patchGroup(g.id, { items })}
                  render={it => (
                    <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', width: '100%', padding: '3px 0' }}>
                      <span className="drag-h" style={{ fontSize: 11 }}>⠿</span>
                      <KInput value={it.label ?? ''} placeholder={defLabel(it.href)}
                        onChange={e => patchGroup(g.id, {
                          items: g.items.map(x => (x.href === it.href
                            ? { ...x, label: e.target.value || undefined } : x)),
                        })}
                        style={{ width: 110, fontSize: 12 }} />
                      <span className="cp-lb">타이틀</span>
                      <KInput value={it.pageTitle ?? ''} placeholder="기본"
                        onChange={e => patchGroup(g.id, {
                          items: g.items.map(x => (x.href === it.href
                            ? { ...x, pageTitle: e.target.value || undefined } : x)),
                        })}
                        style={{ width: 120, fontSize: 12 }} />
                      <small style={{ color: 'var(--faint)', fontSize: 10.5 }}>{it.href}</small>
                      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        {extraFor(it.href)}
                        <KSelect minWidth={104} value="" placeholder="이동"
                          onChange={v => moveItem(g.id, it, v)} options={groupOptions(g.id)} />
                        <button className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 10.5 }}
                          onClick={() => removeItem(g.id, it.href)}>빼기</button>
                      </div>
                    </div>
                  )} />
                {g.items.length === 0 && (
                  <small style={{ color: 'var(--faint)', fontSize: 10.5 }}>하위 메뉴가 없으면 상단 메뉴에 표시되지 않습니다 — 아래 「미배치 기능」에서 추가</small>
                )}
              </div>
            )}
          </div>
        )} />
      <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}
          onClick={() => setTree([...tree, { id: newGroupId(), label: '새 메뉴', items: [] }])}>＋ ADD MENU</button>
      </div>

      <h3 style={{ marginTop: 26 }}>미배치 기능</h3>
      <div className="d">트리에 넣지 않은 기능 — 메뉴에 노출되지 않지만 데이터는 보존됩니다. 넣을 위치를 고르면 바로 배치</div>
      {unplaced.map(f => {
        // 커스텀 링크는 미배치에서도 지울 수 있다 (v2.0 사용자 요청 — 「목록 자체에서 지우고 싶다」).
        // 다른 기능(게시판·섹션 등)은 데이터가 있어 여기서 못 지운다 — 각자의 관리 화면에서
        const link = links.find(l => l.href === f.href);
        return (
          <div key={f.href} className="set-row">
            <div className="l" style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
              <b style={{ fontSize: 12.5 }}>{f.label}</b>
              <small style={{ color: 'var(--faint)', fontSize: 10.5 }}>{f.href}</small>
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <KSelect minWidth={130} value="" placeholder="배치할 위치"
                onChange={v => placeUnplaced(f.href, v)} options={groupOptions()} />
              {link && (
                <button className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 10.5 }}
                  onClick={() => del.ask(`커스텀 링크 「${link.name}」를 지우시겠습니까?`,
                    () => setLinks(links.filter(x => x.id !== link.id)),
                    '링크만 사라집니다 — 가리키던 페이지 자체는 그대로입니다.')}>삭제</button>
              )}
            </div>
          </div>
        );
      })}
      {unplaced.length === 0 && (
        <div style={{ padding: '10px 0', fontSize: 12, color: 'var(--faint)' }}>모든 기능이 메뉴에 배치되어 있습니다</div>
      )}

      {/* 커스텀 링크 (v2.0 사용자 요청) — 사이트 안의 아무 페이지나 메뉴로.
          만들면 위 미배치 목록에 나타나고, 거기서 원하는 상위 메뉴에 넣는다 */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, marginTop: 22 }}>
        <h3 style={{ margin: 0 }}>커스텀 링크</h3>
      </div>
      <div className="d">
        자관·캐릭터처럼 목록에서 골라야 갈 수 있던 페이지를 메뉴에서 바로 — 주소를 적어 두면 됩니다.
        <br />
        <b>내 홈 주소</b>는 붙여 넣으면 사이트 안 이동으로 바뀌고(예: <code>…/rels/latte</code> → <code>/rels/latte</code>),
        <b>다른 사이트 주소</b>는 그대로 남아 새 창으로 열립니다.
        만든 링크는 위 <b>미배치</b>에 나타나며, 거기서 원하는 상위 메뉴에 넣어 주세요.
      </div>
      {links.map(l => (
        <div key={l.id} className="set-row">
          <div className="l" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <KInput value={l.name} placeholder="메뉴에 보일 이름"
              onChange={e => setLinks(links.map(x => (x.id === l.id ? { ...x, name: e.target.value } : x)))}
              style={{ width: 140 }} />
            <KInput value={l.href} placeholder="/rels/latte 또는 풀주소"
              onChange={e => setLinks(links.map(x => (x.id === l.id ? { ...x, href: e.target.value } : x)))}
              onBlur={e => setLinks(links.map(x => (x.id === l.id ? { ...x, href: toInternalPath(e.target.value) } : x)))}
              style={{ width: 260 }} />
          </div>
          <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
            onClick={() => del.ask(`커스텀 링크 「${l.name}」를 지우시겠습니까?`,
              () => {
                setLinks(links.filter(x => x.id !== l.id));
                // 메뉴에 배치돼 있었으면 그 자리도 함께 비운다 — 없는 주소가 남으면 눌러도 아무 일도 안 난다
                setTree(tree.map(g => ({ ...g, items: g.items.filter(i => i.href !== l.href) })).filter(g => g.href !== l.href));
              },
              '메뉴에 배치해 두었다면 그 자리도 함께 비워집니다. 가리키던 페이지 자체는 그대로입니다.')}>DELETE</button>
        </div>
      ))}
      {links.length === 0 && (
        <div style={{ padding: '10px 0', fontSize: 12, color: 'var(--faint)' }}>아직 없습니다 — 아래에 이름과 주소를 적고 ADD를 눌러 주세요</div>
      )}
      {/* 새 링크는 폼을 채워 ADD를 눌러야 등록된다 (v2.0 사용자 제보) —
          예전에는 빈 행이 즉시 등록돼, 주소를 치는 순간 이름도 없는 링크가 미배치에 나타났다 */}
      <div className="set-row" style={{ borderTop: '1px dashed var(--line)' }}>
        <div className="l" style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <KInput value={nlName} placeholder="메뉴에 보일 이름" onChange={e => setNlName(e.target.value)} style={{ width: 140 }} />
          <KInput value={nlHref} placeholder="/rels/latte 또는 풀주소" onChange={e => setNlHref(e.target.value)} style={{ width: 260 }} />
        </div>
        <button className="btn btn-dark" style={{ padding: '4px 12px', fontSize: 10.5 }}
          onClick={() => {
            if (!nlName.trim()) { toast('메뉴에 보일 이름을 입력해 주세요'); return; }
            const href = toInternalPath(nlHref);
            if (!href || href === '/') { toast('이동할 주소를 입력해 주세요'); return; }
            setLinks([...links, { id: newId(), name: nlName.trim(), href }]);
            setNlName(''); setNlHref('');
            toast('링크가 만들어졌습니다 — 위 미배치에서 메뉴에 넣어 주세요');
          }}>＋ ADD</button>
      </div>
      </>
      )}

      {del.element}
      {/* 기본 구성 리셋 확인 (v1.9) — 드래프트만 교체, SAVE로 확정 */}
      <ConfirmModal open={resetAsk} title="메뉴를 기본 구성으로 되돌리시겠습니까?"
        body="기본 제공 메뉴 구성(자놀·게시판·TRPG·커미션·기록·방명록)으로 편집 화면이 바뀝니다. SAVE를 눌러야 실제 메뉴에 반영됩니다."
        onClose={() => setResetAsk(false)}
        buttons={[
          { label: 'RESET', kind: 'dark', onClick: () => { setDraft(defaultTree()); setDraftRemoved([]); setResetAsk(false); } },
          { label: 'CANCEL', kind: 'ghost', onClick: () => setResetAsk(false) },
        ]} />
      {/* 미저장 메뉴 변경 이탈 경고 (v1.9) */}
      <ConfirmModal open={leaveAsk} title="메뉴가 저장되지 않았습니다"
        body="이대로 이동하면 편집 중인 메뉴 변경사항이 사라집니다."
        onClose={() => { pendingClick.current = null; setLeaveAsk(false); }}
        buttons={[
          { label: '저장 후 이동', kind: 'dark', onClick: () => leaveWith('save') },
          { label: '저장하지 않고 이동', kind: 'ghost', onClick: () => leaveWith('discard') },
          { label: 'CANCEL', kind: 'ghost', onClick: () => { pendingClick.current = null; setLeaveAsk(false); } },
        ]} />
    </div>
  );
}
