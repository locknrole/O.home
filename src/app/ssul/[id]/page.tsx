'use client';
// 썰 상세 — 카톡 대화 그대로. 관리자는 편집 모드에서 메시지 수정·삭제, 제목·AU·태그·공개범위를 고친다.
// 본문은 이 썰 하나만 받아 온다(fetchBody) — 목록 화면이 2년치 대화를 통째로 받지 않게.
import React, { useEffect, useMemo, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLocalList } from '@/lib/postStore';
import { Relation, REL_SEED, Character, CHAR_SEED, Visibility, relPath } from '@/lib/charStore';
import {
  Ssul, SSUL_KEY, SSUL_SEED, SsulBody, SsulMsg, fmtRange, auChoices, auKeyOf, splitAuKey, fetchBody, saveBodies, storedVis, useSsulFavs,
} from '@/lib/ssulStore';
import { KInput, KSelect } from '@/components/ui/Kit';
import { PageTitle } from '@/components/ui/PageText';
import { useConfirmDelete } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { ChatView } from '@/components/ssul/ChatView';
import { SsulNavigator, type NavPick } from '@/components/ssul/SsulNavigator';

const VIS_OPTIONS = [
  { value: 'public', label: '전체공개' },
  { value: 'member', label: '멤버공개' },
  { value: 'private', label: '나만보기' },
];

interface EditState { title: string; summary: string; au: string; tags: string[]; visibility: Visibility; password: string; msgs: SsulMsg[] }

