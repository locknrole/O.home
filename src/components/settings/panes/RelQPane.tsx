'use client';
import { useEffect, useRef, useState } from 'react';
import { KInput, Pager } from '@/components/ui/Kit';
import { DragList } from '@/components/ui/DragList';
import { useConfirmDelete } from '@/components/ui/Modal';
import { newId } from '@/lib/postStore';
import { RelQuestionSet, RELQ_SEED, RELQ_KEY, CP_LABEL } from '@/lib/relqStore';
import { useLocalList } from '@/lib/postStore';
import { useToast } from '@/components/ui/Toast';
import { CP } from './shared';

/** 자관 질문 탭 (v1.9) — 질문 세트(CP/NCP) 관리. 자관 상세의 QUESTIONS 섹션 추가 시 세트를 골라 넣는다 */
export function RelQPane() {
  const [sets, setSets] = useLocalList<RelQuestionSet>(RELQ_KEY, RELQ_SEED);
  const [selId, setSelId] = useState<string | null>(null);
  const del = useConfirmDelete();
  const relqToast = useToast();
  const txtRef = useRef<HTMLInputElement>(null);   // txt 일괄 업로드 (줄바꿈 = 질문)
  const sel = sets.find(s => s.id === selId) ?? sets[0];
  const patchSet = (id: string, p: Partial<RelQuestionSet>) =>
    setSets(sets.map(s => (s.id === id ? { ...s, ...p } : s)));

  // 질문은 txt로 수백 개씩 올리는 경우가 있어 한 화면에 다 깔면 끝없이 길어진다 (v2.0 사용자 요청)
  const PER_Q = 12;
  const [qPage, setQPage] = useState(1);
  const qTotal = sel?.questions.length ?? 0;
  const qPages = Math.max(1, Math.ceil(qTotal / PER_Q));
  // 세트를 바꾸거나 질문이 줄어 페이지가 사라지면 마지막 페이지로 당긴다
  const qCur = Math.min(qPage, qPages);
  useEffect(() => { setQPage(1); }, [sel?.id]);
  const qStart = (qCur - 1) * PER_Q;
  // 화면에 보이는 건 이 페이지뿐이라, 수정·삭제·정렬은 전체 배열 기준 위치로 되돌려 계산해야 한다
  const qShown = (sel?.questions ?? []).slice(qStart, qStart + PER_Q);
  return (
    <div className="set-sec">
      <h3>자관 질문</h3>
      <div className="d">질문 세트를 CP(커플)/NCP(커플 아님)로 구분해 관리 — 자관 상세에서 QUESTIONS 섹션을 추가할 때 세트를 골라 넣습니다</div>

      <h3 style={{ marginTop: 20 }}>질문 세트</h3>
      <div className="d">이름은 자유 수정 · CP/NCP 구분 · ⠿ 드래그로 순서</div>
      <DragList items={sets} keyOf={s => s.id} onReorder={setSets}
        render={s => (
          /* 컴팩트 행 (v1.9 — 위아래 여백 최소) */
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', padding: '3px 0' }}>
            <span className="drag-h" style={{ fontSize: 11 }}>⠿</span>
            <KInput value={s.name} onChange={e => patchSet(s.id, { name: e.target.value })}
              style={{ width: 140, fontSize: 12, padding: '5px 10px' }} />
            <div className="mini-seg">
              {(['cp', 'ncp'] as const).map(t => (
                <button key={t} className={s.cat === t ? 'on' : ''}
                  onClick={() => patchSet(s.id, { cat: t })}>{CP_LABEL[t]}</button>
              ))}
            </div>
            <small style={{ marginLeft: 'auto', color: 'var(--faint)', fontSize: 10.5 }}>질문 {s.questions.length}개</small>
            <button className="btn btn-ghost" style={{ padding: '3px 9px', fontSize: 10.5 }}
              onClick={() => del.ask(`세트 「${s.name}」를 삭제하시겠습니까?`,
                () => setSets(sets.filter(x => x.id !== s.id)),
                '이미 자관에 넣은 질문들은 그대로 유지됩니다.')}>DELETE</button>
          </div>
        )} />
      <div style={{ marginTop: 8, display: 'flex', justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}
          onClick={() => setSets([...sets, { id: newId(), name: '새 세트', cat: 'cp', questions: [] }])}>＋ ADD SET</button>
      </div>

      <hr style={{ margin: '24px 0', border: 'none', borderTop: '1.5px solid var(--line)' }} />

      <h3>질문 목록</h3>
      <div className="d">txt 파일은 줄바꿈을 기준으로 질문을 카운트합니다.</div>
      {sets.length > 1 && (
        <div className="mini-seg" style={{ marginBottom: 12 }}>
          {sets.map(s => (
            <button key={s.id} className={sel?.id === s.id ? 'on' : ''} onClick={() => setSelId(s.id)}>{s.name}</button>
          ))}
        </div>
      )}
      {sel && (
        <>
          {/* 정렬은 이 페이지 안에서만 — 되돌려 담을 때 앞뒤 페이지는 그대로 둔다 */}
          <DragList items={qShown.map((q, i) => ({ q, key: `${sel.id}-${qStart + i}` }))} keyOf={x => x.key}
            onReorder={list => patchSet(sel.id, {
              questions: [
                ...sel.questions.slice(0, qStart),
                ...list.map(x => x.q),
                ...sel.questions.slice(qStart + PER_Q),
              ],
            })}
            render={({ q }, i) => {
              const gi = qStart + i;   // 전체 배열에서의 실제 위치
              return (
              /* 컴팩트 행 — 질문이 100개 단위라 갭 최소화 (v1.9) */
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', width: '100%', padding: '2px 0' }}>
                <span className="drag-h" style={{ fontSize: 11 }}>⠿</span>
                <small style={{ color: 'var(--faint)', fontSize: 10, minWidth: 26, textAlign: 'right' }}>{gi + 1}</small>
                <KInput value={q}
                  onChange={e => patchSet(sel.id, { questions: sel.questions.map((x, j) => (j === gi ? e.target.value : x)) })}
                  style={{ flex: 1, minWidth: 0, fontSize: 12, padding: '5px 10px' }} />
                <span className="fx" style={{ fontSize: 10, padding: '2px 4px' }}
                  onClick={() => {
                    // 내용이 있으면 경고 모달, 방금 추가한 빈 줄은 바로 삭제
                    const remove = () => patchSet(sel.id, { questions: sel.questions.filter((_, j) => j !== gi) });
                    if (q.trim()) del.ask(`질문을 삭제하시겠습니까?`, remove, `"${q.slice(0, 40)}${q.length > 40 ? '…' : ''}"`);
                    else remove();
                  }}>✕</span>
              </div>
              );
            }} />
          {/* 개수는 완전히 오른쪽 끝으로, 페이저는 가운데 그대로 (v2.0 사용자 요청) —
              한 줄에 나란히 두면 개수만큼 페이저가 왼쪽으로 밀려 가운데가 어긋난다 */}
          {qTotal > PER_Q && (
            <div style={{ marginTop: 10, display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center' }}>
              <span />
              <Pager page={qCur} total={qPages} onChange={setQPage} />
              <small style={{ color: 'var(--faint)', fontSize: 10.5, justifySelf: 'end' }}>총 {qTotal}개</small>
            </div>
          )}
          <div style={{ marginTop: 10, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            {/* txt 일괄 업로드 — 엔터 기준 한 줄 = 질문 하나 (v1.9, 100개 단위 대비) */}
            <input ref={txtRef} type="file" accept=".txt,text/plain" style={{ display: 'none' }}
              onChange={async e => {
                const f = e.target.files?.[0]; e.target.value = '';
                if (!f) return;
                const lines = (await f.text()).split(/\r?\n/).map(s => s.trim()).filter(Boolean);
                if (lines.length === 0) { relqToast('파일에서 질문을 찾지 못했습니다'); return; }
                patchSet(sel.id, { questions: [...sel.questions, ...lines] });
                relqToast(`질문 ${lines.length}개를 불러왔습니다`);
              }} />
            <button className="btn btn-dark" style={{ padding: '5px 12px', fontSize: 11 }}
              onClick={() => txtRef.current?.click()}>↑ TXT 업로드</button>
            <button className="btn btn-ghost" style={{ padding: '5px 12px', fontSize: 11 }}
              onClick={() => {
                patchSet(sel.id, { questions: [...sel.questions, ''] });
                // 새 빈 줄은 맨 끝에 붙으므로 그 줄이 있는 페이지로 옮겨 준다 (안 그러면 눌러도 안 보인다)
                setQPage(Math.ceil((qTotal + 1) / PER_Q));
              }}>＋ ADD</button>
          </div>
        </>
      )}
      {del.element}
    </div>
  );
}
