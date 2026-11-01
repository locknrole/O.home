'use client';
import { useState } from 'react';
import { KInput, KSelect, KCheck } from '@/components/ui/Kit';
import { useConfirmDelete } from '@/components/ui/Modal';
import { fileDrop } from '@/lib/dnd';
import { useFonts, fontCssUrl, FontDef } from '@/lib/fontStore';
import { useToast } from '@/components/ui/Toast';

/** 폰트 목록 한 줄 — CSS URL 표시 · 수정(이름/family/URL, 업로드 폰트는 이름/한글 페어) · 삭제 */
function FontRow({ f }: { f: FontDef }) {
  const { fonts, familyOf, updateFont, removeFont, resetFont, setFontPair } = useFonts();
  const del = useConfirmDelete();
  const toast = useToast();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(f.name);
  const [family, setFamily] = useState(f.family);
  const [cssUrl, setCssUrl] = useState(fontCssUrl(f) ?? '');

  if (editing) {
    return (
      <div style={{ display: 'grid', gap: 7, padding: '10px 0', borderBottom: '1px dashed var(--line)' }}>
        <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap', alignItems: 'center' }}>
          <KInput placeholder="표시 이름" value={name} onChange={e => setName(e.target.value)} style={{ maxWidth: 160 }} />
          {f.fileId ? (
            /* 업로드 폰트 — family는 자동, 한글 페어만 지정 (v1.9) */
            <>
              <span className="cp-lb">한글 페어</span>
              <KSelect minWidth={150} value={f.pairId ?? ''}
                onChange={v => setFontPair(f.id, v || undefined)}
                options={[{ value: '', label: '페어 없음' },
                  ...fonts.filter(x => x.id !== f.id).map(x => ({ value: x.id, label: x.name }))]} />
            </>
          ) : (
            <>
              <KInput placeholder="font-family 값" value={family} onChange={e => setFamily(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
              {/* 웹폰트도 한글 페어 지정 가능 (v1.9) */}
              <span className="cp-lb">한글 페어</span>
              <KSelect minWidth={140} value={f.pairId ?? ''}
                onChange={v => setFontPair(f.id, v || undefined)}
                options={[{ value: '', label: '페어 없음' },
                  ...fonts.filter(x => x.id !== f.id).map(x => ({ value: x.id, label: x.name }))]} />
            </>
          )}
        </div>
        <div style={{ display: 'flex', gap: 7 }}>
          {!f.fileId && <KInput placeholder="CSS URL" value={cssUrl} onChange={e => setCssUrl(e.target.value)} />}
          <button className="btn btn-dark" style={{ whiteSpace: 'nowrap', marginLeft: f.fileId ? 'auto' : undefined }}
            onClick={() => {
              if (updateFont(f.id, { name, family: f.fileId ? f.family : family, cssUrl: f.fileId ? '' : cssUrl })) { setEditing(false); toast('폰트가 수정되었습니다'); }
              else toast('이름과 font-family 값을 입력해 주세요');
            }}>SAVE</button>
          {/* 내장 폰트를 처음 상태로 (v2.0 사용자 발견) — 이름·family·한글 페어를 한꺼번에 되돌린다.
              잘못 들어간 값(엉뚱한 family, 지워진 폰트를 가리키는 페어)을 풀 방법이 없었다 */}
          {f.builtin && (
            <button className="btn btn-ghost" style={{ whiteSpace: 'nowrap' }}
              onClick={() => {
                resetFont(f.id);
                setEditing(false);
                toast(`「${f.name}」를 처음 상태로 되돌렸습니다`);
              }}>기본값으로</button>
          )}
          <button className="btn btn-ghost" style={{ whiteSpace: 'nowrap' }}
            onClick={() => { setEditing(false); setName(f.name); setFamily(f.family); setCssUrl(fontCssUrl(f) ?? ''); }}>CANCEL</button>
        </div>
      </div>
    );
  }

  return (
    <div className="set-row">
      <div className="l" style={{ minWidth: 0 }}>
        {/* 미리보기는 페어 반영 스택 — 영문 폰트+한글 페어면 한글이 페어 폰트로 보임 (v1.9) */}
        {/* familyOf가 페어까지 합쳐 주고 var(--serif) 같은 별칭도 원본 스택으로 풀어 준다 (v2.0) */}
        <b style={{ fontFamily: familyOf(f.id), fontSize: 15 }}>{f.name} — 가나다 ABC 123</b>
        <small style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {f.fileId
            ? `업로드 파일 — ${f.fileName ?? '폰트 파일'}${f.pairId ? ` · 한글 페어: ${fonts.find(x => x.id === f.pairId)?.name ?? ''}` : ''}`
            : `${fontCssUrl(f) ?? (f.locked ? '사이트 기본 폰트 스택 — 별도 URL 없음' : '사이트 CSS에서 로드')}${f.pairId ? ` · 한글 페어: ${fonts.find(x => x.id === f.pairId)?.name ?? ''}` : ''}`}
        </small>
      </div>
      <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
        <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
          onClick={() => setEditing(true)}>EDIT</button>
        {!f.locked && (
          <button className="btn btn-ghost" style={{ padding: '4px 10px', fontSize: 10.5 }}
            onClick={() => del.ask(`폰트 「${f.name}」를 삭제하시겠습니까?`, () => removeFont(f.id),
                f.builtin
                  ? '기본 폰트는 목록에서만 빠집니다 — 아래 [복원] 버튼으로 되살릴 수 있고, 이 폰트를 쓰던 항목 표시는 그대로입니다.'
                  // 직접 등록한 폰트는 정의째 사라지므로 가리키던 자리도 함께 정리된다 (v2.0)
                  : '직접 등록한 폰트는 복구할 수 없습니다. 이 폰트를 쓰도록 지정해 둔 자리(역할 폰트·한글 페어)는 기본값으로 되돌아갑니다.')}>DELETE</button>
        )}
      </div>
      {del.element}
    </div>
  );
}

/** 폰트 탭 (5.1) — 내장 폰트도 수정·삭제 가능 · 웹폰트 URL 등록. 파일 업로드·페어링은 후속 */
export function FontPane() {
  const { fonts, hiddenCount, addFont, addFontFile, restoreBuiltins } = useFonts();
  const toast = useToast();
  const [name, setName] = useState('');
  const [family, setFamily] = useState('');
  const [cssUrl, setCssUrl] = useState('');
  // 웹폰트 추가의 한글 페어 (v1.9) — 체크하면 지정 가능
  const [webPairOn, setWebPairOn] = useState(false);
  const [webPair, setWebPair] = useState('');
  // 폰트 파일 업로드 (v1.9) — 표시 이름은 파일명 그대로 (EDIT에서 수정 가능, 사용자 확정)
  const [upPair, setUpPair] = useState('');
  const uploadFontFile = async (f: File | undefined) => {
    if (!f) return;
    const name = f.name.replace(/\.(woff2?|ttf|otf)$/i, '');
    if (await addFontFile(name, f, upPair || undefined)) { setUpPair(''); toast(`「${name}」 폰트가 등록되었습니다`); }
  };

  return (
    <div className="set-sec">
      <h3>폰트 라이브러리</h3>
      <div className="d">캐릭터 프로필·자관 이름·시나리오 타이틀 등에서 이 목록 중 선택해 사용 — 원하는 폰트만 남기고 삭제 가능</div>

      {fonts.map(f => <FontRow key={f.id} f={f} />)}
      {hiddenCount > 0 && (
        <div style={{ marginTop: 10 }}>
          <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }} onClick={restoreBuiltins}>
            삭제한 기본 폰트 {hiddenCount}개 복원
          </button>
        </div>
      )}
      <p className="hint">삭제해도 이미 그 폰트를 쓰고 있는 캐릭터·자관 표시는 깨지지 않습니다 — 선택 목록에서만 빠집니다</p>

      <div style={{ display: 'grid', gap: 8, marginTop: 14 }}>
        <label className="k-label" style={{ margin: 0 }}>웹폰트 추가 — 눈누/구글폰트의 CSS 링크(URL)와 font-family 값</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <KInput placeholder="표시 이름" value={name} onChange={e => setName(e.target.value)} style={{ maxWidth: 130 }} />
          <KInput placeholder="font-family 값" value={family}
            onChange={e => setFamily(e.target.value)} style={{ flex: 1, minWidth: 180 }} />
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <KInput placeholder="CSS URL (https://fonts.googleapis.com/... 또는 눈누 링크)" value={cssUrl}
            onChange={e => setCssUrl(e.target.value)} />
          <button className="btn btn-dark" style={{ whiteSpace: 'nowrap' }}
            onClick={() => {
              if (addFont(name, family, cssUrl, webPairOn ? webPair || undefined : undefined)) {
                setName(''); setFamily(''); setCssUrl(''); setWebPairOn(false); setWebPair('');
                toast('폰트가 추가되었습니다');
              } else toast('이름과 font-family 값을 입력해 주세요');
            }}>＋ ADD</button>
        </div>
        {/* 영문·일어 등 한글 미지원 웹폰트 — 체크하면 한글 페어 지정 (v1.9 사용자 요청) */}
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <KCheck label="한글 페어 지정" checked={webPairOn} onChange={setWebPairOn} />
          {webPairOn && (
            <KSelect minWidth={160} value={webPair} onChange={setWebPair}
              options={[{ value: '', label: '페어 없음' }, ...fonts.map(f => ({ value: f.id, label: f.name }))]} />
          )}
        </div>
      </div>

      {/* 폰트 파일 업로드 (v1.9) — woff2·woff·ttf·otf + 영문 폰트의 한글 페어링 */}
      <div style={{ display: 'grid', gap: 8, marginTop: 16 }}>
        <label className="k-label" style={{ margin: 0 }}>폰트 파일 업로드 — woff2·woff·ttf·otf</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <span className="cp-lb">한글 페어</span>
          <KSelect minWidth={160} value={upPair} onChange={setUpPair}
            options={[{ value: '', label: '페어 없음' }, ...fonts.map(f => ({ value: f.id, label: f.name }))]} />
          <label className="btn btn-dark" style={{ whiteSpace: 'nowrap', cursor: 'var(--cur-pointer,pointer)' }}
            {...fileDrop(fl => uploadFontFile(fl[0]))}>
            ↑ 파일 선택
            <input type="file" accept=".woff2,.woff,.ttf,.otf" style={{ display: 'none' }}
              onChange={e => { uploadFontFile(e.target.files?.[0]); e.target.value = ''; }} />
          </label>
        </div>
        <p className="hint">표시 이름은 파일명 그대로 등록 — 목록의 [EDIT]에서 수정. 한글 미지원 폰트라면 한글 페어를 지정 — 한글 글자는 페어 폰트로 표시됩니다.</p>
      </div>
    </div>
  );
}
