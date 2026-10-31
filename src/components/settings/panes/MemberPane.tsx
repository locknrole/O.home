'use client';
import { useEffect, useState } from 'react';
import { inviteCode, setInviteCode } from '@/lib/auth';
import { useMembers } from '@/lib/members';
import { KInput, Pager } from '@/components/ui/Kit';
import { useConfirmDelete, ConfirmModal } from '@/components/ui/Modal';
import { useRouter } from 'next/navigation';
import { useToast } from '@/components/ui/Toast';
import { getSetting, setSetting } from '@/lib/settingStore';
import { isServerMode, backend } from '@/lib/backend';
import { configFileText, serverConfig, serverConfigSource } from '@/lib/serverConfig';
import { FIRESTORE_RULES, STORAGE_RULES } from '@/lib/firebaseRules';
import { SCHEMA_SQL } from '@/lib/schemaSql';
import { PushAdminRow } from '@/components/shell/PushSettings';

/** 연결이 이 브라우저에만 저장된 상태 경고 (v2.0 포크 제보 — 「내 브라우저에선 홈이 뜨는데
 *  배포 링크로 들어온 사람에게는 설치 화면이 뜬다」). 설치 마지막 단계(방문자에게도 보이게 하기)를
 *  건너뛰면 다시 알려 주는 곳이 없어 일주일씩 헤매게 된다 — 관리자가 설정에 들어오면 바로 보이게 */
