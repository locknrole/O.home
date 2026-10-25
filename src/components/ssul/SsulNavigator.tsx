'use client';
// 썰 상세 오른쪽 내비게이터 — 작은 타임라인(현재 썰 앞뒤 2개씩) + 같은 키워드·AU를 가진 다른 썰.
import React, { useMemo } from 'react';
import Link from 'next/link';
import type { Ssul, AuChoice } from '@/lib/ssulStore';
import { auKeyOf } from '@/lib/ssulStore';

const AROUND = 2;          // 앞뒤로 보여 줄 개수
const RELATED_MAX = 8;     // 같은 키워드 썰 목록 최대 개수 (넘으면 「전체 보기」)

/** 같은 해면 MM.DD, 다르면 YY.MM.DD — 칸이 좁다 */
function shortDate(at: string, year: string) {
  const [y, m, d] = at.slice(0, 10).split('-');
  return y === year ? `${m}.${d}` : `${y.slice(2)}.${m}.${d}`;
}

/** 내비게이터에서 고른 것 — 키워드면 tag, AU면 au(키) */
export type NavPick = { tag: string } | { au: string } | null;

export function SsulNavigator({ ssuls, current, aus, pick, onPick, onGo }: {
  ssuls: Ssul[];
  current: Ssul;
  aus: AuChoice[];
  pick: NavPick;
  onPick: (p: NavPick) => void;
  onGo: (id: string) => void;
}) {
  const sorted = useMemo(() => [...ssuls].sort((a, b) => a.start.localeCompare(b.start)), [ssuls]);
  const at = sorted.findIndex(x => x.id === current.id);
  const win = at < 0 ? [] : sorted.slice(Math.max(0, at - AROUND), at + AROUND + 1);
  const year = current.start.slice(0, 4);
  const auKey = auKeyOf(current);
  const auLabel = aus.find(a => a.key === auKey)?.label;

  const related = useMemo(() => {
    if (!pick) return [];
    const match = (s: Ssul) => ('tag' in pick ? s.tags.includes(pick.tag) : auKeyOf(s) === pick.au);
    return sorted.filter(s => s.id !== current.id && match(s));
  }, [pick, sorted, current.id]);
  const allHref = pick ? `/ssul?${'tag' in pick ? `tag=${encodeURIComponent(pick.tag)}` : `au=${encodeURIComponent(pick.au)}`}` : '/ssul';
  const isOn = (p: NavPick) => !!pick && !!p && JSON.stringify(pick) === JSON.stringify(p);

  return (
    <aside className="panel ssul-navi">
      <h4>타임라인 <small>{at + 1} / {sorted.length}</small></h4>
      <div className="sn-tl">
        {at > AROUND && <div className="sn-more">⋮</div>}
        {win.map(s => {
          const cur = s.id === current.id;
          return (
            <a key={s.id} className={`sn-item ${cur ? 'cur' : ''}`} onClick={() => { if (!cur) onGo(s.id); }} title={s.title}>
              <i className="dot" />
              <small>{shortDate(s.start, year)}</small>
              <span>{s.title}</span>
            </a>
          );
        })}
        {at >= 0 && at < sorted.length - 1 - AROUND && <div className="sn-more">⋮</div>}
      </div>

      {(auLabel || current.tags.length > 0) && (
        <>
          <h4 style={{ marginTop: 16 }}>같은 키워드</h4>
          <div className="sn-chips">
            {auLabel && (
              <a className={`pill ${isOn({ au: auKey }) ? 'dark' : ''}`} onClick={() => onPick(isOn({ au: auKey }) ? null : { au: auKey })}>{auLabel}</a>
            )}
            {current.tags.map(t => (
              <a key={t} className={`pill ${isOn({ tag: t }) ? 'dark' : ''}`} onClick={() => onPick(isOn({ tag: t }) ? null : { tag: t })}>#{t}</a>
            ))}
          </div>
          {!pick && <p className="hint" style={{ margin: '8px 0 0' }}>누르면 같은 키워드를 가진 다른 썰이 보입니다</p>}
          {pick && (
            <div className="sn-related">
              {related.slice(0, RELATED_MAX).map(s => (
                <a key={s.id} className="sn-item" onClick={() => onGo(s.id)} title={s.title}>
                  <small>{shortDate(s.start, year)}</small>
                  <span>{s.title}</span>
                </a>
              ))}
              {!related.length && <p className="hint" style={{ margin: 0 }}>다른 썰이 없습니다</p>}
              {related.length > RELATED_MAX && <Link className="sn-all" href={allHref}>전체 {related.length}개 보기 ›</Link>}
              {related.length > 0 && related.length <= RELATED_MAX && <Link className="sn-all" href={allHref}>타임라인에서 보기 ›</Link>}
            </div>
          )}
        </>
      )}
    </aside>
  );
}
