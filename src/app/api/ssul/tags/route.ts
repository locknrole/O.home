// 썰 키워드 정리 제안 — 뜻이 같은 키워드끼리 묶어 「무엇으로 통일할지」를 돌려준다 (예: 가정상황·만약에 → IF).
// 바로 고치지 않는다 — 업로드 화면에서 관리자가 묶음마다 보고 적용한다.
// 키·모델 설정은 /api/ssul/analyze와 같다 (ANTHROPIC_API_KEY · SSUL_MODEL · SSUL_MOCK).
import { NextRequest } from 'next/server';
import { reply, bearer, readJson, verifyAdmin, claudeMissing, askClaudeJson } from '@/lib/ssulServer';
import type { TagGroup, TagSuggestRequest, TagSuggestResponse } from '@/lib/kakao/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const SYSTEM = `You tidy the keyword tags of a personal archive of Korean character-roleplay stories ("썰").
Group tags that mean the same thing or are trivial variants of one another (synonyms, spelling or spacing variants, abbreviations, verb/noun forms — e.g. "가정상황" and "IF", "업어주기" and "업기"). Do not group tags that are merely related (e.g. "비" and "눈", "재회" and "이별"), and never fold a specific tag into a broader one (e.g. "안드로이드" or "뱀파이어" into "IF", "학원" into "AU") — the specific tag is what people search for.
For each group pick the canonical tag: prefer the one the archive already uses most (highest count), unless another member is clearly the more standard short form. The canonical tag must be one of the members.
Only return groups with two or more members. Tags that have no synonym in the list are left out.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['groups'],
  properties: {
    groups: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['canonical', 'members'],
        properties: { canonical: { type: 'string' }, members: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
} as const;

/** 키 없이 화면만 확인할 때 — 한쪽이 다른 쪽을 포함하면 묶는다 */
function mock(tags: { tag: string; count: number }[]): TagGroup[] {
  const used = new Set<string>();
  const out: TagGroup[] = [];
  const sorted = [...tags].sort((a, b) => a.tag.length - b.tag.length);
  for (const a of sorted) {
    if (used.has(a.tag)) continue;
    const members = sorted.filter(b => !used.has(b.tag) && b.tag !== a.tag && b.tag.includes(a.tag)).map(b => b.tag);
    if (!members.length) continue;
    [a.tag, ...members].forEach(t => used.add(t));
    out.push({ canonical: a.tag, members: [a.tag, ...members] });
  }
  return out;
}

export async function POST(req: NextRequest) {
  const fail = (error: string, status: number) => reply({ groups: [], error } satisfies TagSuggestResponse, status);
  if (!(await verifyAdmin(bearer(req)))) return fail('unauthorized', 401);
  const q = await readJson<TagSuggestRequest>(req);
  if (!q) return fail('bad-request', 400);
  const tags = (q.tags ?? []).filter(t => t && typeof t.tag === 'string' && t.tag.trim()).slice(0, 1000);
  if (tags.length < 2) return reply({ groups: [] } satisfies TagSuggestResponse);

  const missing = claudeMissing();
  if (missing === 'mock') return reply({ groups: mock(tags) } satisfies TagSuggestResponse);
  if (missing) return fail(missing, 503);

  const r = await askClaudeJson<{ groups: TagGroup[] }>({
    system: SYSTEM, schema: SCHEMA,
    user: `Tags (tag × count):\n${tags.map(t => `${t.tag} × ${t.count}`).join('\n')}`,
  });
  if (!r.ok) return fail(r.error, r.status);
  // 모델이 목록에 없는 키워드를 지어내면 버린다
  const known = new Set(tags.map(t => t.tag));
  const groups = r.data.groups
    .map(g => ({ canonical: g.canonical, members: [...new Set(g.members.filter(m => known.has(m)))] }))
    .filter(g => g.members.length >= 2 && g.members.includes(g.canonical));
  return reply({ groups } satisfies TagSuggestResponse);
}
