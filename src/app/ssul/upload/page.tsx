'use client';
// 썰 업로드 — 카톡 내보내기 파일 → 파싱 → 세션 분할 → Claude 판별 → 검토 → 저장.
//
//   1) 파일 고르기: .txt / .csv, 또는 모바일 「모든 메시지 내보내기」 .zip (사진까지). 사진 파일만 따로 같이 골라도 된다
//   2) 나·상대 확인 — 이 상대와 올린 적이 있으면 **그 마지막 대화 이후만** 분석한다 (토큰·중복 방지)
//   3) [썰 추출] — 글이 거의 없는 세션은 보내지도 않고, 나머지를 묶어 /api/ssul/analyze 로
//   4) 결과 목록에서 제외·제목·AU·태그·공개범위 손보고 [업로드]
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLocalList, newId } from '@/lib/postStore';
import { putBlob } from '@/lib/blobStore';
import { Relation, REL_SEED, Character, CHAR_SEED, Visibility } from '@/lib/charStore';
import {
  Ssul, SSUL_KEY, SSUL_SEED, SsulImport, SSUL_IMP_KEY, SSUL_IMP_SEED, SsulBody, SsulMsg,
  lastImportedAt, fmtDay, fmtRange, auChoices, splitAuKey, auKeyOf, fetchBody, saveBodies,
  useSsulDict, normTags, renameMsgs, ssulErrText, VIS_OPTIONS, postSsulApi, runPool, type SsulDict,
} from '@/lib/ssulStore';
import { parseKakao, type KakaoMsg, type ParseResult } from '@/lib/kakao/parse';
import { splitSessions, type Session } from '@/lib/kakao/segment';
import {
  sessionText, isTrivial, batchSessions, buildDrafts, msgLine, partKey, daySpan,
  type Draft,
} from '@/lib/kakao/analyze';
import type { AnalyzeRequest, AnalyzeResponse, AnalyzeResult, PrevSsul } from '@/lib/kakao/api';
import { decodeLogText } from '@/lib/galleryStore';
import { KInput, KSelect, KCheck } from '@/components/ui/Kit';
import { PageTitle } from '@/components/ui/PageText';
import { FileDrop } from '@/components/ui/FileDrop';
import { useToast } from '@/components/ui/Toast';
import { ChatView } from '@/components/ssul/ChatView';
import { SsulManage } from '@/components/ssul/SsulManage';

const ME_KEY = 'ohome.ssul.me';
const CONCURRENCY = 3;   // 판별 요청을 동시에 몇 개까지

interface Row extends Draft {
  include: boolean;
  visibility: Visibility;
  open: boolean;
  tagText: string;
}

/** 파일들 → 대화 텍스트 + 사진 파일 맵 (zip이면 풀어서) */
async function readInputs(files: File[]): Promise<{ chat: { text: string; name: string } | null; media: Map<string, Blob> }> {
  const media = new Map<string, Blob>();
  let chat: { text: string; name: string } | null = null;
  const isImg = (n: string) => /\.(jpe?g|png|gif|webp|heic|mp4|mov)$/i.test(n);
  for (const f of files) {
    if (/\.zip$/i.test(f.name)) {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(f);
      for (const entry of Object.values(zip.files)) {
        if (entry.dir) continue;
        const base = entry.name.split('/').pop() ?? entry.name;
        if (/\.(txt|csv)$/i.test(base) && !chat) {
          const buf = await entry.async('uint8array');
          chat = { text: new TextDecoder('utf-8').decode(buf), name: base };
        } else if (isImg(base)) media.set(base, await entry.async('blob'));
      }
    } else if (/\.(txt|csv)$/i.test(f.name) && !chat) {
      chat = { text: await decodeLogText(f), name: f.name };
    } else if (isImg(f.name)) media.set(f.name, f);
  }
  return { chat, media };
}