export default function SsulDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const toast = useToast();
  const { isAdmin, user } = useAuth();
  const fav = useSsulFavs(user?.id);
  const del = useConfirmDelete();
  const [ssuls, setSsuls, loaded] = useLocalList<Ssul>(SSUL_KEY, SSUL_SEED);
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [chars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  const aus = useMemo(() => auChoices(rels, chars), [rels, chars]);
  const s = ssuls.find(x => x.id === id);

  const [body, setBody] = useState<SsulBody | null | undefined>(undefined);
  const [ed, setEd] = useState<EditState | null>(null);
  const [tagIn, setTagIn] = useState('');
  const [saving, setSaving] = useState(false);
  // 내비게이터에서 고른 키워드·AU — 다른 썰로 옮겨 가면 풀린다
  const [pick, setPick] = useState<NavPick>(null);
  useEffect(() => { setPick(null); }, [id]);
  // 비밀번호 썰 — 맞히면 이 탭을 닫을 때까지 열람 유지 (TRPG 로그와 같은 방식)
  const [unlocked, setUnlocked] = useState(false);
  const [pwTry, setPwTry] = useState('');
  useEffect(() => {
    try { setUnlocked(sessionStorage.getItem(`ssul-unlock:${id}`) === '1'); } catch { /* 무시 */ }
  }, [id]);

  useEffect(() => {
    let alive = true;
    setBody(undefined);
    fetchBody(id).then(b => { if (alive) setBody(b); }).catch(() => { if (alive) setBody(null); });
    return () => { alive = false; };
  }, [id]);

  // 앞뒤 썰 (채팅 날짜 순)
  const sorted = useMemo(() => [...ssuls].sort((a, b) => a.start.localeCompare(b.start)), [ssuls]);
  const at = sorted.findIndex(x => x.id === id);
  const prev = at > 0 ? sorted[at - 1] : undefined;
  const next = at >= 0 && at < sorted.length - 1 ? sorted[at + 1] : undefined;

  if (!loaded) return <section className="page" />;
  if (!s) {
    return (
      <section className="page">
        <div className="page-head"><PageTitle>SSUL</PageTitle><p>썰을 찾을 수 없습니다 — 지워졌거나 볼 수 있는 권한이 없습니다</p></div>
        <button className="btn btn-ghost" onClick={() => router.push('/ssul')}>목록으로</button>
      </section>
    );
  }

  if (s.password && !isAdmin && !unlocked) {
    const tryUnlock = () => {
      if (pwTry === s.password) {
        setUnlocked(true);
        try { sessionStorage.setItem(`ssul-unlock:${id}`, '1'); } catch { /* 무시 */ }
      } else toast('비밀번호가 올바르지 않습니다');
    };
    return (
      <section className="page">
        <div className="page-head"><PageTitle>SSUL</PageTitle><p>{fmtRange(s)} · 🔒 비밀번호를 입력하면 열람할 수 있습니다</p></div>
        <div className="panel" style={{ maxWidth: 420, margin: '0 auto', padding: 26, display: 'grid', gap: 10 }}>
          <h2 className="ssul-title" style={{ fontSize: 18 }}>{s.title}</h2>
          <KInput type="password" placeholder="비밀번호" value={pwTry} onChange={e => setPwTry(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') tryUnlock(); }} autoFocus />
          <button className="btn btn-dark" style={{ justifyContent: 'center', padding: 9 }} onClick={tryUnlock}>확인</button>
          <button className="btn btn-ghost" style={{ justifyContent: 'center', padding: 9 }} onClick={() => router.push('/ssul')}>목록으로</button>
        </div>
      </section>
    );
  }

  const au = aus.find(a => a.key === auKeyOf(s));
  const rel = s.relId ? rels.find(r => r.id === s.relId) : undefined;

  const startEdit = () => {
    if (!body) return;
    setEd({ title: s.title, summary: s.summary ?? '', au: auKeyOf(s), tags: [...s.tags], visibility: s.visibility, password: s.password ?? '', msgs: body.msgs.map(m => ({ ...m })) });
  };

  async function save() {
    if (!ed || !s || !body) return;
    if (!ed.msgs.length) { toast('메시지가 하나도 없으면 저장할 수 없습니다 — 썰 자체를 삭제해 주세요'); return; }
    setSaving(true);
    try {
      const password = ed.password.trim() || undefined;
      const vis = storedVis(ed.visibility, password);
      const nextBody: SsulBody = { id: s.id, msgs: ed.msgs, visibility: vis };
      await saveBodies([body], [nextBody]);
      const { relId, auId } = splitAuKey(ed.au);
      const upd: Ssul = {
        ...s, title: ed.title.trim() || s.title, summary: ed.summary.trim() || undefined, relId, auId,
        tags: ed.tags, visibility: vis, password,
        start: ed.msgs[0].at, end: ed.msgs[ed.msgs.length - 1].at, count: ed.msgs.length,
      };
      setSsuls(ssuls.map(x => (x.id === s.id ? upd : x)));
      setBody(nextBody);
      setEd(null);
      toast('저장했습니다');
    } catch (e) {
      toast(e instanceof Error ? e.message : '저장하지 못했습니다');
    } finally { setSaving(false); }
  }

  function remove() {
    del.ask('이 썰을 삭제할까요?', async () => {
      try {
        if (body) await saveBodies([body], []);
        setSsuls(ssuls.filter(x => x.id !== s!.id));
        router.push('/ssul');
      } catch (e) { toast(e instanceof Error ? e.message : '삭제하지 못했습니다'); }
    }, '대화 본문까지 지워집니다. 같은 기간을 다시 올려도 업로드 기록 때문에 건너뛰니, 다시 올리려면 업로드 기록도 함께 고려해 주세요.');
  }

  const addTag = () => {
    const t = tagIn.trim().replace(/^#/, '');
    if (t && ed && !ed.tags.includes(t)) setEd({ ...ed, tags: [...ed.tags, t] });
    setTagIn('');
  };

  const view = ed ?? { title: s.title, summary: s.summary ?? '', tags: s.tags };

  return (
    <section className="page ssul-detail">
      <div className="page-head">
        <PageTitle>SSUL</PageTitle>
        <p>{fmtRange(s)} · {s.partner} · {s.count}개 메시지</p>
        <div className="head-actions">
          {isAdmin && !ed && <button className="btn btn-ghost" disabled={!body} onClick={startEdit}>편집</button>}
          {isAdmin && ed && (
            <>
              <button className="btn btn-ghost" onClick={remove}>삭제</button>
              <button className="btn btn-ghost" onClick={() => setEd(null)}>취소</button>
              <button className="btn btn-dark" disabled={saving} onClick={save}>{saving ? '저장 중…' : '저장'}</button>
            </>
          )}
          {!ed && <button className="btn btn-ghost" onClick={() => router.push('/ssul')}>목록</button>}
        </div>
      </div>

      <div className="ssul-detail-grid">
      <div className="sd-main">
      <div className="panel ssul-head">
        {ed ? (
          <div style={{ display: 'grid', gap: 9 }}>
            <KInput value={ed.title} onChange={e => setEd({ ...ed, title: e.target.value })} placeholder="제목" style={{ fontWeight: 600, fontSize: 16 }} />
            <KInput value={ed.summary} onChange={e => setEd({ ...ed, summary: e.target.value })} placeholder="한 줄 요약 (선택)" />
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <KSelect minWidth={190} value={ed.au} onChange={v => setEd({ ...ed, au: v })}
                options={[{ value: '', label: 'AU 없음' }, ...aus.map(a => ({ value: a.key, label: a.label }))]} />
              {ed.password.trim()
                ? <span className="pill" style={{ alignSelf: 'center' }}>🔒 비밀번호로 열람</span>
                : <KSelect minWidth={120} value={ed.visibility} onChange={v => setEd({ ...ed, visibility: v as Visibility })} options={VIS_OPTIONS} />}
              <KInput value={ed.password} onChange={e => setEd({ ...ed, password: e.target.value })} autoComplete="off"
                placeholder="열람 비밀번호 (비우면 없음)" style={{ maxWidth: 200 }} />
            </div>
            <div className="si-tags">
              {ed.tags.map(t => (
                <span key={t} className="pill">#{t} <a className="ssul-x" onClick={() => setEd({ ...ed, tags: ed.tags.filter(x => x !== t) })}>✕</a></span>
              ))}
              <KInput value={tagIn} onChange={e => setTagIn(e.target.value)} placeholder="태그 추가 (Enter)" style={{ maxWidth: 180 }}
                onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) { e.preventDefault(); addTag(); } }} onBlur={addTag} />
            </div>
          </div>
        ) : (
          <>
            <h2 className="ssul-title">
              {fav.enabled && (
                <button className={`ssul-star ${fav.ids.has(s.id) ? 'on' : ''}`} title={fav.ids.has(s.id) ? '즐겨찾기 해제' : '즐겨찾기'}
                  onClick={() => fav.toggle(s.id)}>{fav.ids.has(s.id) ? '★' : '☆'}</button>
              )}
              {view.title}
            </h2>
            {view.summary && <p className="si-sum">{view.summary}</p>}
            <div className="si-tags">
              {au && rel && <span className="pill dark" onClick={() => router.push(`${relPath(rel)}${s.auId ? `?au=${s.auId}` : ''}`)}>{au.label}</span>}
              {s.visibility !== 'public' && <span className="pill">{s.visibility === 'member' ? '멤버공개' : '나만보기'}</span>}
              {s.password && <span className="pill">🔒 비밀번호</span>}
              {view.tags.map(t => (
                <span key={t} className={`pill ${pick && 'tag' in pick && pick.tag === t ? 'red' : ''}`} style={{ cursor: 'var(--cur-pointer,pointer)' }}
                  title="같은 키워드의 다른 썰" onClick={() => setPick(pick && 'tag' in pick && pick.tag === t ? null : { tag: t })}>#{t}</span>
              ))}
            </div>
          </>
        )}
      </div>

      <div className="panel ssul-body">
        {body === undefined && <p className="hint" style={{ textAlign: 'center' }}>불러오는 중…</p>}
        {body === null && <p className="hint" style={{ textAlign: 'center' }}>대화 본문을 불러오지 못했습니다</p>}
        {body && (
          <ChatView msgs={ed ? ed.msgs : body.msgs} me={s.me} editing={!!ed}
            onEdit={(k, text) => ed && setEd({ ...ed, msgs: ed.msgs.map((m, j) => (j === k ? { ...m, text, edited: true } : m)) })}
            onDelete={k => ed && setEd({ ...ed, msgs: ed.msgs.filter((_, j) => j !== k) })} />
        )}
      </div>

      {!ed && (prev || next) && (
        <div className="ssul-nav">
          {prev ? <a onClick={() => router.push(`/ssul/${prev.id}`)}>‹ {prev.title}</a> : <span />}
          {next ? <a onClick={() => router.push(`/ssul/${next.id}`)}>{next.title} ›</a> : <span />}
        </div>
      )}
      </div>
      {/* 편집 중엔 숨긴다 — 저장 안 한 채로 다른 썰로 넘어가지 않게 */}
      {!ed && <SsulNavigator ssuls={ssuls} current={s} aus={aus} pick={pick} onPick={setPick} onGo={x => router.push(`/ssul/${x}`)} />}
      </div>
      {del.element}
    </section>
  );
}
