'use client';
// 썰 (카톡 아카이브) — 채팅 날짜 기준 타임라인. 제목을 누르면 대화 상세로.
// 오른쪽에서 AU·태그로 거른다 (태그는 여러 개 고르면 모두 가진 썰만).
import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLocalList } from '@/lib/postStore';
import { Relation, REL_SEED, Character, CHAR_SEED } from '@/lib/charStore';
import { Ssul, SSUL_KEY, SSUL_SEED, fmtRange, auChoices, auKeyOf } from '@/lib/ssulStore';
import { SearchBar, KRadio } from '@/components/ui/Kit';
import { EditableDesc, PageTitle } from '@/components/ui/PageText';

const VIS_LABEL = { member: '멤버공개', private: '나만보기' } as const;

export default function SsulPage() {
  const router = useRouter();
  const { isAdmin } = useAuth();
  const [ssuls, , loaded] = useLocalList<Ssul>(SSUL_KEY, SSUL_SEED);
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [chars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  const aus = useMemo(() => auChoices(rels, chars), [rels, chars]);
  const auLabel = (key: string) => aus.find(a => a.key === key)?.label;

  const [au, setAu] = useState('all');
  const [tags, setTags] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ssuls
      .filter(s => au === 'all' || (au === 'none' ? !s.relId : auKeyOf(s) === au))
      .filter(s => tags.every(t => s.tags.includes(t)))
      .filter(s => !needle || s.title.toLowerCase().includes(needle) || ((!s.password || isAdmin) && (s.summary ?? '').toLowerCase().includes(needle))
        || s.tags.some(t => t.toLowerCase().includes(needle)))
      .sort((a, b) => (order === 'asc' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start)));
  }, [ssuls, au, tags, q, order, isAdmin]);

  // 연·월로 묶기 (채팅 시작일 기준)
  const groups = useMemo(() => {
    const out: { ym: string; items: Ssul[] }[] = [];
    for (const s of shown) {
      const ym = s.start.slice(0, 7);
      if (out[out.length - 1]?.ym !== ym) out.push({ ym, items: [] });
      out[out.length - 1].items.push(s);
    }
    return out;
  }, [shown]);

  const auCounts = useMemo(() => {
    const m = new Map<string, number>();
    ssuls.forEach(s => { const k = auKeyOf(s) || 'none'; m.set(k, (m.get(k) ?? 0) + 1); });
    return m;
  }, [ssuls]);
  // 태그 목록은 지금 고른 AU 안에서 센다 — 고를 수 없는 태그가 늘어서 있지 않게
  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    ssuls.filter(s => au === 'all' || (au === 'none' ? !s.relId : auKeyOf(s) === au))
      .forEach(s => s.tags.forEach(t => m.set(t, (m.get(t) ?? 0) + 1)));
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [ssuls, au]);

  const toggleTag = (t: string) => setTags(ts => (ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]));

  return (
    <section className="page">
      <div className="page-head">
        <PageTitle>SSUL</PageTitle>
        <EditableDesc k="ssul-desc" def="카톡으로 풀던 썰 아카이브 · 채팅 날짜 순" />
        <div className="head-actions">
          <SearchBar onSearch={setQ} />
          {isAdmin && <button className="btn btn-dark" style={{ whiteSpace: 'nowrap' }} onClick={() => router.push('/ssul/upload')}>＋ 카톡 업로드</button>}
        </div>
      </div>
      <div className="trpg-layout">
        <div>
          {groups.map(g => (
            <div key={g.ym} className="ssul-tl">
              <h3 className="ssul-ym">{g.ym.slice(0, 4)}<span>.{g.ym.slice(5)}</span></h3>
              <div className="ssul-tl-list">
                {g.items.map(s => (
                  <div key={s.id} className="ssul-item">
                    <i className="dot" />
                    <div className="si-date">{fmtRange(s)}</div>
                    <div className="si-main">
                      <a className="si-title" onClick={() => router.push(`/ssul/${s.id}`)}>{s.title}</a>
                      {s.visibility !== 'public' && <span className="pill" style={{ marginLeft: 6 }}>{VIS_LABEL[s.visibility]}</span>}
                      {s.password && <span className="pill" style={{ marginLeft: 6 }}>🔒</span>}
                      {/* 비밀번호 썰은 요약을 숨긴다 — 제목·태그만 (관리자는 그대로) */}
                      {s.summary && (!s.password || isAdmin) && <p className="si-sum">{s.summary}</p>}
                      <div className="si-tags">
                        {s.relId && auLabel(auKeyOf(s)) && <span className="pill dark" onClick={() => setAu(auKeyOf(s))}>{auLabel(auKeyOf(s))}</span>}
                        {s.tags.map(t => <span key={t} className={`pill ${tags.includes(t) ? 'red' : ''}`} onClick={() => toggleTag(t)}>#{t}</span>)}
                        <small>{s.count}개 메시지</small>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
          {loaded && shown.length === 0 && (
            <div className="panel" style={{ textAlign: 'center', padding: 44, fontSize: 13, color: 'var(--faint)' }}>
              {ssuls.length ? '조건에 맞는 썰이 없습니다' : isAdmin ? '아직 썰이 없습니다 — ＋ 카톡 업로드로 대화 파일을 올려 보세요' : '아직 썰이 없습니다'}
            </div>
          )}
        </div>
        <div className="panel tagside">
          <h4>AU</h4>
          <div className={`tag ${au === 'all' ? 'on' : ''}`} onClick={() => setAu('all')}>전체 <small>{ssuls.length}</small></div>
          {aus.filter(a => auCounts.get(a.key)).map(a => (
            <div key={a.key} className={`tag ${au === a.key ? 'on' : ''}`} onClick={() => setAu(a.key)}>
              {a.label} <small>{auCounts.get(a.key)}</small>
            </div>
          ))}
          {(auCounts.get('none') ?? 0) > 0 && (
            <div className={`tag ${au === 'none' ? 'on' : ''}`} onClick={() => setAu('none')}>기타 <small>{auCounts.get('none')}</small></div>
          )}
          {tagCounts.length > 0 && (
            <>
              <h4 style={{ marginTop: 18 }}>태그{tags.length > 0 && <a className="ssul-clear" onClick={() => setTags([])}>해제</a>}</h4>
              <div className="ssul-tagcloud">
                {tagCounts.map(([t, n]) => (
                  <span key={t} className={`pill ${tags.includes(t) ? 'dark' : ''}`} onClick={() => toggleTag(t)}>#{t} <small>{n}</small></span>
                ))}
              </div>
            </>
          )}
          <h4 style={{ marginTop: 18 }}>정렬</h4>
          <KRadio name="ssul-ord" value="asc" current={order} onChange={() => setOrder('asc')} label="오래된 순" />
          <div style={{ height: 7 }} />
          <KRadio name="ssul-ord" value="desc" current={order} onChange={() => setOrder('desc')} label="최신 순" />
        </div>
      </div>
    </section>
  );
}
