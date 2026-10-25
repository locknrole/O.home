// 썰 키워드 정리 제안 — 뜻이 같은 키워드끼리 묶어 「무엇으로 통일할지」를 돌려준다 (예: 가정상황·만약에 → IF).
// 바로 고치지 않는다 — 업로드 화면에서 관리자가 묶음마다 보고 적용한다.
// 키·모델 설정은 /api/ssul/analyze와 같다 (ANTHROPIC_API_KEY · SSUL_MODEL · SSUL_MOCK).
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { verifyAdmin } from '@/lib/serverAuth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const NO_STORE = { 'Cache-Control': 'no-store' };

export interface TagGroup { canonical: string; members: string[] }
export interface TagSuggestRequest { tags: { tag: string; count: number }[] }
export interface TagSuggestResponse { groups: TagGroup[]; error?: string }

const SYSTEM = `You tidy the keyword tags of a personal archive of Korean character-roleplay stories ("썰").
Group tags that mean the same thing or are trivial variants of one another (synonyms, spelling or spacing variants, abbreviations, verb/noun forms — e.g. "가정상황" and "IF", "업어주기" and "업기"). Do not group tags that are merely related (e.g. "비" and "눈", "재회" and "이별").
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
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!(await verifyAdmin(token))) return NextResponse.json({ groups: [], error: 'unauthorized' } satisfies TagSuggestResponse, { status: 401, headers: NO_STORE });

  let q: TagSuggestRequest;
  try { q = await req.json() as TagSuggestRequest; } catch { return NextResponse.json({ groups: [], error: 'bad-request' }, { status: 400 }); }
  const tags = (q.tags ?? []).filter(t => t && typeof t.tag === 'string' && t.tag.trim()).slice(0, 1000);
  if (tags.length < 2) return NextResponse.json({ groups: [] } satisfies TagSuggestResponse, { headers: NO_STORE });

  if (!process.env.ANTHROPIC_API_KEY) {
    if (process.env.SSUL_MOCK === '1') return NextResponse.json({ groups: mock(tags) } satisfies TagSuggestResponse, { headers: NO_STORE });
    return NextResponse.json({ groups: [], error: 'no-key' }, { status: 503, headers: NO_STORE });
  }

  const client = new Anthropic();
  try {
    const res = await client.beta.messages.create({
      model: process.env.SSUL_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: SYSTEM,
      messages: [{ role: 'user', content: `Tags (tag × count):\n${tags.map(t => `${t.tag} × ${t.count}`).join('\n')}` }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    });
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') {
      return NextResponse.json({ groups: [], error: res.stop_reason } satisfies TagSuggestResponse, { status: 422, headers: NO_STORE });
    }
    const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('');
    const known = new Set(tags.map(t => t.tag));
    // 모델이 목록에 없는 키워드를 지어내면 버린다
    const groups = (JSON.parse(text) as { groups: TagGroup[] }).groups
      .map(g => ({ canonical: g.canonical, members: [...new Set(g.members.filter(m => known.has(m)))] }))
      .filter(g => g.members.length >= 2 && g.members.includes(g.canonical));
    return NextResponse.json({ groups } satisfies TagSuggestResponse, { headers: NO_STORE });
  } catch (err) {
    const status = err instanceof Anthropic.RateLimitError ? 429
      : err instanceof Anthropic.AuthenticationError ? 503
        : err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    const error = err instanceof Anthropic.AuthenticationError ? 'bad-key'
      : err instanceof Anthropic.RateLimitError ? 'rate-limit'
        : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ groups: [], error } satisfies TagSuggestResponse, { status, headers: NO_STORE });
  }
}