export default function SsulUploadPage() {
  const router = useRouter();
  const toast = useToast();
  const { isAdmin, ready } = useAuth();
  const [ssuls, setSsuls] = useLocalList<Ssul>(SSUL_KEY, SSUL_SEED);
  const [imps, setImps] = useLocalList<SsulImport>(SSUL_IMP_KEY, SSUL_IMP_SEED);
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [chars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  const aus = useMemo(() => auChoices(rels, chars), [rels, chars]);
  /** 이름·키워드 사전 — 업로드할 때 자동 적용, 아래 「썰 관리」에서 고친다 */
  const [dict, setDict] = useSsulDict();
  const auOpts = useMemo(() => [{ value: '', label: 'AU 없음' }, ...aus.map(a => ({ value: a.key, label: a.label }))], [aus]);

  const [fileName, setFileName] = useState('');
  const [parsed, setParsed] = useState<ParseResult | null>(null);
  const [media, setMedia] = useState<Map<string, Blob>>(new Map());
  const [me, setMe] = useState('');
  const [partner, setPartner] = useState('');
  const [gapMin, setGapMin] = useState('180');
  const [defVis, setDefVis] = useState<Visibility>('public');

  const [phase, setPhase] = useState<'idle' | 'analyzing' | 'review' | 'saving'>('idle');
  const [progress, setProgress] = useState({ done: 0, total: 0 });
  const [error, setError] = useState('');
  const [rows, setRows] = useState<Row[]>([]);
  const resultsRef = useRef<Map<string, AnalyzeResult>>(new Map());
  const stopRef = useRef(false);

  const senders = useMemo(
    () => [...new Set((parsed?.msgs ?? []).filter(m => m.sender).map(m => m.sender))],
    [parsed],
  );
  const lastAt = partner ? lastImportedAt(imps, partner) : null;

  /** 분석 대상 — 지난 업로드 이후 메시지만, 순번을 다시 매겨서 (세션·잘라내기 순번이 배열 위치와 같아야 한다) */
  const fresh: KakaoMsg[] = useMemo(() => {
    const all = parsed?.msgs ?? [];
    return (lastAt ? all.filter(m => m.at > lastAt) : all).map((m, k) => ({ ...m, i: k }));
  }, [parsed, lastAt]);
  const sessions: Session[] = useMemo(() => splitSessions(fresh, { gapMin: Math.max(10, Number(gapMin) || 180) }), [fresh, gapMin]);
  const candidates = useMemo(() => sessions.filter(s => !isTrivial(s)), [sessions]);
  const sendChars = useMemo(() => candidates.reduce((n, s) => n + Math.min(s.chars * 1.15, 12_000), 0), [candidates]);

  // 분석 중 창을 닫으면 결과가 사라진다
  useEffect(() => {
    if (phase !== 'analyzing' && phase !== 'review') return;
    const h = (e: BeforeUnloadEvent) => { e.preventDefault(); };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [phase]);

  if (ready && !isAdmin) {
    return <section className="page"><div className="page-head"><PageTitle>SSUL UPLOAD</PageTitle><p>관리자만 업로드할 수 있습니다</p></div></section>;
  }

  async function onFiles(files: File[]) {
    setError('');
    const { chat, media: found } = await readInputs(files);
    if (!chat) {
      // 대화 파일을 먼저 올리고 사진만 따로 더 놓은 경우 — 사진만 보탠다
      if (parsed && found.size) { setMedia(m => new Map([...m, ...found])); toast(`사진 ${found.size}개를 더했습니다`); return; }
      toast('카카오톡 대화 파일(.txt / .csv / .zip)을 찾지 못했습니다'); return;
    }
    const p = parseKakao(chat.text);
    if (!p.msgs.length) { toast('대화를 읽지 못했습니다 — 카카오톡 「대화 내보내기」 파일인지 확인해 주세요'); return; }
    setParsed(p); setFileName(chat.name); setMedia(m => new Map([...m, ...found]));
    setRows([]); resultsRef.current = new Map(); setPhase('idle');
    const ss = [...new Set(p.msgs.filter(m => m.sender).map(m => m.sender))];
    let saved = '';
    try { saved = localStorage.getItem(ME_KEY) ?? ''; } catch { /* 무시 */ }
    const meName = ss.includes(saved) ? saved : (ss.find(s => s !== p.title) ?? ss[0] ?? '');
    setMe(meName);
    // 상대: 1:1이면 대화방 제목, 아니면 나 빼고 나머지 이름
    setPartner(p.title || ss.filter(s => s !== meName).join(', '));
  }

  /** 이전 썰(이 상대) 중 최근 것 — 첫 세션이 그 이야기를 잇는지 판단할 재료 */
  const prevExisting = (): PrevSsul[] => ssuls
    .filter(s => s.partner === partner).sort((a, b) => a.end.localeCompare(b.end)).slice(-3)
    .map(s => ({ id: s.id, title: s.title, au: auKeyOf(s), end: s.end, tail: s.summary ?? '' }));

  async function analyze() {
    if (!candidates.length) { setRows([]); setPhase('review'); return; }
    try { localStorage.setItem(ME_KEY, me); } catch { /* 무시 */ }
    setError(''); setPhase('analyzing'); stopRef.current = false;
    const items = candidates.map(s => ({ id: s.id, text: sessionText(fresh, s, me) }));
    const batches = batchSessions(items).filter(b => b.some(it => !resultsRef.current.has(it.id)));
    const already = candidates.length - batches.reduce((n, b) => n + b.length, 0);
    setProgress({ done: already, total: candidates.length });
    const tags = [...new Set(ssuls.flatMap(s => s.tags))].slice(0, 200);
    const base = prevExisting();
    const fromOf = new Map(sessions.map(x => [x.id, x.from]));

    const failed = await runPool(batches, CONCURRENCY, async batch => {
      // 앞 묶음에서 이미 나온 썰 중 이 묶음보다 앞선 것 — 묶음 경계를 넘는 이어짐 판단용
      const firstFrom = fromOf.get(batch[0].id)!;
      const earlier = [...resultsRef.current.values()]
        .flatMap(r => r.ssuls.map((p, k) => ({ ...p, key: partKey(r.id, k) })))
        .filter(p => p.to < firstFrom)
        .sort((x, y) => x.from - y.from)
        .slice(-3)
        .map(p => ({
          id: p.key, title: p.title, au: p.au, end: fresh[p.to]?.at ?? '',
          tail: fresh.slice(Math.max(p.from, p.to - 2), p.to + 1).map(m => msgLine(m, me)).join(' / '),
        }));
      const res = await postSsulApi<AnalyzeResponse>('analyze', {
        me, partner, sessions: batch, tags, prev: [...base, ...earlier].slice(-4),
        aus: aus.map(x => ({ key: x.key, label: x.label, chars: x.chars })),
      } satisfies AnalyzeRequest);
      if (!res.ok) return res.error;
      res.data.results.forEach(r => resultsRef.current.set(r.id, r));
      // 모델이 빠뜨린 세션은 잡담으로 (다시 보내지 않게)
      batch.forEach(it => { if (!resultsRef.current.has(it.id)) resultsRef.current.set(it.id, { id: it.id, ssuls: [] } satisfies AnalyzeResult); });
      setProgress(p => ({ ...p, done: p.done + batch.length }));
    }, () => stopRef.current);

    if (failed || stopRef.current) {
      setError(failed ? ssulErrText(failed) : '분석을 멈췄습니다');
      setPhase('idle');
      return;
    }
    const drafts = buildDrafts(fresh, sessions, [...resultsRef.current.values()], new Set(base.map(p => p.id)));
    setRows(drafts.map(d => ({ ...d, include: true, visibility: defVis, open: false, tagText: normTags(d.tags, dict).join(', ') })));
    setPhase('review');
  }

  const patch = (key: string, p: Partial<Row>) => setRows(rs => rs.map(r => (r.key === key ? { ...r, ...p } : r)));

  /** 사진 파일이 같이 올라왔으면 저장소에 올려 메시지에 붙인다 */
  async function withPhotos(msgs: KakaoMsg[]): Promise<SsulMsg[]> {
    const out: SsulMsg[] = [];
    for (const m of msgs) {
      const file = m.media?.file;
      const blob = file ? media.get(file) : undefined;
      if (blob && m.kind === 'photo') {
        const src = await putBlob(blob);
        out.push({ ...m, media: { ...m.media, srcs: [src] } });
      } else out.push({ ...m });
    }
    return out;
  }

  async function upload() {
    const picked = rows.filter(r => r.include);
    setPhase('saving');
    try {
      const now = new Date().toISOString();
      const newItems: Ssul[] = [];
      const newBodies: SsulBody[] = [];
      let listNext = [...ssuls];
      for (const r of picked) {
        const msgs = renameMsgs(await withPhotos(r.msgs), dict.names);
        const tags = normTags(r.tagText.split(','), dict);
        const { relId, auId } = splitAuKey(r.au);
        const host = r.appendTo ? listNext.find(s => s.id === r.appendTo) : undefined;
        if (host) {
          // 이전 업로드의 썰에 이어 붙이기 — 본문을 받아 뒤에 붙이고 목록 문서의 끝 시각·개수를 고친다
          const old = await fetchBody(host.id);
          const merged = [...(old?.msgs ?? []), ...msgs];
          await saveBodies(old ? [old] : [], [{ id: host.id, msgs: merged, visibility: host.visibility }]);
          const upd: Ssul = { ...host, end: msgs[msgs.length - 1].at, count: merged.length, tags: [...new Set([...host.tags, ...tags])] };
          listNext = listNext.map(s => (s.id === host.id ? upd : s));
          continue;
        }
        const id = newId();
        const vis = r.visibility;
        newItems.push({
          id, title: r.title.trim() || '제목 없음', summary: r.summary, partner, me: dict.names[me]?.trim() || me,
          start: msgs[0].at, end: msgs[msgs.length - 1].at, count: msgs.length,
          relId, auId, tags, visibility: vis, createdAt: now,
        });
        newBodies.push({ id, msgs, visibility: vis });
      }
      // 본문 먼저 — 목록이 먼저 뜨면 잠깐 「본문 없음」 썰이 보인다
      if (newBodies.length) await saveBodies([], newBodies);
      setSsuls([...listNext, ...newItems]);
      if (fresh.length) {
        setImps([...imps, {
          id: newId(), partner, file: fileName, from: fresh[0].at, to: fresh[fresh.length - 1].at,
          ssuls: picked.length, at: now, visibility: 'private',
        }]);
      }
      toast(`썰 ${picked.length}개를 저장했습니다`);
      router.push('/ssul');
    } catch (e) {
      setPhase('review');
      toast(e instanceof Error ? e.message : '저장하지 못했습니다');
    }
  }

  const includedN = rows.filter(r => r.include).length;
  const photoN = media.size;

  return (
    <section className="page ssul-up">
      <div className="page-head">
        <PageTitle>SSUL UPLOAD</PageTitle>
        <p>카카오톡 대화 내보내기 파일을 올리면 썰만 골라 정리합니다 · 잡담은 저장하지 않습니다</p>
        <div className="head-actions">
          <button className="btn btn-ghost" onClick={() => router.push('/ssul')}>목록으로</button>
        </div>
      </div>

      <div className="panel" style={{ marginBottom: 16 }}>
        <FileDrop accept=".txt,.csv,.zip,image/*,video/*" multiple onFiles={onFiles}
          label={fileName ? `${fileName}${photoN ? ` · 사진 ${photoN}개` : ''} — 다른 파일로 바꾸려면 다시 놓기` : '대화 파일 (.txt / .csv / .zip) — 사진을 같이 올리려면 zip 또는 사진 파일도 함께'} />
        <p className="hint">
          PC 카톡: 채팅방 ≡ → 대화 내용 → 대화 내보내기 (.txt) · 모바일: 채팅방 ≡ → ⚙ → 대화 내용 내보내기 → 「모든 메시지 내부저장소에 저장」(.zip, 사진 포함).
          이모티콘은 카톡이 그림을 내보내지 않아 「이모티콘」 표시로만 남습니다.
        </p>
      </div>

      {parsed && (
        <div className="panel" style={{ marginBottom: 16 }}>
          <div className="ssul-up-grid">
            <div><small>대화</small><b>{parsed.msgs.length.toLocaleString()}개</b><span>{fmtDay(parsed.msgs[0].at)} ~ {fmtDay(parsed.msgs[parsed.msgs.length - 1].at)}</span></div>
            <div>
              <small>나</small>
              <KSelect minWidth={140} value={me} onChange={setMe} options={senders.map(s => ({ value: s, label: s }))} />
            </div>
            <div>
              <small>상대 (같은 상대면 이름을 맞춰 주세요)</small>
              <KInput value={partner} onChange={e => setPartner(e.target.value)} list="ssul-partners" />
              <datalist id="ssul-partners">{[...new Set(imps.map(i => i.partner))].map(p => <option key={p} value={p} />)}</datalist>
            </div>
            <div>
              <small>세션 자르는 간격 (분)</small>
              <KInput value={gapMin} onChange={e => setGapMin(e.target.value.replace(/\D/g, ''))} style={{ maxWidth: 90 }} />
            </div>
          </div>
          <p className="hint" style={{ marginTop: 12 }}>
            {lastAt
              ? <>이 상대와 <b>{fmtDay(lastAt)} {lastAt.slice(11)}</b>까지 올린 기록이 있어, 그 이후 <b>{fresh.length.toLocaleString()}개</b>만 분석합니다.</>
              : <>이 상대와 올린 기록이 없어 전체를 분석합니다.</>}
            {' '}세션 {sessions.length.toLocaleString()}개 중 글이 거의 없는 {sessions.length - candidates.length}개는 바로 잡담으로 처리하고,
            {' '}<b>{candidates.length}개</b>(약 {Math.round(sendChars).toLocaleString()}자)를 판별에 보냅니다.
          </p>
          {senders.some(n => dict.names[n]?.trim()) && (
            <p className="hint">이름 바꾸기 적용: {senders.filter(n => dict.names[n]?.trim()).map(n => `${n} → ${dict.names[n]}`).join(', ')} <small>(아래 「썰 관리」에서 수정)</small></p>
          )}
          {parsed.orphans.length > 0 && <p className="hint" style={{ color: 'var(--accent)' }}>읽지 못한 줄 {parsed.orphans.length}개 — 형식이 다를 수 있습니다: {parsed.orphans[0].slice(0, 60)}</p>}
          <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
            {phase === 'analyzing' ? (
              <>
                <div className="ssul-progress"><i style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
                <small style={{ color: 'var(--faint)', whiteSpace: 'nowrap' }}>{progress.done} / {progress.total}</small>
                <button className="btn btn-ghost" onClick={() => { stopRef.current = true; }}>멈춤</button>
              </>
            ) : (
              <button className="btn btn-dark" disabled={!me || !partner.trim() || phase === 'saving' || !fresh.length} onClick={analyze}>
                {resultsRef.current.size && phase === 'idle' ? '이어서 분석' : phase === 'review' ? '다시 분석' : '썰 추출'}
              </button>
            )}
            {error && <small style={{ color: 'var(--accent)' }}>{error}</small>}
          </div>
        </div>
      )}

      {phase !== 'idle' && phase !== 'analyzing' && (
        <>
          <div className="ssul-up-bar">
            <b>찾은 썰 {rows.length}개</b>
            <small>잡담만 있던 세션 {sessions.length - new Set(rows.flatMap(r => r.sessionIds.map(k => k.slice(0, k.lastIndexOf('#'))))).size}개 제외됨</small>
            <span style={{ flex: 1 }} />
            <small>새 썰 공개범위</small>
            <KSelect minWidth={110} value={defVis} onChange={v => { setDefVis(v as Visibility); setRows(rs => rs.map(r => ({ ...r, visibility: v as Visibility }))); }} options={VIS_OPTIONS} />
            <button className="btn btn-dark" disabled={phase === 'saving' || !includedN} onClick={upload}>
              {phase === 'saving' ? '저장 중…' : `업로드 (${includedN})`}
            </button>
          </div>
          {rows.length === 0 && <div className="panel" style={{ textAlign: 'center', padding: 40, color: 'var(--faint)', fontSize: 13 }}>이 구간에서는 썰을 찾지 못했습니다</div>}
          <div className="ssul-drafts">
            {rows.map(r => {
              const host = r.appendTo ? ssuls.find(s => s.id === r.appendTo) : undefined;
              return (
                <div key={r.key} className={`panel ssul-draft ${r.include ? '' : 'off'}`}>
                  <div className="sd-head">
                    <KCheck label="" checked={r.include} onChange={v => patch(r.key, { include: v })} />
                    <KInput value={r.title} onChange={e => patch(r.key, { title: e.target.value })} disabled={!!host} style={{ flex: 1, fontWeight: 600 }} />
                    <small className="sd-date">{fmtRange({ start: r.msgs[0].at, end: r.msgs[r.msgs.length - 1].at })} · {r.msgs.length}개{daySpan(r.msgs) > 1 ? ` · ${daySpan(r.msgs)}일에 걸침` : r.sessionIds.length > 1 ? ' · 잡담 빼고 이어 붙임' : ''}</small>
                  </div>
                  {host ? (
                    <p className="hint" style={{ margin: '8px 0 0' }}>
                      이전에 올린 「{host.title}」의 이어지는 부분으로 보여 그 썰 뒤에 붙입니다.{' '}
                      <a style={{ cursor: 'var(--cur-pointer,pointer)', textDecoration: 'underline' }} onClick={() => patch(r.key, { appendTo: undefined })}>따로 저장</a>
                    </p>
                  ) : (
                    <>
                      {r.summary && <p className="sd-sum">{r.summary}</p>}
                      <div className="sd-fields">
                        <KSelect minWidth={170} value={r.au} onChange={v => patch(r.key, { au: v })} options={auOpts} />
                        <KInput placeholder="태그 (쉼표로 구분)" value={r.tagText} onChange={e => patch(r.key, { tagText: e.target.value })} style={{ flex: 1 }} />
                        <KSelect minWidth={110} value={r.visibility} onChange={v => patch(r.key, { visibility: v as Visibility })} options={VIS_OPTIONS} />
                      </div>
                    </>
                  )}
                  <button className="sd-toggle" onClick={() => patch(r.key, { open: !r.open })}>{r.open ? '대화 접기 ▲' : '대화 보기 ▼'}</button>
                  {r.open && <div className="sd-chat"><ChatView msgs={renameMsgs(r.msgs, dict.names)} me={dict.names[me]?.trim() || me} /></div>}
                </div>
              );
            })}
          </div>
        </>
      )}

      <SsulManage ssuls={ssuls} setSsuls={setSsuls} imps={imps} setImps={setImps} dict={dict} setDict={setDict}
        draftTags={rows.filter(r => r.include && !r.appendTo).flatMap(r => r.tagText.split(',').map(t => t.trim()).filter(Boolean))}
        onDict={(nd: SsulDict) => setRows(rs => rs.map(r => ({ ...r, tagText: normTags(r.tagText.split(','), nd).join(', ') })))}
        knownNames={[...new Set([...senders, ...ssuls.flatMap(x => [x.me ?? '', x.partner])].filter(Boolean))]}
        aus={aus} />
    </section>
  );
}
