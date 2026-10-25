'use client';
// 썰 관리 (업로드 화면 아래) — 이름 바꾸기 · 키워드 정리 · 전체 삭제.
// 이름·키워드 규칙은 사전(SsulDict)에 남아 다음 업로드부터 자동 적용된다.
import React, { useMemo, useRef, useState } from 'react';
import { backend } from '@/lib/backend';
import {
  Ssul, SsulImport, SsulBody, SsulDict, fetchBody, saveBodies, normTags, renameMsgs,
} from '@/lib/ssulStore';
import { KInput, KCheck } from '@/components/ui/Kit';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import type { TagGroup, TagSuggestResponse } from '@/app/api/ssul/tags/route';
import type { RetagItem, RetagResponse } from '@/app/api/ssul/retag/route';
import { msgLine } from '@/lib/kakao/analyze';
import { auKeyOf, ssulErrText, fmtDay } from '@/lib/ssulStore';

export function SsulManage({ ssuls, setSsuls, imps, setImps, dict, setDict, draftTags, onDict, knownNames, aus }: {
  ssuls: Ssul[];
  setSsuls: (next: Ssul[]) => void;
  imps: SsulImport[];
  setImps: (next: SsulImport[]) => void;
  dict: SsulDict;
  setDict: (d: SsulDict) => void;
  /** 지금 업로드 중인 초안들의 키워드 (목록에 같이 센다) */
  draftTags: string[];
  /** 사전이 바뀌면 업로드 중인 초안에도 반영하라고 알린다 */
  onDict: (d: SsulDict) => void;
  /** 이름 바꾸기 후보 — 지금 파일의 화자 + 저장된 썰의 나·상대 */
  knownNames: string[];
  /** AU 이름표 — 키워드 다시 붙일 때 판별에 같이 보낸다 */
  aus: { key: string; label: string }[];
}) {
  const toast = useToast();

  /* ---------- 키워드 ---------- */
  const counts = useMemo(() => {
    const m = new Map<string, { saved: number; draft: number }>();
    ssuls.forEach(s => s.tags.forEach(t => { const c = m.get(t) ?? { saved: 0, draft: 0 }; c.saved++; m.set(t, c); }));
    draftTags.forEach(t => { const c = m.get(t) ?? { saved: 0, draft: 0 }; c.draft++; m.set(t, c); });
    return [...m.entries()].sort((a, b) => (b[1].saved + b[1].draft) - (a[1].saved + a[1].draft) || a[0].localeCompare(b[0]));
  }, [ssuls, draftTags]);
  const [pick, setPick] = useState<string | null>(null);
  const [to, setTo] = useState('');
  const [groups, setGroups] = useState<(TagGroup & { on: boolean })[] | null>(null);
  const [suggesting, setSuggesting] = useState(false);

  /** 사전을 바꾸고, 저장된 썰과 업로드 중인 초안의 키워드를 새 사전으로 다시 정리 */
  const applyDict = (nd: SsulDict, msg: string) => {
    setDict(nd);
    const next = ssuls.map(s => {
      const tags = normTags(s.tags, nd);
      return tags.join('\u0000') === s.tags.join('\u0000') ? s : { ...s, tags };
    });
    const changed = next.filter((s, i) => s !== ssuls[i]).length;
    if (changed) setSsuls(next);
    onDict(nd);
    toast(`${msg}${changed ? ` — 올린 썰 ${changed}개에 반영` : ''}`);
  };
  const replaceTag = (from: string, into: string) => {
    const t = into.trim().replace(/^#/, '');
    if (!t || t === from) return;
    const alias = { ...dict.alias, [from]: t };
    delete alias[t];   // 반대 방향 규칙이 있으면 끊는다 (돌고 도는 별칭 방지)
    applyDict({ ...dict, alias, blocked: dict.blocked.filter(b => b !== t) }, `「${from}」 → 「${t}」로 통일`);
    setPick(null); setTo('');
  };
  const deleteTag = (tag: string) => {
    applyDict({ ...dict, blocked: [...new Set([...dict.blocked, tag])] }, `「${tag}」 키워드를 지웠습니다`);
    setPick(null); setTo('');
  };

  async function suggest() {
    setSuggesting(true);
    try {
      const token = (await backend()?.authToken()) ?? '';
      const res = await fetch('/api/ssul/tags', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ tags: counts.map(([tag, c]) => ({ tag, count: c.saved + c.draft })) }),
      });
      const j = await res.json() as TagSuggestResponse;
      if (!res.ok || j.error) { toast(j.error === 'no-key' ? '서버에 ANTHROPIC_API_KEY가 없습니다' : `제안을 받지 못했습니다: ${j.error ?? res.status}`); return; }
      setGroups(j.groups.map(g => ({ ...g, on: true })));
      if (!j.groups.length) toast('통일할 만한 비슷한 키워드를 찾지 못했습니다');
    } catch (e) {
      toast(e instanceof Error ? e.message : '제안을 받지 못했습니다');
    } finally { setSuggesting(false); }
  }
  const applyGroups = () => {
    if (!groups) return;
    const alias = { ...dict.alias };
    let n = 0;
    for (const g of groups.filter(x => x.on)) {
      for (const m of g.members) if (m !== g.canonical) { alias[m] = g.canonical; n++; }
      delete alias[g.canonical];
    }
    applyDict({ ...dict, alias }, `키워드 ${n}개를 통일했습니다`);
    setGroups(null);
  };

  /* ---------- 이름 바꾸기 ---------- */
  const [nameFrom, setNameFrom] = useState('');
  const [nameTo, setNameTo] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null);
  const addName = () => {
    const f = nameFrom.trim(), t = nameTo.trim();
    if (!f || !t || f === t) return;
    setDict({ ...dict, names: { ...dict.names, [f]: t } });
    onDict({ ...dict, names: { ...dict.names, [f]: t } });
    setNameFrom(''); setNameTo('');
  };
  const dropName = (f: string) => {
    const names = { ...dict.names }; delete names[f];
    setDict({ ...dict, names }); onDict({ ...dict, names });
  };
  /** 이미 올린 썰의 대화에도 이름 규칙 적용 — 본문을 하나씩 받아 바뀐 것만 저장 */
  async function renameSaved() {
    const names = dict.names;
    if (!Object.keys(names).length) return;
    let done = 0, changed = 0;
    try {
      const nextList = [...ssuls];
      for (const s of ssuls) {
        setRenaming(`${++done} / ${ssuls.length}`);
        const b = await fetchBody(s.id);
        if (!b) continue;
        const msgs = renameMsgs(b.msgs, names);
        const me = s.me && names[s.me]?.trim() ? names[s.me].trim() : s.me;
        if (msgs.some((m, i) => m !== b.msgs[i])) { await saveBodies([b], [{ ...b, msgs }]); changed++; }
        if (me !== s.me) nextList[nextList.findIndex(x => x.id === s.id)] = { ...s, me };
      }
      setSsuls(nextList);
      toast(`올린 썰 ${changed}개의 이름을 바꿨습니다`);
    } catch (e) {
      toast(e instanceof Error ? e.message : '이름을 바꾸지 못했습니다');
    } finally { setRenaming(null); }
  }

  /* ---------- 키워드 다시 붙이기 — 저장된 썰 전체를 Claude에 다시 보내 새 키워드를 받고, 전/후를 보고 골라 적용 ---------- */
  const RETAG_BATCH = 8;          // 요청 하나에 실을 썰 수
  const RETAG_CAP = 6_000;        // 썰 하나당 보낼 대화 글자 (넘으면 앞 2/3 · 뒤 1/3)
  const [rt, setRt] = useState<{ phase: 'idle' | 'running' | 'review'; done: number; total: number; error: string }>({ phase: 'idle', done: 0, total: 0, error: '' });
  const rtResults = useRef<Map<string, string[]>>(new Map());
  const rtStop = useRef(false);
  const [rtKeep, setRtKeep] = useState(false);
  const [rtSel, setRtSel] = useState<Set<string>>(new Set());

  const cap = (lines: string[]) => {
    const full = lines.join('\n');
    if (full.length <= RETAG_CAP) return full;
    const head: string[] = [], tail: string[] = [];
    let n = 0;
    for (const l of lines) { if (n + l.length > RETAG_CAP * 2 / 3) break; head.push(l); n += l.length + 1; }
    n = 0;
    for (let k = lines.length - 1; k >= head.length; k--) { if (n + lines[k].length > RETAG_CAP / 3) break; tail.unshift(lines[k]); n += lines[k].length + 1; }
    return [...head, `… (중간 ${lines.length - head.length - tail.length}개 생략) …`, ...tail].join('\n');
  };
  /** 적용할 최종 키워드 — 「기존 유지」면 기존 + 새로, 아니면 새로만. 사전 규칙(통일·삭제)도 함께 */
  const finalTags = (s: Ssul) => {
    const fresh = rtResults.current.get(s.id) ?? [];
    return normTags(rtKeep ? [...s.tags, ...fresh] : fresh, dict);
  };
  const changed = (s: Ssul) => rtResults.current.has(s.id) && finalTags(s).join('|') !== s.tags.join('|');

  async function retag() {
    rtStop.current = false;
    const todo = [...ssuls].sort((a, b) => a.start.localeCompare(b.start)).filter(s => !rtResults.current.has(s.id));
    const batches: Ssul[][] = [];
    for (let i = 0; i < todo.length; i += RETAG_BATCH) batches.push(todo.slice(i, i + RETAG_BATCH));
    setRt({ phase: 'running', done: ssuls.length - todo.length, total: ssuls.length, error: '' });
    const token = (await backend()?.authToken()) ?? '';
    const tags = [...new Set(ssuls.flatMap(s => s.tags))].slice(0, 300);
    const auLabel = (s: Ssul) => aus.find(a => a.key === auKeyOf(s))?.label ?? '';
    let next = 0, failed = '';
    const worker = async () => {
      while (!failed && !rtStop.current && next < batches.length) {
        const batch = batches[next++];
        try {
          const items: RetagItem[] = [];
          for (const s of batch) {
            const b = await fetchBody(s.id);
            items.push({ id: s.id, title: s.title, summary: s.summary ?? '', au: auLabel(s), text: cap((b?.msgs ?? []).map(m => msgLine(m, s.me ?? ''))) });
          }
          const res = await fetch('/api/ssul/retag', {
            method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
            body: JSON.stringify({ items, tags }),
          });
          const j = await res.json() as RetagResponse;
          if (!res.ok || j.error) { failed = j.error || `HTTP ${res.status}`; return; }
          j.results.forEach(r => rtResults.current.set(r.id, r.tags));
          setRt(p => ({ ...p, done: p.done + batch.length }));
        } catch (e) { failed = e instanceof Error ? e.message : String(e); }
      }
    };
    await Promise.all(Array.from({ length: Math.min(3, batches.length) }, worker));
    if (failed || rtStop.current) {
      setRt(p => ({ ...p, phase: 'idle', error: failed ? ssulErrText(failed) : '멈췄습니다 — 다시 누르면 이어서 진행합니다' }));
      return;
    }
    setRtSel(new Set(ssuls.filter(changed).map(s => s.id)));
    setRt(p => ({ ...p, phase: 'review' }));
  }
  const applyRetag = () => {
    const next = ssuls.map(s => (rtSel.has(s.id) && changed(s) ? { ...s, tags: finalTags(s) } : s));
    const n = next.filter((s, i) => s !== ssuls[i]).length;
    setSsuls(next);
    toast(`썰 ${n}개의 키워드를 바꿨습니다`);
    rtResults.current = new Map();
    setRt({ phase: 'idle', done: 0, total: 0, error: '' });
  };
  const rtChanged = rt.phase === 'review' ? ssuls.filter(changed).sort((a, b) => a.start.localeCompare(b.start)) : [];

  /* ---------- 전체 삭제 ---------- */
  const [wipeOpen, setWipeOpen] = useState(false);
  const [wipeImps, setWipeImps] = useState(true);
  const [wipeText, setWipeText] = useState('');
  const [wiping, setWiping] = useState(false);
  async function wipe() {
    setWiping(true);
    try {
      // 본문 먼저 — 목록부터 지우면 본문이 주인 없이 남는다
      const stubs: SsulBody[] = ssuls.map(s => ({ id: s.id, msgs: [], visibility: s.visibility }));
      if (stubs.length) await saveBodies(stubs, []);
      setSsuls([]);
      if (wipeImps) setImps([]);
      toast(`썰 ${stubs.length}개를 모두 지웠습니다`);
      setWipeOpen(false); setWipeText('');
    } catch (e) {
      toast(e instanceof Error ? e.message : '지우지 못했습니다');
    } finally { setWiping(false); }
  }

  const rules = Object.entries(dict.alias);

  return (
    <div className="ssul-manage">
      <h3 className="sm-title">썰 관리</h3>

      {/* 이름 바꾸기 */}
      <div className="panel sm-sec">
        <h4>대화 속 이름 바꾸기</h4>
        <p className="hint" style={{ marginTop: 0 }}>카톡 닉네임을 홈에서 쓰는 이름으로 — 정해 두면 다음 업로드부터 자동으로 바뀝니다.</p>
        <div className="sm-row">
          <KInput placeholder="카톡 이름" value={nameFrom} onChange={e => setNameFrom(e.target.value)} list="ssul-known-names" style={{ maxWidth: 180 }} />
          <span>→</span>
          <KInput placeholder="바꿀 이름" value={nameTo} onChange={e => setNameTo(e.target.value)} style={{ maxWidth: 180 }}
            onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) addName(); }} />
          <button className="btn btn-ghost" onClick={addName}>추가</button>
          <datalist id="ssul-known-names">{knownNames.map(n => <option key={n} value={n} />)}</datalist>
        </div>
        {Object.keys(dict.names).length > 0 && (
          <div className="sm-chips">
            {Object.entries(dict.names).map(([f, t]) => (
              <span key={f} className="pill">{f} → <b>{t}</b> <a className="ssul-x" onClick={() => dropName(f)}>✕</a></span>
            ))}
          </div>
        )}
        <div className="sm-row" style={{ marginTop: 10 }}>
          <button className="btn btn-ghost" disabled={!!renaming || !ssuls.length || !Object.keys(dict.names).length} onClick={renameSaved}>
            {renaming ? `바꾸는 중… ${renaming}` : '이미 올린 썰에도 적용'}
          </button>
        </div>
      </div>

      {/* 키워드 정리 */}
      <div className="panel sm-sec">
        <h4>키워드 정리 <small>{counts.length}개</small></h4>
        <p className="hint" style={{ marginTop: 0 }}>
          키워드를 눌러 다른 키워드로 바꾸거나 지웁니다. 바꾼 규칙은 남아서, 다음 업로드에 같은 키워드가 나와도 자동으로 통일됩니다.
        </p>
        <div className="sm-row">
          <button className="btn btn-ghost" disabled={suggesting || counts.length < 2} onClick={suggest}>
            {suggesting ? '찾는 중…' : '비슷한 키워드 찾기'}
          </button>
        </div>
        {groups && groups.length > 0 && (
          <div className="sm-groups">
            {groups.map((g, gi) => (
              <div key={gi} className="sm-group">
                <KCheck label="" checked={g.on} onChange={v => setGroups(gs => gs!.map((x, j) => (j === gi ? { ...x, on: v } : x)))} />
                <span className="sm-members">
                  {g.members.map(m => (
                    <a key={m} className={`pill ${m === g.canonical ? 'dark' : ''}`} title="이 키워드로 통일"
                      onClick={() => setGroups(gs => gs!.map((x, j) => (j === gi ? { ...x, canonical: m } : x)))}>#{m}</a>
                  ))}
                </span>
                <small>→ <b>#{g.canonical}</b></small>
              </div>
            ))}
            <div className="sm-row">
              <button className="btn btn-dark" onClick={applyGroups}>선택한 묶음 통일</button>
              <button className="btn btn-ghost" onClick={() => setGroups(null)}>닫기</button>
              <small className="hint" style={{ margin: 0 }}>진한 키워드로 통일됩니다 — 다른 키워드를 누르면 그걸로 바뀝니다</small>
            </div>
          </div>
        )}
        <div className="sm-chips">
          {counts.map(([t, c]) => (
            <a key={t} className={`pill ${pick === t ? 'dark' : ''}`} onClick={() => { setPick(pick === t ? null : t); setTo(''); }}>
              #{t} <small>{c.saved}{c.draft ? `+${c.draft}` : ''}</small>
            </a>
          ))}
          {!counts.length && <small className="hint" style={{ margin: 0 }}>아직 키워드가 없습니다</small>}
        </div>
        {pick && (
          <div className="sm-row sm-edit">
            <b>#{pick}</b>
            <span>→</span>
            <KInput placeholder="바꿀 키워드 (기존 키워드 고르기 가능)" value={to} onChange={e => setTo(e.target.value)} list="ssul-all-tags" style={{ maxWidth: 220 }}
              onKeyDown={e => { if (e.key === 'Enter' && !e.nativeEvent.isComposing) replaceTag(pick, to); }} autoFocus />
            <datalist id="ssul-all-tags">{counts.filter(([t]) => t !== pick).map(([t]) => <option key={t} value={t} />)}</datalist>
            <button className="btn btn-dark" disabled={!to.trim()} onClick={() => replaceTag(pick, to)}>바꾸기</button>
            <button className="btn btn-ghost" onClick={() => deleteTag(pick)}>삭제</button>
          </div>
        )}
        {(rules.length > 0 || dict.blocked.length > 0) && (
          <details className="sm-rules">
            <summary>저장된 규칙 {rules.length + dict.blocked.length}개</summary>
            <div className="sm-chips">
              {rules.map(([f, t]) => (
                <span key={f} className="pill">{f} → {t} <a className="ssul-x" title="규칙만 지움 (이미 바뀐 키워드는 그대로)"
                  onClick={() => { const alias = { ...dict.alias }; delete alias[f]; setDict({ ...dict, alias }); }}>✕</a></span>
              ))}
              {dict.blocked.map(b => (
                <span key={b} className="pill">{b} 삭제 <a className="ssul-x" title="규칙만 지움"
                  onClick={() => setDict({ ...dict, blocked: dict.blocked.filter(x => x !== b) })}>✕</a></span>
              ))}
            </div>
          </details>
        )}
      </div>

      {/* 키워드 다시 붙이기 */}
      <div className="panel sm-sec">
        <h4>키워드 다시 붙이기</h4>
        <p className="hint" style={{ marginTop: 0 }}>
          올린 썰 {ssuls.length}개의 대화를 다시 읽혀 새 키워드를 받습니다 (썰마다 대화 최대 {RETAG_CAP.toLocaleString()}자).
          바로 바뀌지 않고, 전/후를 보고 고른 것만 적용됩니다. 저장된 통일·삭제 규칙도 함께 적용됩니다.
        </p>
        {rt.phase === 'running' ? (
          <div className="sm-row">
            <div className="ssul-progress"><i style={{ width: `${rt.total ? (rt.done / rt.total) * 100 : 0}%` }} /></div>
            <small style={{ color: 'var(--faint)', whiteSpace: 'nowrap' }}>{rt.done} / {rt.total}</small>
            <button className="btn btn-ghost" onClick={() => { rtStop.current = true; }}>멈춤</button>
          </div>
        ) : rt.phase === 'idle' ? (
          <div className="sm-row">
            <button className="btn btn-ghost" disabled={!ssuls.length} onClick={retag}>
              {rtResults.current.size ? `이어서 진행 (${rtResults.current.size}/${ssuls.length})` : '전체 썰 키워드 다시 붙이기'}
            </button>
            {rt.error && <small style={{ color: 'var(--accent)' }}>{rt.error}</small>}
          </div>
        ) : (
          <div className="sm-retag">
            <div className="sm-row">
              <b style={{ fontSize: 13 }}>바뀌는 썰 {rtChanged.length}개</b>
              <small className="hint" style={{ margin: 0 }}>그대로 {ssuls.length - rtChanged.length}개</small>
              <span style={{ flex: 1 }} />
              <KCheck label={<span style={{ fontSize: 12 }}>기존 키워드 유지하고 추가만</span>} checked={rtKeep} onChange={setRtKeep} />
            </div>
            <div className="sm-row">
              <a className="sm-link" onClick={() => setRtSel(new Set(rtChanged.map(s => s.id)))}>전체 선택</a>
              <a className="sm-link" onClick={() => setRtSel(new Set())}>전체 해제</a>
            </div>
            <div className="sm-retag-list">
              {rtChanged.map(s => (
                <div key={s.id} className={`sm-retag-row ${rtSel.has(s.id) ? '' : 'off'}`}>
                  <KCheck label="" checked={rtSel.has(s.id)} onChange={v => setRtSel(sel => { const n = new Set(sel); if (v) n.add(s.id); else n.delete(s.id); return n; })} />
                  <div style={{ minWidth: 0 }}>
                    <div className="sm-retag-title"><small>{fmtDay(s.start)}</small> {s.title}</div>
                    <div className="sm-retag-tags">
                      <span className="old">{s.tags.length ? s.tags.map(t => `#${t}`).join(' ') : '(없음)'}</span>
                      <span>→</span>
                      {finalTags(s).map(t => <span key={t} className={`pill ${s.tags.includes(t) ? '' : 'dark'}`}>#{t}</span>)}
                    </div>
                  </div>
                </div>
              ))}
              {!rtChanged.length && <p className="hint" style={{ margin: 0 }}>바뀌는 썰이 없습니다</p>}
            </div>
            <div className="sm-row">
              <button className="btn btn-dark" disabled={!rtChanged.some(s => rtSel.has(s.id))} onClick={applyRetag}>
                선택한 {rtChanged.filter(s => rtSel.has(s.id)).length}개 적용
              </button>
              <button className="btn btn-ghost" onClick={() => { rtResults.current = new Map(); setRt({ phase: 'idle', done: 0, total: 0, error: '' }); }}>버리기</button>
              <small className="hint" style={{ margin: 0 }}>진한 키워드가 새로 붙는 것입니다</small>
            </div>
          </div>
        )}
      </div>

      {/* 전체 삭제 */}
      <div className="panel sm-sec sm-danger">
        <h4>썰 전체 삭제</h4>
        <p className="hint" style={{ marginTop: 0 }}>올린 썰 {ssuls.length}개와 대화 본문을 모두 지웁니다. 되돌릴 수 없습니다.</p>
        <button className="btn btn-ghost" disabled={!ssuls.length && !imps.length} onClick={() => setWipeOpen(true)}>전체 삭제…</button>
      </div>

      <Modal open={wipeOpen} onClose={() => { if (!wiping) setWipeOpen(false); }} title="썰 전체 삭제" small
        actions={<>
          <button className="btn btn-ghost" disabled={wiping} onClick={() => setWipeOpen(false)}>CANCEL</button>
          <button className="btn btn-accent" disabled={wiping || wipeText.trim() !== '전체 삭제'} onClick={wipe}>{wiping ? '지우는 중…' : 'DELETE'}</button>
        </>}>
        <div style={{ display: 'grid', gap: 10, fontSize: 13, color: 'var(--sub)', lineHeight: 1.7 }}>
          <p style={{ margin: 0 }}>썰 <b>{ssuls.length}개</b>와 대화 본문이 모두 지워지며 복구할 수 없습니다. 이름·키워드 규칙은 남습니다.</p>
          <KCheck label={<span>업로드 기록도 지우기 — 같은 기간의 대화를 처음부터 다시 올릴 수 있게</span>} checked={wipeImps} onChange={setWipeImps} />
          <KInput placeholder="확인하려면 「전체 삭제」라고 입력" value={wipeText} onChange={e => setWipeText(e.target.value)} />
        </div>
      </Modal>
    </div>
  );
}
