'use client';
import { useEffect, useMemo, useRef, useState } from 'react';
import { KInput, KTextarea, KCheck } from '@/components/ui/Kit';
import { ConfirmModal, Modal } from '@/components/ui/Modal';
import { exportBackup, importBackup, resetGroups, RESET_CONTENT, RESET_EXTRA } from '@/lib/backup';
import { Character, CHAR_SEED, Relation, REL_SEED } from '@/lib/charStore';
import { useLocalList } from '@/lib/postStore';
import { useToast } from '@/components/ui/Toast';
import { pushLocalSettings, unsyncedSettingKeys, SETTING_KEYS } from '@/lib/settingStore';
import { isServerMode, createBackend, backend } from '@/lib/backend';
import type { BackendConfig, BackendKind } from '@/lib/backend/types';
import { validateConfig, configFileText, saveLocalConfig, parseFirebaseSnippet } from '@/lib/serverConfig';
import { migrateTo, findOrphanFiles, backfillThumbs } from '@/lib/transfer';

/** 데이터 백업 탭 (5.2) — 백업(데이터만/회원까지) · 복원 · 선택 초기화 (v1.9 사용자 확정) */
export function DataPane() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [resetOpen, setResetOpen] = useState(false);   // 초기화 항목 선택 모달 (v1.9)
  const [resetAsk, setResetAsk] = useState(false);     // 최종 확인
  const [picked, setPicked] = useState<string[]>([]);  // 선택한 초기화 그룹
  const [pushing, setPushing] = useState(false);       // 설정 서버 업로드 중 (v2.0)
  const serverOn = isServerMode();
  // 서버에 아직 없는 로컬 설정 — 로컬로 먼저 꾸민 뒤 서버를 붙인 경우에만 생긴다.
  // 보통의 설치(연결 먼저)에서는 설정이 바뀔 때마다 서버로 나가므로 이 줄 자체가 뜨지 않는다.
  const [unsynced, setUnsynced] = useState<string[]>([]);
  useEffect(() => { setUnsynced(unsyncedSettingKeys()); }, []);

  // 사용하지 않는 이미지 정리 (v2.0) — 글을 지워도 저장소에는 파일이 남는다.
  // 같은 이미지를 다른 글이 쓰고 있을 수 있어 자동 삭제는 위험하므로, 훑어서 보여 주고 관리자가 지운다.
  const [orphans, setOrphans] = useState<{ ref: string; size: number }[] | null>(null);
  const [scanning, setScanning] = useState(false);
  const [cleanAsk, setCleanAsk] = useState(false);
  const orphanMB = (orphans ?? []).reduce((s, f) => s + f.size, 0) / 1048576;

  const scanOrphans = async () => {
    const be = backend();
    if (!be) { toast('서버에 연결돼 있지 않습니다'); return; }
    setScanning(true);
    try {
      const rows = await findOrphanFiles(be);
      setOrphans(rows);
      toast(rows.length ? `쓰지 않는 이미지 ${rows.length}개를 찾았습니다` : '정리할 이미지가 없습니다');
    } catch (e) {
      // 멈춘 이유를 그대로 보여 준다 (v2.0) — 「권한 문제」로 뭉뚱그리면 진짜 원인을 놓친다
      toast(e instanceof Error && e.message
        ? e.message
        : '이미지 목록을 읽지 못했습니다 — 저장소 권한(규칙)을 확인해 주세요');
    }
    setScanning(false);
  };

  const cleanOrphans = async () => {
    const be = backend();
    if (!be || !orphans) return;
    setScanning(true);
    let n = 0;
    for (const f of orphans) {
      try { await be.deleteFile(f.ref); n += 1; } catch { /* 개별 실패는 건너뜀 */ }
    }
    setOrphans(null);
    setScanning(false);
    toast(`이미지 ${n}개를 지웠습니다`);
  };

  /* 기존 이미지 썸네일 만들기 (v2.1) — 썸네일 기능 이전에 올린 이미지는 목록에서도 원본(수 MB)을 받는다.
     원본을 한 번씩 받아 작은 사본을 만들어 두면 그 뒤로는 목록이 사본만 받는다 */
  const [thumbBusy, setThumbBusy] = useState(false);
  const [thumbMsg, setThumbMsg] = useState('');
  const thumbStop = useRef(false);
  const runThumbs = async () => {
    const be = backend();
    if (!be) { toast('서버에 연결돼 있지 않습니다'); return; }
    thumbStop.current = false;
    setThumbBusy(true); setThumbMsg('');
    try {
      const r = await backfillThumbs(be, (m, done, total) => setThumbMsg(total ? `${m} ${done}/${total}` : m),
        () => thumbStop.current);
      const mb = (r.savedBytes / 1048576).toFixed(1);
      setThumbMsg(r.total ? `만듦 ${r.made} · 필요 없음 ${r.skipped}${r.failed ? ` · 실패 ${r.failed}` : ''}` : '만들 것 없음');
      toast(r.total === 0 ? '썸네일을 만들 이미지가 없습니다'
        : `${r.stopped ? '멈춤 — ' : ''}썸네일 ${r.made}개를 만들었습니다 (목록 한 번에 ${mb}MB 덜 받음)`
          + (r.failed ? ` · ${r.failed}개는 받지 못했습니다 — 다시 누르면 이어서 합니다` : ''));
    } catch (e) {
      toast(e instanceof Error && e.message ? e.message : '썸네일을 만들지 못했습니다');
    }
    setThumbBusy(false);
  };

  /* 어디에도 안 걸린 상대 캐릭터 정리 (v2.0 사용자 요청).
     자관을 지워도 그 자관에서 만든 상대 캐릭터는 남는다. **일부러 그렇게 둔다** — 실수로 자관을
     지웠을 때 캐릭터까지 사라지면 되돌릴 방법이 없기 때문(사용자 판단). 대신 정말 아무 자관에도
     안 걸린 것만 골라 여기서 지운다. 내 캐릭터(own)는 자관과 무관하게 존재하므로 건드리지 않는다. */
  const [chars, setChars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [charAsk, setCharAsk] = useState(false);
  const orphanChars = useMemo(() => {
    const used = new Set<string>();
    rels.forEach(r => r.members.forEach(m => used.add(m.charId)));
    return chars.filter(c => !c.own && !used.has(c.id));
  }, [chars, rels]);

  const cleanChars = () => {
    const gone = new Set(orphanChars.map(c => c.id));
    setChars(chars.filter(c => !gone.has(c.id)));
    toast(`상대 캐릭터 ${gone.size}명을 지웠습니다`);
  };

  // 이 브라우저에 저장돼 있던 사이트 설정을 서버로 올린다 (연결 직후 1회면 충분)
  const doPush = async () => {
    setPushing(true);
    try {
      // 콘텐츠 키(글 목록 등)가 설정 테이블로 들어가지 않게 설정 키 목록만 올린다
      const n = await pushLocalSettings(SETTING_KEYS);
      toast(n > 0 ? `설정 ${n}건을 서버에 올렸습니다 — 방문자에게도 같은 모습으로 보입니다` : '올릴 설정이 없습니다');
      setUnsynced(unsyncedSettingKeys());
    } catch {
      toast('설정 업로드에 실패했습니다 — 관리자 계정으로 로그인했는지 확인해 주세요');
    }
    setPushing(false);
  };
  const toggle = (k: string, v: boolean) => setPicked(p => (v ? [...new Set([...p, k])] : p.filter(x => x !== k)));

  /* ---------- 데이터베이스 이전 (v2.0) — 다른 프로젝트/다른 서비스로 통째 옮기기 ---------- */
  const [migOpen, setMigOpen] = useState(false);
  const [migKind, setMigKind] = useState<BackendKind>('supabase');
  const [migSb, setMigSb] = useState({ url: '', anonKey: '' });
  const [migFb, setMigFb] = useState({ apiKey: '', authDomain: '', projectId: '', storageBucket: '', appId: '' });
  const [migState, setMigState] = useState<'idle' | 'checking' | 'ready' | 'running' | 'done'>('idle');
  const [migMsg, setMigMsg] = useState('');

  const migCfg = (): BackendConfig => (migKind === 'firebase'
    ? {
        kind: 'firebase',
        apiKey: migFb.apiKey.trim(),
        authDomain: migFb.authDomain.trim() || `${migFb.projectId.trim()}.firebaseapp.com`,
        projectId: migFb.projectId.trim(),
        storageBucket: migFb.storageBucket.trim() || `${migFb.projectId.trim()}.appspot.com`,
        appId: migFb.appId.trim(),
      }
    : { kind: 'supabase', url: migSb.url.trim(), anonKey: migSb.anonKey.trim() });

  const migCheck = async () => {
    const bad = validateConfig(migCfg());
    if (bad) { setMigMsg(bad); setMigState('idle'); return; }
    setMigState('checking'); setMigMsg('');
    try {
      const be = await createBackend(migCfg());
      const r = await be.check();
      setMigMsg(r.message);
      setMigState(r.ok ? 'ready' : 'idle');
    } catch (e) {
      setMigMsg(`연결에 실패했습니다 — ${(e as { message?: string })?.message ?? ''}`);
      setMigState('idle');
    }
  };

  const migRun = async () => {
    setMigState('running');
    try {
      const target = await createBackend(migCfg());
      const r = await migrateTo(target, (m, done, total) => {
        setMigMsg(total ? `${m} (${done}/${total})` : m);
      });
      setMigMsg(`이전 완료 — 항목 ${r.items}건 · 이미지 ${r.files}개. 아래 설정 파일을 저장소에 올리면 방문자도 새 DB를 봅니다.`);
      setMigState('done');
    } catch (e) {
      setMigMsg(`이전에 실패했습니다 — ${(e as { message?: string })?.message ?? ''}`);
      setMigState('ready');
    }
  };

  const migDownloadConfig = () => {
    const blob = new Blob([configFileText(migCfg())], { type: 'application/json' });
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u; a.download = 'ohome.config.json';
    a.click();
    URL.revokeObjectURL(u);
  };

  const migSwitch = () => {
    saveLocalConfig(migCfg());
    toast('새 데이터베이스로 전환합니다 — 새로고침');
    setTimeout(() => window.location.reload(), 700);
  };

  const doExport = async (includeMembers: boolean) => {
    setBusy(true);
    try {
      const { blob, dataCount, blobCount } = await exportBackup(includeMembers);
      const u = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = u;
      a.download = `ohome-backup${includeMembers ? '-with-members' : ''}-${new Date().toISOString().slice(0, 10)}.zip`;
      a.click();
      URL.revokeObjectURL(u);
      toast(`백업 완료 — 데이터 ${dataCount}건 · 이미지 ${blobCount}개${includeMembers ? ' · 회원 포함' : ''}`);
    } catch {
      toast('백업 생성에 실패했습니다');
    }
    setBusy(false);
  };

  const doImport = async () => {
    if (!importFile) return;
    setBusy(true);
    try {
      await importBackup(importFile);
      toast('복원 완료 — 새로고침합니다');
      setTimeout(() => window.location.reload(), 800);
    } catch {
      toast('복원에 실패했습니다 — 파일을 확인해 주세요');
      setBusy(false);
    }
  };

  return (
    <div className="set-sec">
      <h3>데이터 백업</h3>
      <div className="d">글·캐릭터·자관·역극 등 모든 데이터(JSON)와 이미지 전부를 zip 하나로 — 다른 브라우저/PC 이전용</div>

      {/* 로컬로 먼저 꾸민 뒤 서버를 붙인 경우에만 — 서버에 없는 설정이 남아 있을 때만 나타난다 (v2.0) */}
      {serverOn && unsynced.length > 0 && (
        <div className="set-row" style={{ flexWrap: 'wrap' }}>
          <div className="l"><b>서버에 올리지 않은 설정 {unsynced.length}건</b><small>서버를 붙이기 전에 이 브라우저에서 꾸민 설정입니다 — 올려야 방문자에게도 같은 모습으로 보입니다</small></div>
          <button className="btn btn-ghost" style={{ padding: '9px 18px', opacity: pushing ? 0.5 : 1 }}
            disabled={pushing} onClick={doPush}>{pushing ? '올리는 중…' : '↑ 설정 올리기'}</button>
        </div>
      )}
      {/* 쓰지 않는 이미지 정리 (v2.0) — 글을 지워도 저장소 파일은 남는다 */}
      {serverOn && (
        <div className="set-row" style={{ flexWrap: 'wrap' }}>
          <div className="l"><b>쓰지 않는 이미지 정리</b>
            <small>글을 지워도 이미지는 저장소에 남습니다 — 어디에서도 쓰지 않는 파일만 골라 지웁니다</small></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {orphans && (
              <span className="hint">
                {orphans.length > 0 ? `${orphans.length}개 · ${orphanMB.toFixed(1)}MB` : '정리할 것 없음'}
              </span>
            )}
            <button className="btn btn-ghost" style={{ padding: '9px 18px', opacity: scanning ? 0.5 : 1 }}
              disabled={scanning} onClick={scanOrphans}>{scanning ? '확인 중…' : '찾아보기'}</button>
            {orphans && orphans.length > 0 && (
              <button className="btn btn-accent" style={{ padding: '9px 18px', opacity: scanning ? 0.5 : 1 }}
                disabled={scanning} onClick={() => setCleanAsk(true)}>{orphans.length}개 지우기</button>
            )}
          </div>
        </div>
      )}
      {/* 기존 이미지 썸네일 만들기 (v2.1) — 원본·글은 그대로, 목록용 작은 사본만 추가 */}
      {serverOn && (
        <div className="set-row" style={{ flexWrap: 'wrap' }}>
          <div className="l"><b>기존 이미지 썸네일 만들기</b>
            <small>예전에 올린 이미지도 목록에서 작은 사본을 쓰게 합니다 — 원본을 한 번씩 내려받으므로 그만큼 다운로드 용량이 듭니다(위 정리를 먼저 하면 덜 받습니다). 멈춰도 다시 누르면 이어서 합니다</small></div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            {thumbMsg && <span className="hint">{thumbMsg}</span>}
            {thumbBusy
              ? <button className="btn btn-ghost" style={{ padding: '9px 18px' }}
                  onClick={() => { thumbStop.current = true; }}>멈추기</button>
              : <button className="btn btn-ghost" style={{ padding: '9px 18px' }} onClick={runThumbs}>만들기</button>}
          </div>
        </div>
      )}
      {/* 어디에도 안 걸린 상대 캐릭터 정리 (v2.0 사용자 요청) — 자관을 지워도 캐릭터는 일부러 남긴다.
          실수로 지웠을 때 되돌릴 수 있게. 정말 안 쓰는 것만 여기서 골라 지운다 */}
      <div className="set-row" style={{ flexWrap: 'wrap' }}>
        <div className="l"><b>등록되지 않은 상대 캐릭터 정리</b>
          <small>자관을 지워도 상대 캐릭터는 남습니다(실수로 지웠을 때를 위해) — 어느 자관에도 없는 캐릭터만 골라 지웁니다</small></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className="hint">
            {orphanChars.length > 0 ? `${orphanChars.length}명` : '정리할 것 없음'}
          </span>
          {orphanChars.length > 0 && (
            <button className="btn btn-accent" style={{ padding: '9px 18px' }}
              onClick={() => setCharAsk(true)}>{orphanChars.length}명 지우기</button>
          )}
        </div>
      </div>

      {/* 백업 두 갈래 (v1.9 사용자 확정) — 회원 계정 포함 여부 선택 */}
      <div className="set-row" style={{ flexWrap: 'wrap' }}>
        <div className="l"><b>백업 내보내기</b><small>글·캐릭터·설정 + 이미지 → zip · 회원 계정(가입자·가입코드) 포함 여부 선택</small></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="btn btn-accent" style={{ padding: '9px 18px', opacity: busy ? 0.5 : 1 }}
            disabled={busy} onClick={() => doExport(false)}>↓ 데이터만</button>
          <button className="btn btn-ghost" style={{ padding: '9px 18px', opacity: busy ? 0.5 : 1 }}
            disabled={busy} onClick={() => doExport(true)}>↓ 회원까지</button>
        </div>
      </div>
      {/* Firebase Storage는 다른 주소에서 파일을 읽는 것을 기본적으로 막는다 —
          홈에서 보는 데는 지장이 없지만 백업·이전은 파일을 직접 받아와야 해서 한 번 열어 줘야 한다 */}
      {serverOn && backend()?.kind === 'firebase' && (
        <p className="hint" style={{ margin: '10px 0 16px' }}>
          Firebase는 <b>저장소 CORS를 한 번 열어야</b> 백업 zip에 이미지가 담깁니다 — 안 하면 글·설정만 담깁니다.
          설치 가이드의 「백업」 항목에 브라우저에서 끝내는 방법이 있습니다.
        </p>
      )}
      <div className="set-row" style={{ flexWrap: 'wrap' }}>
        <div className="l"><b>백업 가져오기 (복원)</b><small>현재 데이터를 백업 내용으로 덮어씁니다 — 복원 후 자동 새로고침</small></div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <input id="bkImport" type="file" accept=".zip" style={{ display: 'none' }}
            onChange={e => { setImportFile(e.target.files?.[0] ?? null); e.target.value = ''; }} />
          <button className="btn btn-ghost" style={{ height: 35, padding: '0 14px', fontSize: 11 }}
            onClick={() => document.getElementById('bkImport')?.click()}>
            {importFile ? importFile.name : '파일 선택'}
          </button>
          {importFile && (
            <button className="btn btn-dark" style={{ padding: '0 18px', fontSize: 11, opacity: busy ? 0.5 : 1 }}
              disabled={busy} onClick={doImport}>RESTORE</button>
          )}
        </div>
      </div>

      {/* 데이터베이스 이전 (v2.0) — 새 프로젝트·다른 서비스로 통째 옮기기 */}
      <div className="set-row" style={{ flexWrap: 'wrap' }}>
        <div className="l"><b>데이터베이스 이전</b><small>다른 프로젝트나 다른 서비스(Supabase ↔ Firebase)로 글·설정·이미지를 통째로 옮깁니다</small></div>
        <button className="btn btn-ghost" style={{ padding: '9px 20px' }}
          onClick={() => { setMigOpen(true); setMigState('idle'); setMigMsg(''); }}>이전하기</button>
      </div>

      <Modal open={migOpen} onClose={() => setMigOpen(false)} title="데이터베이스 이전"
        desc="옮길 곳의 연결 정보를 넣고 확인한 뒤 시작합니다 — 지금 데이터는 그대로 두고 복사합니다"
        actions={<>
          <button className="btn btn-ghost" onClick={() => setMigOpen(false)}>CLOSE</button>
          {migState === 'ready' && <button className="btn btn-accent" onClick={migRun}>이전 시작</button>}
          {migState === 'done' && <button className="btn btn-accent" onClick={migSwitch}>새 DB로 전환</button>}
        </>}>
        <div className="mini-seg" style={{ marginBottom: 12 }}>
          <button className={migKind === 'supabase' ? 'on' : ''} onClick={() => setMigKind('supabase')}>Supabase</button>
          <button className={migKind === 'firebase' ? 'on' : ''} onClick={() => setMigKind('firebase')}>Firebase</button>
        </div>

        {migKind === 'supabase' ? (
          <div style={{ display: 'grid', gap: 8 }}>
            <label className="k-label">Project URL</label>
            <KInput value={migSb.url} onChange={e => setMigSb(s => ({ ...s, url: e.target.value }))} placeholder="https://xxxx.supabase.co" />
            <label className="k-label">anon public key</label>
            <KInput value={migSb.anonKey} onChange={e => setMigSb(s => ({ ...s, anonKey: e.target.value }))} />
            <p className="hint" style={{ margin: 0 }}>새 프로젝트라면 먼저 스키마 SQL을 실행해 두세요 — 설치 화면과 같은 내용입니다.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            <label className="k-label">설정 붙여넣기 (firebaseConfig)</label>
            <KTextarea style={{ minHeight: 84, fontFamily: 'ui-monospace, Consolas, monospace', fontSize: 11.5 }}
              onChange={e => {
                const v = parseFirebaseSnippet(e.target.value);
                if (v) setMigFb(f => ({
                  apiKey: v.apiKey ?? f.apiKey, authDomain: v.authDomain ?? f.authDomain,
                  projectId: v.projectId ?? f.projectId, storageBucket: v.storageBucket ?? f.storageBucket,
                  appId: v.appId ?? f.appId,
                }));
              }} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <div><label className="k-label">apiKey</label><KInput value={migFb.apiKey} onChange={e => setMigFb(f => ({ ...f, apiKey: e.target.value }))} /></div>
              <div><label className="k-label">projectId</label><KInput value={migFb.projectId} onChange={e => setMigFb(f => ({ ...f, projectId: e.target.value }))} /></div>
            </div>
            <div><label className="k-label">appId</label><KInput value={migFb.appId} onChange={e => setMigFb(f => ({ ...f, appId: e.target.value }))} /></div>
            <p className="hint" style={{ margin: 0 }}>새 프로젝트라면 Firestore·Storage 보안 규칙을 먼저 붙여넣어 두세요.</p>
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, flexWrap: 'wrap' }}>
          <button className="btn btn-dark" style={{ height: 33, padding: '0 16px', fontSize: 11 }}
            disabled={migState === 'checking' || migState === 'running'} onClick={migCheck}>
            {migState === 'checking' ? '확인 중…' : '연결 확인'}
          </button>
          {migState === 'done' && (
            <button className="btn btn-ghost" style={{ height: 33, padding: '0 14px', fontSize: 11 }}
              onClick={migDownloadConfig}>ohome.config.json 내려받기</button>
          )}
        </div>
        {migMsg && (
          <p className={migState === 'done' || migState === 'ready' ? 'setup-ok' : 'setup-err'} style={{ marginTop: 10 }}>
            {migMsg}
          </p>
        )}
      </Modal>

      {/* 선택 초기화 (v1.9 사용자 확정) — 메뉴별 체크 + 사이트 설정·이미지·회원 계정 별도 선택 */}
      <div className="set-row">
        <div className="l"><b>초기화</b><small>지울 항목을 골라서 — 메뉴별 데이터 / 사이트 설정 / 이미지 / 회원 계정 (복구 불가, 백업을 먼저 내보내 두세요)</small></div>
        <button className="btn btn-ghost" style={{ padding: '9px 20px', color: 'var(--accent)' }}
          onClick={() => { setPicked([]); setResetOpen(true); }}>RESET</button>
      </div>

      <Modal open={resetOpen} onClose={() => setResetOpen(false)} title="초기화할 항목 선택"
        desc="체크한 항목만 삭제됩니다 — 회원 계정을 빼면 가입 회원·관리자 계정은 그대로 유지됩니다"
        actions={<>
          <button className="btn btn-ghost" onClick={() => setResetOpen(false)}>CANCEL</button>
          <button className="btn btn-accent" disabled={picked.length === 0}
            style={{ opacity: picked.length === 0 ? 0.45 : 1 }}
            onClick={() => { setResetOpen(false); setResetAsk(true); }}>선택 항목 초기화</button>
        </>}>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}
            onClick={() => setPicked(RESET_CONTENT.map(g => g.key))}>메뉴 데이터 전체</button>
          <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}
            onClick={() => setPicked([...RESET_CONTENT, ...RESET_EXTRA].map(g => g.key))}>전부 선택</button>
          <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11, marginLeft: 'auto' }}
            onClick={() => setPicked([])}>전부 해제</button>
        </div>
        <label className="k-label">메뉴별 데이터</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, margin: '6px 0 4px' }}>
          {RESET_CONTENT.map(g => (
            <KCheck key={g.key} label={g.label} checked={picked.includes(g.key)}
              onChange={v => toggle(g.key, v)} />
          ))}
        </div>
        <div style={{ height: 1, background: 'var(--line)', margin: '14px 0 12px' }} />
        <div style={{ display: 'grid', gap: 9 }}>
          {RESET_EXTRA.map(g => (
            <KCheck key={g.key} checked={picked.includes(g.key)} onChange={v => toggle(g.key, v)}
              label={<span>
                <b style={{ fontSize: 12.5 }}>{g.label}</b>{' '}
                <small style={{ color: 'var(--faint)', fontSize: 10.5 }}>{g.desc}</small>
              </span>} />
          ))}
        </div>
      </Modal>

      <ConfirmModal open={cleanAsk} title={`쓰지 않는 이미지 ${orphans?.length ?? 0}개를 지울까요?`}
        body={`저장소에서 ${orphanMB.toFixed(1)}MB를 비웁니다. 지금 글·캐릭터·설정 어디에서도 참조하지 않는 파일만 골랐지만, 지운 파일은 복구할 수 없습니다. 걱정되면 먼저 백업을 받아 두세요.`}
        onClose={() => setCleanAsk(false)}
        buttons={[
          { label: '지우기', kind: 'accent', onClick: () => { setCleanAsk(false); void cleanOrphans(); } },
          { label: 'CANCEL', kind: 'ghost', onClick: () => setCleanAsk(false) },
        ]} />

      {/* 지울 캐릭터 이름을 그대로 보여 준다 (v2.0) — 개수만으로는 무엇이 사라지는지 알 수 없다 */}
      <ConfirmModal open={charAsk} title={`상대 캐릭터 ${orphanChars.length}명을 지울까요?`}
        body={`${orphanChars.slice(0, 12).map(c => c.name).join(', ')}${orphanChars.length > 12 ? ` 외 ${orphanChars.length - 12}명` : ''} — 어느 자관에도 등록돼 있지 않은 캐릭터입니다. 지우면 복구할 수 없습니다.`}
        onClose={() => setCharAsk(false)}
        buttons={[
          { label: '지우기', kind: 'accent', onClick: () => { setCharAsk(false); cleanChars(); } },
          { label: 'CANCEL', kind: 'ghost', onClick: () => setCharAsk(false) },
        ]} />

      <ConfirmModal open={resetAsk} title="선택한 항목을 초기화할까요?"
        body={`지울 항목: ${[...RESET_CONTENT, ...RESET_EXTRA].filter(g => picked.includes(g.key)).map(g => g.label).join(' · ')}\n삭제한 내용은 복구할 수 없습니다.`}
        onClose={() => setResetAsk(false)}
        buttons={[
          { label: '초기화', kind: 'accent', onClick: () => {
            // 서버 모드에서는 DB에서도 지우므로 끝난 뒤에 새로고침 (v2.0)
            setResetAsk(false);
            toast('초기화하는 중…');
            void resetGroups(picked)
              .then(r => {
                // 실패를 숨기면 "지웠다"고 나오는데 서버에는 그대로 남는다 — 건수를 그대로 알린다
                if (r.failed.length) {
                  toast(`${r.failed.length}건을 서버에서 지우지 못했습니다 — 로그인·보안 규칙을 확인해 주세요`);
                } else if (serverOn) {
                  const part = [`글 ${r.rows}건`];
                  if (r.files) part.push(`이미지 ${r.files}개`);
                  if (r.members) part.push(`회원 ${r.members}명`);
                  toast(`서버에서 ${part.join(' · ')}를 지웠습니다${r.members ? ' (로그인 계정은 콘솔에서 지워 주세요)' : ''}`);
                } else {
                  toast('선택한 항목을 초기화했습니다 — 새로고침합니다');
                }
              })
              .catch(() => { toast('초기화에 실패했습니다 — 로그인 상태를 확인해 주세요'); })
              .finally(() => setTimeout(() => window.location.reload(), 1400));
          } },
          { label: 'CANCEL', kind: 'ghost', onClick: () => setResetAsk(false) },
        ]} />
    </div>
  );
}
