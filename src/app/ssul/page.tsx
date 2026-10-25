'use client';
// 썰 (카톡 아카이브) — 채팅 날짜 기준 타임라인. 제목을 누르면 대화 상세로.
// 오른쪽에서 AU·태그로 거른다 (태그는 여러 개 고르면 모두 가진 썰만).
//
// 읽는 양: 기본은 **가장 최근 한 달만** 서버에서 읽는다(문서 읽기마다 과금). 기간을 고르면 그 달·그해만,
// 검색·태그·AU로 찾을 때만 전체를, 즐겨찾기만 볼 땐 그 썰들만 읽는다 (useSsulScope).
import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/auth';
import { useLocalList } from '@/lib/postStore';
import { Relation, REL_SEED, Character, CHAR_SEED } from '@/lib/charStore';
import { Ssul, fmtRange, auChoices, auKeyOf, useSsulFavs, useSsulMonths, useSsulScope, type SsulScope } from '@/lib/ssulStore';
import { SearchBar, KRadio } from '@/components/ui/Kit';
import { EditableDesc, PageTitle } from '@/components/ui/PageText';

const VIS_LABEL = { member: '멤버공개', private: '나만보기' } as const;
const TAG_LIMIT = 20;   // 오른쪽 태그 칸에 처음 보일 개수