function ConfigScopeWarnRow() {
  const src = serverConfigSource();
  const cfg = serverConfig();
  if (src !== 'local' || !cfg) return null;
  const download = () => {
    const blob = new Blob([configFileText(cfg)], { type: 'application/json' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u; a.download = 'ohome.config.json';
    a.click();
    URL.revokeObjectURL(u);
  };
  return (
    <div className="set-sec" style={{ marginTop: 26, border: '1.5px solid var(--accent)', borderRadius: 12, padding: 16 }}>
      <h3 style={{ color: 'var(--accent)' }}>방문자에게는 아직 설치 화면이 보입니다</h3>
      <div className="d" style={{ lineHeight: 1.7 }}>
        데이터베이스 연결이 <b>지금 이 브라우저에만</b> 저장돼 있습니다 — 다른 사람이 배포 주소로 들어오면
        홈이 아니라 「처음 여는 중」 설치 화면이 뜹니다. 아래 파일을 내려받아 <b>저장소의 public 폴더</b>에
        올리고 커밋하면(1~2분 뒤 자동 재배포) 방문자도 같은 홈을 봅니다. 공개용 값이라 노출돼도 안전합니다.
        <br />
        적용됐는지는 <b>내 배포 주소/ohome.config.json</b>을 열어 값이 보이면 성공입니다.
      </div>
      <div className="setup-row" style={{ marginTop: 10 }}>
        <button className="btn btn-dark" onClick={download}>ohome.config.json 내려받기</button>
      </div>
      <p className="hint" style={{ margin: '8px 0 0' }}>
        파일 대신 Vercel → Settings → Environment Variables에 환경변수로 넣는 방법도 있습니다 — 설치 화면 마지막 단계와 같습니다.
      </p>
    </div>
  );
}

/** 포크 업데이트 바로가기 (v2.0 사용자 요청) — 토큰이나 GitHub 로그인 연동 없이, 저장해 둔 내 포크
 *  주소로 한 번에 이동시켜 준다. 자격 증명을 전혀 다루지 않아 가장 안전하고 구현도 간단하다 —
 *  실제 업데이트(Sync fork)는 그 페이지에서 사용자가 직접 누른다 */
function ForkUpdateRow() {
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [loaded, setLoaded] = useState(false);
  useEffect(() => { setUrl(getSetting<string>('ohome.repo.v1', '')); setLoaded(true); }, []);
  const trimmed = url.trim();
  const valid = /^https:\/\/github\.com\/[^/\s]+\/[^/\s]+\/?$/i.test(trimmed);
  return (
    <div className="set-sec" style={{ marginTop: 26 }}>
      <h3>포크 업데이트</h3>
      <div className="d">
        내 포크 주소를 저장해 두면, 원본에 업데이트가 올라왔을 때 GitHub의 [Sync fork] 화면으로 바로 이동할 수 있습니다
      </div>
      <div className="set-row" style={{ flexWrap: 'wrap' }}>
        <div className="l"><b>내 포크 주소</b><small>GitHub에서 포크한 저장소의 주소</small></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <KInput placeholder="https://github.com/내아이디/O.home" value={url} onChange={e => setUrl(e.target.value)} style={{ width: 250 }} />
          <button className="btn btn-ghost" disabled={!loaded}
            onClick={() => { setSetting('ohome.repo.v1', trimmed); toast('저장되었습니다'); }}>SAVE</button>
          <button className="btn btn-dark" disabled={!valid}
            onClick={() => window.open(trimmed, '_blank', 'noopener')}>내 포크로 이동 ↗</button>
        </div>
      </div>
    </div>
  );
}

/** 보안 규칙 다시 보기 (v2.0) — 최초 설치 이후에도, 앱 업데이트로 규칙이 바뀌면 다시 붙여넣어야 한다.
 *  설치 화면과 같은 내용을 여기서도 복사할 수 있게 */
function SecurityRulesRow() {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState('');
  const cfg = serverConfig();
  const copy = async (text: string, tag: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(tag);
      setTimeout(() => setCopied(''), 2000);
    } catch {
      setOpen(true);
    }
  };
  return (
    <div className="set-sec" style={{ marginTop: 26 }}>
      <h3>보안 규칙</h3>
      <div className="d">
        앱이 업데이트되며 규칙이 바뀔 때가 있습니다 — 새 기능이 갑자기 안 보이거나 목록이 비어 보이거나
        저장이 거부되면 아래를 다시 적용해 보세요.{' '}
        {cfg?.kind === 'firebase'
          ? 'Firestore 콘솔의 규칙 화면에 그대로 덮어써도 안전합니다(기존 컬렉션 권한은 그대로 유지).'
          : 'Supabase 콘솔 → SQL Editor에 통째로 붙여넣고 Run — 여러 번 실행해도 안전합니다(이미 있으면 건너뜀, 쌓아 둔 글·회원은 그대로).'}
      </div>
      {cfg?.kind === 'firebase' ? (
        <div className="setup-row">
          <button className="btn btn-dark" onClick={() => copy(FIRESTORE_RULES, 'fs')}>
            {copied === 'fs' ? '복사됨 ✓' : 'Firestore 규칙 복사'}
          </button>
          <button className="btn btn-dark" onClick={() => copy(STORAGE_RULES, 'st')}>
            {copied === 'st' ? '복사됨 ✓' : 'Storage 규칙 복사'}
          </button>
          <button className="btn btn-ghost" onClick={() => setOpen(o => !o)}>{open ? '내용 접기' : '내용 보기'}</button>
        </div>
      ) : (
        /* Supabase도 여기서 바로 복사 (v2.0 포크 제보) — 예전에는 「schema.sql을 실행하라」는
           안내 한 줄뿐이라, 규칙을 다시 적용하러 온 사람이 빈 화면을 만났다 */
        <div className="setup-row">
          <button className="btn btn-dark" onClick={() => copy(SCHEMA_SQL, 'sql')}>
            {copied === 'sql' ? '복사됨 ✓' : '설치 SQL 복사'}
          </button>
          <button className="btn btn-ghost" onClick={() => setOpen(o => !o)}>{open ? '내용 접기' : '내용 보기'}</button>
        </div>
      )}
      {open && (cfg?.kind === 'firebase' ? (
        <>
          <pre className="setup-sql">{FIRESTORE_RULES}</pre>
          <pre className="setup-sql">{STORAGE_RULES}</pre>
        </>
      ) : (
        <pre className="setup-sql">{SCHEMA_SQL}</pre>
      ))}
    </div>
  );
}

/** 회원/보안 탭 (5.2, v1.9 mock 범위) — 가입코드 변경 + 회원 목록(가입 계정 삭제).
 *  그룹별 권한 매트릭스·가입 승인제·비밀번호 정책은 Supabase 연동 시 확장 */
export function MemberPane() {
  const toast = useToast();
  const del = useConfirmDelete();
  const router = useRouter();   // 회원 이름 클릭 → 회원 정보 페이지 (v1.9)
  const [code, setCode] = useState('');
  const [codeLoaded, setCodeLoaded] = useState(false);
  const [regVer, setRegVer] = useState(0);   // 가입 계정 삭제 후 목록 갱신용
  const [removedIds, setRemovedIds] = useState<string[]>([]);   // 서버 모드에서 방금 지운 회원
  useEffect(() => { setCode(inviteCode()); setCodeLoaded(true); }, []);
  void regVer;

  const members = useMembers();
  const serverOn2 = isServerMode();
  // 계정 삭제는 서비스 콘솔에서만 가능 — 바로 열 수 있게 이 홈의 프로젝트 주소를 만들어 둔다
  const authConsoleUrl = (() => {
    const c = serverConfig();
    if (c?.kind === 'firebase') return `https://console.firebase.google.com/project/${c.projectId}/authentication/users`;
    if (c?.kind === 'supabase') {
      const m = c.url.match(/^https:\/\/([a-z0-9-]+)\.supabase\.co/i);
      return m ? `https://supabase.com/dashboard/project/${m[1]}/auth/users` : '';
    }
    return '';
  })();
  const [delMember, setDelMember] = useState<{ id: string; nickname: string } | null>(null);
  const registry = (() => {
    try { return JSON.parse(localStorage.getItem('ohome.mockreg.v1') ?? '{}') as Record<string, unknown>; } catch { return {}; }
  })();

  // 회원 목록 — 검색 · 10명 페이지네이션 · 태그 그룹화 (v1.9)
  const PER_MEMBERS = 10;
  const [mq, setMq] = useState('');
  const [mPage, setMPage] = useState(1);
  const [filterTag, setFilterTag] = useState<string | null>(null);
  const [mTags, setMTags] = useState<Record<string, string[]>>({});
  const [tagFor, setTagFor] = useState<string | null>(null);   // 태그 입력 중인 회원
  const [tagInput, setTagInput] = useState('');
  // 회원 태그는 관리자가 정하고 모두가 보는 값 — 서버 모드에서는 DB에 저장 (v2.0)
  useEffect(() => { setMTags(getSetting<Record<string, string[]>>('ohome.membertags.v1', {})); }, []);
  const saveTags = (userId: string, tags: string[]) => {
    setMTags(prev => {
      const n = { ...prev };
      if (tags.length) n[userId] = tags; else delete n[userId];
      setSetting('ohome.membertags.v1', n);
      return n;
    });
  };
  const allTags = [...new Set(Object.values(mTags).flat())];
  const isAdminOf = (m: { id: string; role?: string }) => m.role === 'admin' || m.id === 'admin';
  const filteredMembers = members.filter(m => {
    if (removedIds.includes(m.id)) return false;   // 방금 지운 회원 (목록은 한 번만 받아 온다)
    const k = mq.trim().toLowerCase();
    const tags = mTags[m.id] ?? [];
    if (filterTag && !tags.includes(filterTag)) return false;
    return !k || m.nickname.toLowerCase().includes(k) || m.id.toLowerCase().includes(k)
      || tags.some(t => t.toLowerCase().includes(k));
  })
    // 관리자를 맨 위로 (사용자 요청) — 그 다음은 이름순
    .sort((a, b) => (isAdminOf(a) ? 0 : 1) - (isAdminOf(b) ? 0 : 1) || a.nickname.localeCompare(b.nickname));
  const pageMembers = filteredMembers.slice((mPage - 1) * PER_MEMBERS, mPage * PER_MEMBERS);

  return (
    <div className="set-sec">
      <h3>회원/보안</h3>
      <div className="d">가입코드와 회원 목록 관리</div>

      {/* 다른 탭 행들과 같은 .set-row — 라벨은 왼쪽, 입력·버튼은 같은 줄 오른쪽 (v2.0 사용자 지적:
          예전엔 라벨·설명·컨트롤이 각자 줄을 차지해 다른 탭과 통일감이 없고 줄바꿈도 보기 안 좋았다) */}
      <div className="set-row" style={{ marginTop: 8, flexWrap: 'wrap' }}>
        <div className="l"><b>가입코드</b><small>회원가입 시 입력해야 하는 초대코드 — 아는 사람에게만 공유</small></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <KInput value={code} onChange={e => setCode(e.target.value)} style={{ width: 220 }} />
          <button className="btn btn-dark" disabled={!codeLoaded}
            onClick={() => {
              if (!code.trim()) { toast('가입코드를 입력해 주세요'); return; }
              setInviteCode(code);
              toast('가입코드가 변경되었습니다');
            }}>SAVE</button>
        </div>
      </div>

      <h3 style={{ marginTop: 26 }}>회원 목록</h3>
      <div className="d">기본 계정(관리자·지인회원)은 삭제할 수 없습니다 — 태그로 그룹화</div>
      <div className="set-row" style={{ flexWrap: 'wrap' }}>
        <div className="l">
          {allTags.length > 0 ? (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {allTags.map(t => (
                <span key={t} className={`pill${filterTag === t ? ' dark' : ''}`} style={{ cursor: 'var(--cur-pointer,pointer)' }}
                  onClick={() => { setFilterTag(f => (f === t ? null : t)); setMPage(1); }}>{t}</span>
              ))}
            </div>
          ) : <b>태그 필터</b>}
        </div>
        <KInput placeholder="닉네임·아이디·태그 검색" value={mq}
          onChange={e => { setMq(e.target.value); setMPage(1); }}
          style={{ width: 200, fontSize: 12 }} />
      </div>
      {pageMembers.map(m => {
        const isBase = m.id === 'admin' || m.id === 'guest';
        const myTags = mTags[m.id] ?? [];
        return (
          <div key={m.id} style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--line)', flexWrap: 'wrap' }}>
            {/* 이름 클릭 → 회원 정보 페이지 (v1.9) */}
            <b style={{ fontSize: 12.5, cursor: 'var(--cur-pointer,pointer)' }} data-tip="회원 정보 보기"
              onClick={() => router.push(`/members/${m.id}`)}>{m.nickname}</b>
            {/* Firebase 계정 id(uid)는 28자라 줄에서 자리를 다 먹는다 — 앞 7자만, 전체는 툴팁으로 */}
            <small style={{ color: 'var(--faint)', fontSize: 10.5 }} data-tip={m.id.length > 7 ? m.id : undefined}>
              {m.id.length > 7 ? `${m.id.slice(0, 7)}…` : m.id}
            </small>
            {/* 태그 — ✕로 제거, ＋로 추가 (그룹화) */}
            {myTags.map(t => (
              <span key={t} className="pill" style={{ cursor: 'var(--cur-pointer,pointer)' }} data-tip="태그 제거"
                onClick={() => del.ask(`태그 「${t}」를 제거하시겠습니까?`,
                  () => saveTags(m.id, myTags.filter(x => x !== t)),
                  `${m.nickname} 회원에게서만 제거됩니다.`)}>
                {t} <span style={{ fontSize: 8 }}>✕</span>
              </span>
            ))}
            {tagFor === m.id ? (
              <KInput autoFocus placeholder="태그" value={tagInput}
                onChange={e => setTagInput(e.target.value)}
                onBlur={() => setTagFor(null)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && tagInput.trim()) {
                    saveTags(m.id, [...new Set([...myTags, tagInput.trim()])]);
                    setTagInput(''); setTagFor(null);
                  }
                  if (e.key === 'Escape') setTagFor(null);
                }}
                style={{ width: 90, fontSize: 11, padding: '3px 8px' }} />
            ) : (
              <span className="fx" style={{ fontSize: 10 }} data-tip="태그 추가"
                onClick={() => { setTagFor(m.id); setTagInput(''); }}>＋</span>
            )}
            <span className="pill" style={{ marginLeft: 'auto' }}>{isAdminOf(m) ? '관리자' : '회원'}</span>
            {!isBase && !isAdminOf(m) && (
              // 회원 뱃지(.pill)와 같은 규격 — padding·글씨·radius 동일 (v1.9)
              <button className="btn btn-ghost" style={{ padding: '4px 11px', fontSize: 10.5, borderRadius: 20, lineHeight: 'normal', letterSpacing: '.04em' }}
                onClick={() => {
                  // 서버 모드는 계정 삭제가 콘솔 소관이라 안내를 거치는 모달로 (사용자 확정)
                  if (serverOn2) { setDelMember({ id: m.id, nickname: m.nickname }); return; }
                  del.ask(`회원 「${m.nickname}」 계정을 삭제하시겠습니까?`, () => {
                    const reg = { ...registry };
                    delete reg[m.id];
                    try { localStorage.setItem('ohome.mockreg.v1', JSON.stringify(reg)); } catch { /* 무시 */ }
                    setRegVer(v => v + 1);
                    toast('계정이 삭제되었습니다');
                  }, '이 계정으로 다시 로그인할 수 없게 됩니다. 작성한 글은 그대로 남습니다.');
                }}>DELETE</button>
            )}
          </div>
        );
      })}
      {filteredMembers.length === 0 && (
        <p className="hint" style={{ margin: '10px 0 0' }}>조건에 맞는 회원이 없습니다</p>
      )}
      {filteredMembers.length > PER_MEMBERS && (
        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'center' }}>
          <Pager page={mPage} total={Math.ceil(filteredMembers.length / PER_MEMBERS)} onChange={setMPage} />
        </div>
      )}
      {/* 회원 내보내기 — 계정 삭제는 콘솔에서만 되므로 두 단계를 한 흐름으로 안내 (v2.0 사용자 확정) */}
      <ConfirmModal open={delMember !== null} title={`회원 「${delMember?.nickname ?? ''}」 내보내기`}
        wide
        body={
          <div style={{ display: 'grid', gap: 10 }}>
            <p style={{ margin: 0 }}>
              <b>① 먼저 로그인 계정을 지웁니다.</b><br />
              계정 삭제는 관리자 권한이 필요한 작업이라 홈에서는 할 수 없습니다
              (그럴 수 있게 만들면 홈에 넣은 관리자 키가 공개돼 누구나 남의 계정을 지울 수 있게 됩니다).
              아래 버튼으로 콘솔을 열어 <b>{delMember?.nickname}</b> 계정을 지워 주세요.
            </p>
            <p style={{ margin: 0 }}>
              <b>② 그다음 목록에서 지웁니다.</b><br />
              계정을 지우지 않고 목록에서만 지우면 <b>그 사람은 계속 로그인할 수 있습니다.</b>
              작성한 글은 어느 쪽이든 그대로 남습니다.
            </p>
          </div>
        }
        onClose={() => setDelMember(null)}
        buttons={[
          ...(authConsoleUrl ? [{
            label: '① 콘솔에서 계정 지우기 ↗', kind: 'dark' as const,
            onClick: () => window.open(authConsoleUrl, '_blank', 'noopener'),
          }] : []),
          {
            label: '② 목록에서 지우기', kind: 'accent' as const,
            onClick: () => {
              const t = delMember;
              setDelMember(null);
              if (!t) return;
              void backend()?.deleteMember(t.id)
                .then(() => { setRemovedIds(v => [...v, t.id]); toast('회원 목록에서 지웠습니다'); })
                .catch(() => toast('지우지 못했습니다 — 관리자 계정으로 로그인했는지 확인해 주세요'));
            },
          },
          { label: 'CANCEL', kind: 'ghost' as const, onClick: () => setDelMember(null) },
        ]} />
      {del.element}
      {/* 포크는 GitHub이 자동으로 동기화해 주지 않는다 — 원본 저장소에 업데이트가 올라와도
          내 포크·배포에는 반영 안 된 채로 남는다(오늘 만든 기능이 안 보이는 흔한 원인, v2.0 사용자 요청).
          자격 증명은 전혀 다루지 않고, 저장해 둔 내 포크 주소로 이동만 시켜 준다 — 거기서
          [Sync fork] 버튼 한 번이면 끝 */}
      {serverOn2 && <ConfigScopeWarnRow />}
      {/* 웹푸시 서버 키 (자놀 이식) — 회원이 정보수정에서 켤 수 있으려면 관리자가 한 번 등록해야 한다 */}
      {serverOn2 && <div className="set-sec"><PushAdminRow /></div>}
      {serverOn2 && <ForkUpdateRow />}
      {/* 설치를 이미 마친 뒤에도 보안 규칙이 바뀔 때(버전 업데이트 등) 다시 붙여넣을 수 있게 —
          예전엔 최초 설치 화면에만 있어서 재설치 없이는 갱신된 규칙을 볼 방법이 없었다 (v2.0) */}
      {serverOn2 && <SecurityRulesRow />}
    </div>
  );
}
