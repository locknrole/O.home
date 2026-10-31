'use client';
import { useState } from 'react';
import { KStep, KToggle, KInput } from '@/components/ui/Kit';
import { DragList } from '@/components/ui/DragList';
import { useConfirmDelete } from '@/components/ui/Modal';
import { useBgm, BgmTrack, parseVideoId } from '@/lib/bgmStore';
import { useToast } from '@/components/ui/Toast';

/** BGM 트랙 한 줄 — 인라인 수정(제목/설명/URL) + 삭제 확인 */
function BgmTrackRow({ t, onPatch, onDelete }: {
  t: BgmTrack; onPatch: (p: Partial<BgmTrack>) => void; onDelete: () => void;
}) {
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(t.title);
  const [desc, setDesc] = useState(t.desc);
  const [url, setUrl] = useState(t.videoId);

  if (editing) {
    return (
      <div style={{ display: 'grid', gap: 7, padding: '10px 0', borderBottom: '1px dashed var(--line)', width: '100%' }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
          <KInput placeholder="곡 제목" value={title} onChange={e => setTitle(e.target.value)} style={{ maxWidth: 150 }} />
          <KInput placeholder="설명 (선택)" value={desc} onChange={e => setDesc(e.target.value)} style={{ flex: 1, minWidth: 130 }} />
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          <KInput placeholder="유튜브 URL 또는 영상 ID" value={url} onChange={e => setUrl(e.target.value)} />
          <button className="btn btn-dark" style={{ whiteSpace: 'nowrap' }}
            onClick={() => {
              const vid = parseVideoId(url);
              if (!title.trim() || !vid) { toast('제목과 올바른 유튜브 URL(또는 영상 ID)을 입력해 주세요'); return; }
              onPatch({ title: title.trim(), desc: desc.trim(), videoId: vid });
              setEditing(false);
              toast('곡이 수정되었습니다');
            }}>SAVE</button>
          <button className="btn btn-ghost" style={{ whiteSpace: 'nowrap' }}
            onClick={() => { setEditing(false); setTitle(t.title); setDesc(t.desc); setUrl(t.videoId); }}>CANCEL</button>
        </div>
      </div>
    );
  }

  return (
    <div className="set-row" style={{ width: '100%' }}>
      <div className="l" style={{ display: 'flex', gap: 11, alignItems: 'center' }}>
        <span className="drag-h">⠿</span>
        <div><b>{t.title}</b><small>{t.desc || t.videoId}</small></div>
      </div>
      <div style={{ display: 'flex', gap: 6 }}>
        <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
          onClick={() => setEditing(true)}>EDIT</button>
        <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
          onClick={onDelete}>DELETE</button>
      </div>
    </div>
  );
}

/** BGM 탭 (5.2 v1.9) — 곡 목록 등록(미니 플레이어 리스트에 노출) + 재생 설정 */
export function BgmPane() {
  const { state, setTracks, addTrack, removeTrack, setSettings } = useBgm();
  const toast = useToast();
  const del = useConfirmDelete();
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [url, setUrl] = useState('');

  const add = () => {
    if (addTrack(title, desc, url)) {
      setTitle(''); setDesc(''); setUrl('');
      toast('곡이 추가되었습니다');
    } else {
      toast('제목과 올바른 유튜브 URL(또는 영상 ID)을 입력해 주세요');
    }
  };

  return (
    <div className="set-sec">
      <h3>BGM</h3>
      <div className="d">유튜브 곡 목록 관리 — 미니 플레이어 리스트에 노출 · 화면은 숨기고 소리만 재생</div>

      <DragList
        items={state.tracks}
        keyOf={t => t.id}
        onReorder={setTracks}
        render={t => (
          <BgmTrackRow t={t}
            onPatch={p => setTracks(state.tracks.map(x => (x.id === t.id ? { ...x, ...p } : x)))}
            onDelete={() => del.ask(`곡 「${t.title}」을 삭제하시겠습니까?`, () => removeTrack(t.id))} />
        )}
      />
      {del.element}

      <div style={{ display: 'flex', gap: 8, marginTop: 14, flexWrap: 'wrap' }}>
        <KInput placeholder="곡 제목" value={title} onChange={e => setTitle(e.target.value)} style={{ maxWidth: 150 }} />
        <KInput placeholder="설명 (선택)" value={desc} onChange={e => setDesc(e.target.value)} style={{ maxWidth: 130 }} />
        <KInput placeholder="유튜브 URL 또는 영상 ID" value={url} onChange={e => setUrl(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        <button className="btn btn-dark" onClick={add}>＋ ADD</button>
      </div>

      <div className="set-row" style={{ marginTop: 16 }}>
        <div className="l"><b>기본 볼륨</b></div>
        <KStep value={state.settings.volume} min={0} max={100} suffix="%" onChange={v => setSettings({ volume: v })} />
      </div>
      <div className="set-row">
        <div className="l"><b>플레이어 위치</b><small>기본: 오른쪽 아래</small></div>
        <div className="mini-seg">
          <button className={state.settings.position === 'br' ? 'on' : ''} onClick={() => setSettings({ position: 'br' })}>오른쪽 아래</button>
          <button className={state.settings.position === 'bl' ? 'on' : ''} onClick={() => setSettings({ position: 'bl' })}>왼쪽 아래</button>
        </div>
      </div>
      <div className="set-row">
        <div className="l"><b>셔플</b></div>
        <KToggle checked={state.settings.shuffle} onChange={v => setSettings({ shuffle: v })} />
      </div>
      <div className="set-row">
        <div className="l"><b>반복 재생</b><small>목록 끝에서 처음으로</small></div>
        <KToggle checked={state.settings.repeat} onChange={v => setSettings({ repeat: v })} />
      </div>
      <div className="set-row">
        <div className="l"><b>플레이어 표시</b><small>끄면 사이트에서 BGM 플레이어가 사라짐</small></div>
        <KToggle checked={state.settings.enabled} onChange={v => setSettings({ enabled: v })} />
      </div>
      <div className="set-row">
        <div className="l"><b>재생 방식</b><small>자동: 접속 후 처음 클릭/키 입력하는 순간 재생 (브라우저 정책상 완전 무동작 자동재생은 불가) · 수동: 재생 버튼을 눌러야 재생</small></div>
        <div className="mini-seg">
          <button className={state.settings.autoplay ? 'on' : ''}
            onClick={() => setSettings({ autoplay: true })}>접속 시 자동 재생</button>
          <button className={!state.settings.autoplay ? 'on' : ''}
            onClick={() => setSettings({ autoplay: false })}>버튼 눌러야 재생</button>
        </div>
      </div>
    </div>
  );
}