export default function SsulPage() {
  const router = useRouter();
  const { isAdmin, user } = useAuth();
  const fav = useSsulFavs(user?.id);
  const [rels] = useLocalList<Relation>('ohome.rels.v1', REL_SEED);
  const [chars] = useLocalList<Character>('ohome.chars.v1', CHAR_SEED);
  const aus = useMemo(() => auChoices(rels, chars), [rels, chars]);
  const auLabel = (key: string) => aus.find(a => a.key === key)?.label;

  const [au, setAu] = useState('all');
  const [tags, setTags] = useState<string[]>([]);
  const [q, setQ] = useState('');
  const [order, setOrder] = useState<'asc' | 'desc'>('asc');
  // 기간 — 연도를 고르면 그해의 월을 고를 수 있다 (채팅 시작일 기준). null = 아직 기본값(최근 달)을 정하기 전
  const [year, setYear] = useState<string | null>(null);
  const [month, setMonth] = useState('all');
  const [favOnly, setFavOnly] = useState(false);
  const [allTags, setAllTags] = useState(false);   // 태그 칸 — 기본 20개, 더보기로 전부

  // 썰이 있는 달 목록 — 아직 맞춰 둔 적이 없으면(빈 배열) 예전처럼 전체를 읽는다
  const months = useSsulMonths();
  const indexed = months.length > 0;

  // 처음 기간: 상세 내비게이터의 「타임라인에서 보기」(?tag= / ?au=)면 전체 기간, 아니면 가장 최근 달
  useEffect(() => {
    if (year !== null) return;
    const p = new URLSearchParams(window.location.search);
    const t = p.get('tag'), a = p.get('au');
    if (t || a) {
      if (t) setTags([t]);
      if (a) setAu(a);
      setYear('all');
      return;
    }
    if (!indexed) return;
    const last = months[months.length - 1];
    setYear(last.slice(0, 4)); setMonth(last.slice(5, 7));
  }, [year, indexed, months]);

  // 검색·태그·AU로 찾기 시작하면 전체 기간으로 — 다른 달의 썰도 찾아야 하니까 (그 뒤 기간을 다시 좁힐 수 있다)
  const toAllPeriods = () => { setYear('all'); setMonth('all'); };
  const cross = !!q.trim() || tags.length > 0 || au !== 'all';
  const scope: SsulScope | null = useMemo(() => {
    if (favOnly && !cross) return { kind: 'ids', ids: [...fav.ids] };
    if (cross || !indexed || year === 'all') return { kind: 'all' };
    if (year === null) return null;   // 기본값 정하는 중
    return { kind: 'months', yms: month === 'all' ? months.filter(m => m.startsWith(year)) : [`${year}-${month}`] };
  }, [favOnly, cross, fav.ids, indexed, year, month, months]);
  const { items: ssuls, loaded } = useSsulScope(scope);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return ssuls
      .filter(s => au === 'all' || (au === 'none' ? !s.relId : auKeyOf(s) === au))
      .filter(s => tags.every(t => s.tags.includes(t)))
      .filter(s => !favOnly || fav.ids.has(s.id))
      .filter(s => !needle || s.title.toLowerCase().includes(needle) || (s.summary ?? '').toLowerCase().includes(needle)
        || s.tags.some(t => t.toLowerCase().includes(needle)))
      // 즐겨찾기만 볼 땐 기간과 상관없이 전부
      .filter(s => favOnly || !year || year === 'all' || s.start.slice(0, 4) === year)
      .filter(s => favOnly || month === 'all' || s.start.slice(5, 7) === month)
      .sort((a, b) => (order === 'asc' ? a.start.localeCompare(b.start) : b.start.localeCompare(a.start)));
  }, [ssuls, au, tags, q, favOnly, fav.ids, year, month, order]);

  // 기간 칸 — 월 목록이 있으면 그걸로(전체를 읽지 않고도 어느 달이 있는지 안다), 없으면 읽어 온 것으로
  const allMonths = useMemo(() => (indexed ? months : [...new Set(ssuls.map(s => s.start.slice(0, 7)))].sort()), [indexed, months, ssuls]);
  const years = useMemo(() => {
    const ys = [...new Set(allMonths.map(m => m.slice(0, 4)))];
    return order === 'asc' ? ys.sort() : ys.sort().reverse();
  }, [allMonths, order]);
  const hasMonth = (y: string, mm: string) => allMonths.includes(`${y}-${mm}`);
  const pickYear = (y: string) => { setYear(y); setMonth('all'); };

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

  const toggleTag = (t: string) => {
    if (!tags.includes(t) && !cross) toAllPeriods();
    setTags(ts => (ts.includes(t) ? ts.filter(x => x !== t) : [...ts, t]));
  };
  const pickAu = (k: string) => { if (k !== 'all' && !cross) toAllPeriods(); setAu(k); };
  const search = (v: string) => { if (v.trim() && !cross) toAllPeriods(); setQ(v); };

  return (
    <section className="page">
      <div className="page-head">
        <PageTitle>SSUL</PageTitle>
        <EditableDesc k="ssul-desc" def="카톡으로 풀던 썰 아카이브 · 채팅 날짜 순" />
        <div className="head-actions">
          <SearchBar onSearch={search} />
          {isAdmin && <button className="btn btn-dark" style={{ whiteSpace: 'nowrap' }} onClick={() => router.push('/ssul/upload')}>＋ 카톡 업로드</button>}
        </div>
      </div>
      <div className="trpg-layout">
        <div>
          {groups.map((g, gi) => (
            <div key={g.ym} className="ssul-tl">
              {/* 해가 바뀔 때마다 큰 연도 제목 — 썰이 많아도 어디쯤인지 보이게 */}
              {g.ym.slice(0, 4) !== groups[gi - 1]?.ym.slice(0, 4) && (
                <h2 className="ssul-year">{g.ym.slice(0, 4)}</h2>
              )}
              <h3 className="ssul-ym">{Number(g.ym.slice(5))}월</h3>
              <div className="ssul-tl-list">
                {g.items.map(s => (
                  <div key={s.id} className="ssul-item">
                    <i className="dot" />
                    <div className="si-date">{fmtRange(s)}</div>
                    <div className="si-main">
                      <a className="si-title" onClick={() => router.push(`/ssul/${s.id}`)}>{s.title}</a>
                      {s.visibility !== 'public' && <span className="pill" style={{ marginLeft: 6 }}>{VIS_LABEL[s.visibility]}</span>}
                      {s.summary && <p className="si-sum">{s.summary}</p>}
                      <div className="si-tags">
                        {s.relId && auLabel(auKeyOf(s)) && <span className="pill dark" onClick={() => pickAu(auKeyOf(s))}>{auLabel(auKeyOf(s))}</span>}
                        {s.tags.map(t => <span key={t} className={`pill ${tags.includes(t) ? 'red' : ''}`} onClick={() => toggleTag(t)}>#{t}</span>)}
                        <small>{s.count}개 메시지</small>
                      </div>
                    </div>
                    {fav.enabled && (
                      <button className={`ssul-star ${fav.ids.has(s.id) ? 'on' : ''}`} title={fav.ids.has(s.id) ? '즐겨찾기 해제' : '즐겨찾기'}
                        onClick={() => fav.toggle(s.id)}>{fav.ids.has(s.id) ? '★' : '☆'}</button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {loaded && shown.length === 0 && (
            <div className="panel" style={{ textAlign: 'center', padding: 44, fontSize: 13, color: 'var(--faint)' }}>
              {favOnly && !fav.ids.size ? '아직 즐겨찾기한 썰이 없습니다 — 제목 옆 ☆를 눌러 보세요' : ssuls.length ? '조건에 맞는 썰이 없습니다' : isAdmin ? '아직 썰이 없습니다 — ＋ 카톡 업로드로 대화 파일을 올려 보세요' : '아직 썰이 없습니다'}
            </div>
          )}
        </div>
        <div className="panel tagside ssul-side">
          {fav.enabled && (
            <div className={`tag ${favOnly ? 'on' : ''}`} style={{ marginBottom: 12 }} onClick={() => setFavOnly(v => !v)}>
              ★ 즐겨찾기만 <small>{fav.ids.size}</small>
            </div>
          )}
          <h4>정렬</h4>
          <KRadio name="ssul-ord" value="asc" current={order} onChange={() => setOrder('asc')} label="오래된 순" />
          <div style={{ height: 7 }} />
          <KRadio name="ssul-ord" value="desc" current={order} onChange={() => setOrder('desc')} label="최신 순" />
          <div style={{ height: 16 }} />
          {years.length > 0 && (
            <>
              <h4>기간</h4>
              <div className={`tag ${year === 'all' || (year === null && !indexed) ? 'on' : ''}`} onClick={() => pickYear('all')}>전체 기간</div>
              {years.map(y => (
                <React.Fragment key={y}>
                  <div className={`tag ${year === y ? 'on' : ''}`} onClick={() => pickYear(year === y ? 'all' : y)}>{y}년</div>
                  {year === y && (
                    <div className="ssul-months">
                      {Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0')).map(mm => (
                        <button key={mm} disabled={!hasMonth(y, mm)} className={month === mm ? 'on' : ''}
                          onClick={() => setMonth(month === mm ? 'all' : mm)}>{Number(mm)}월</button>
                      ))}
                    </div>
                  )}
                </React.Fragment>
              ))}
              <div style={{ height: 14 }} />
            </>
          )}
          <h4>AU</h4>
          <div className={`tag ${au === 'all' ? 'on' : ''}`} onClick={() => pickAu('all')}>전체 <small>{ssuls.length}</small></div>
          {aus.filter(a => auCounts.get(a.key)).map(a => (
            <div key={a.key} className={`tag ${au === a.key ? 'on' : ''}`} onClick={() => pickAu(a.key)}>
              {a.label} <small>{auCounts.get(a.key)}</small>
            </div>
          ))}
          {(auCounts.get('none') ?? 0) > 0 && (
            <div className={`tag ${au === 'none' ? 'on' : ''}`} onClick={() => pickAu('none')}>기타 <small>{auCounts.get('none')}</small></div>
          )}
          {tagCounts.length > 0 && (
            <>
              <h4 style={{ marginTop: 18 }}>태그{tags.length > 0 && <a className="ssul-clear" onClick={() => setTags([])}>해제</a>}</h4>
              <div className="ssul-tagcloud">
                {/* 많이 쓴 20개만 — 고른 태그는 순위 밖이어도 늘 보인다 */}
                {(allTags ? tagCounts : tagCounts.filter(([t], i) => i < TAG_LIMIT || tags.includes(t))).map(([t, n]) => (
                  <span key={t} className={`pill ${tags.includes(t) ? 'dark' : ''}`} onClick={() => toggleTag(t)}>#{t} <small>{n}</small></span>
                ))}
              </div>
              {tagCounts.length > TAG_LIMIT && (
                <a className="ssul-more" onClick={() => setAllTags(v => !v)}>
                  {allTags ? '접기 ▲' : `더보기 (+${tagCounts.length - TAG_LIMIT}) ▼`}
                </a>
              )}
            </>
          )}
        </div>
      </div>
    </section>
  );
}
