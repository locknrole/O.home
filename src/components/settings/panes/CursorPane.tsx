'use client';
import { useEffect, useState } from 'react';
import { KStep, KToggle } from '@/components/ui/Kit';
import { useCursorSettings, CursorState, CURSOR_STATE_LABEL } from '@/lib/cursorStore';
import { getBlob } from '@/lib/blobStore';
import { parseAni } from '@/lib/aniCursor';
import { useToast } from '@/components/ui/Toast';
import { putBlob } from '@/lib/blobStore';

/** 커서 이미지 규격 맞추기 (v1.9 사용자 발견) — 브라우저는 128px를 넘는 이미지를 커서로 쓰지 못하고
 *  그냥 무시해 버려서, 커스텀 커서가 곳곳에서 시스템 커서로 되돌아가 "깨져 보이는" 원인이 된다.
 *  .cur/.ani는 자체 포맷이라 그대로 두고, 일반 이미지만 128px 이내로 줄인다. */
async function fitCursorImage(f: File): Promise<{ blob: Blob; resized: boolean }> {
  if (/\.(cur|ani)$/i.test(f.name)) return { blob: f, resized: false };
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((ok, no) => {
      const i = new Image();
      i.onload = () => ok(i); i.onerror = no; i.src = url;
    });
    const max = Math.max(img.width, img.height);
    if (max <= 128) return { blob: f, resized: false };
    const k = 128 / max;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(img.width * k));
    c.height = Math.max(1, Math.round(img.height * k));
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    const blob = await new Promise<Blob | null>(ok => c.toBlob(ok, 'image/png'));
    return blob ? { blob, resized: true } : { blob: f, resized: false };
  } catch {
    return { blob: f, resized: false };
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** 마우스 커서 탭 (5.1 v1.1) — 상태별 이미지 + 핫스팟 + 전체 on/off */
function CursorRow({ state }: { state: CursorState }) {
  const [st, patch] = useCursorSettings();
  const toast = useToast();
  const entry = st.states[state];
  // .ani는 <img>로 표시되지 않아 첫 프레임(.cur)을 뽑아 미리보기 (v1.9)
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!entry?.imgId) { setUrl(null); return; }
    let cancelled = false;
    let obj: string | null = null;
    getBlob(entry.imgId).then(async b => {
      if (!b || cancelled) return;
      const ani = parseAni(await b.arrayBuffer());
      if (cancelled) return;
      obj = URL.createObjectURL(ani ? ani.frames[0] : b);
      setUrl(obj);
    });
    return () => { cancelled = true; if (obj) URL.revokeObjectURL(obj); };
  }, [entry?.imgId]);
  const inputId = `curFile-${state}`;
  const setEntry = (p: Partial<{ imgId: string; hx: number; hy: number }>) =>
    patch({ states: { ...st.states, [state]: { imgId: entry?.imgId ?? '', hx: 0, hy: 0, ...entry, ...p } } });
  return (
    <div className="set-row" style={{ flexWrap: 'wrap' }}>
      <div className="l" style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
        <span style={{
          width: 36, height: 36, borderRadius: 9, border: '1.5px dashed var(--line)',
          display: 'grid', placeItems: 'center', overflow: 'hidden', flexShrink: 0,
        }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url ? <img src={url} alt="" style={{ maxWidth: 32, maxHeight: 32 }} /> : <span style={{ color: 'var(--faint)', fontSize: 14 }}>✛</span>}
        </span>
        <div><b>{CURSOR_STATE_LABEL[state].label}</b><small>{CURSOR_STATE_LABEL[state].desc}</small></div>
      </div>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <input id={inputId} type="file" accept="image/png,image/gif,image/webp,image/x-icon,.cur,.ani" style={{ display: 'none' }}
          onChange={async e => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (!f) return;
            const { blob, resized } = await fitCursorImage(f);
            setEntry({ imgId: await putBlob(blob) });
            if (resized) toast('커서로 쓸 수 있게 128px 이내로 줄였습니다 (원본이 너무 컸음)');
          }} />
        <button className="btn btn-ghost" style={{ height: 33, padding: '0 12px', fontSize: 11 }}
          onClick={() => document.getElementById(inputId)?.click()}>{entry ? 'CHANGE' : 'UPLOAD'}</button>
        {entry && (
          <>
            <span className="cp-lb">핫스팟 X</span>
            <KStep value={entry.hx} min={0} max={32} step={1} onChange={v => setEntry({ hx: v })} />
            <span className="cp-lb">Y</span>
            <KStep value={entry.hy} min={0} max={32} step={1} onChange={v => setEntry({ hy: v })} />
            <button className="btn btn-ghost" style={{ height: 33, padding: '0 12px', fontSize: 11 }}
              onClick={() => {
                const next = { ...st.states };
                delete next[state];
                patch({ states: next });
              }}>REMOVE</button>
          </>
        )}
      </div>
    </div>
  );
}

export function CursorPane() {
  const [st, patch] = useCursorSettings();
  return (
    <div className="set-sec">
      <h3>마우스 커서</h3>
      <div className="d">상태별 커서 등록 (png·gif·cur·ani — 32px 내외 권장) + 클릭 지점(핫스팟) — ani는 애니메이션 재생 · cur/ani는 내장 핫스팟 사용 · 등록하지 않은 상태는 기본 커서</div>
      <p className="hint" style={{ margin: '-6px 0 10px' }}>
        브라우저는 128px가 넘는 이미지를 커서로 쓰지 못합니다 — 큰 이미지를 올리면 자동으로 줄여서 등록합니다
      </p>
      <div className="set-row">
        <div className="l"><b>커스텀 커서 사용</b><small>끄면 전부 기본 커서로 (등록 이미지는 보존)</small></div>
        <KToggle checked={st.enabled} onChange={v => patch({ enabled: v })} />
      </div>
      {(Object.keys(CURSOR_STATE_LABEL) as CursorState[]).map(s => <CursorRow key={s} state={s} />)}
    </div>
  );
}
