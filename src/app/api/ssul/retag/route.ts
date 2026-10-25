// 저장된 썰 키워드 다시 붙이기 — 썰 묶음(제목·요약·AU·대화록)을 받아 썰마다 새 키워드를 돌려준다.
// 바로 저장하지 않는다 — 업로드 화면 「썰 관리」에서 전/후를 보고 고른 것만 적용한다.
// 키워드 기준은 업로드 판별과 같다(TAG_RULES). 키·모델 설정도 같다 (ANTHROPIC_API_KEY · SSUL_MODEL · SSUL_MOCK).
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { verifyAdmin, claudeError } from '@/lib/serverAuth';
import { TAG_RULES } from '@/lib/kakao/prompts';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'no-store' };

export interface RetagItem { id: string; title: string; summary: string; au: string; text: string }
export interface RetagRequest { items: RetagItem[]; tags: string[] }
export interface RetagResponse { results: { id: string; tags: string[] }[]; error?: string }

const SYSTEM = `You re-tag stories ("썰") in a personal archive of Korean character-roleplay chats between two friends. Each item gives the story's title, one-line summary, AU (alternate universe) label if any, and the chat log itself (lines "#<index> <name>: <text>", possibly shortened in the middle).
Read the chat and give each story fresh tags.
- tags: ${TAG_RULES}
Return one result per item, using the item ids exactly as given.`;

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['results'],
  properties: {
    results: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['id', 'tags'],
        properties: { id: { type: 'string' }, tags: { type: 'array', items: { type: 'string' } } },
      },
    },
  },
} as const;

/** 키 없이 화면만 확인할 때 — 제목 첫 낱말을 키워드로 */
function mock(items: RetagItem[]): RetagResponse['results'] {
  return items.map(it => ({ id: it.id, tags: [it.title.split(/\s+/)[0] || '미분류', '다시붙임'] }));
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!(await verifyAdmin(token))) return NextResponse.json({ results: [], error: 'unauthorized' } satisfies RetagResponse, { status: 401, headers: NO_STORE });

  let q: RetagRequest;
  try { q = await req.json() as RetagRequest; } catch { return NextResponse.json({ results: [], error: 'bad-request' }, { status: 400 }); }
  const items = (q.items ?? []).filter(it => it && typeof it.id === 'string');
  if (!items.length) return NextResponse.json({ results: [] } satisfies RetagResponse, { headers: NO_STORE });

  if (!process.env.ANTHROPIC_API_KEY) {
    if (process.env.SSUL_MOCK === '1') return NextResponse.json({ results: mock(items) } satisfies RetagResponse, { headers: NO_STORE });
    return NextResponse.json({ results: [], error: 'no-key' }, { status: 503, headers: NO_STORE });
  }

  const body = `Existing tags: ${(q.tags ?? []).length ? q.tags.join(', ') : '(none)'}

${items.map(it => `<item id="${it.id}">
title: ${it.title}
summary: ${it.summary || '-'}
au: ${it.au || '-'}
${it.text}
</item>`).join('\n\n')}`;

  const client = new Anthropic();
  try {
    const res = await client.beta.messages.create({
      model: process.env.SSUL_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: body }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: SCHEMA } },
    });
    if (res.stop_reason === 'refusal' || res.stop_reason === 'max_tokens') {
      return NextResponse.json({ results: [], error: res.stop_reason === 'refusal' ? 'refusal' : 'too-long' } satisfies RetagResponse, { status: 422, headers: NO_STORE });
    }
    const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('');
    const ids = new Set(items.map(it => it.id));
    const results = (JSON.parse(text) as { results: { id: string; tags: string[] }[] }).results.filter(r => ids.has(r.id));
    return NextResponse.json({ results } satisfies RetagResponse, { headers: NO_STORE });
  } catch (err) {
    const { error, status } = await claudeError(err);
    return NextResponse.json({ results: [], error } satisfies RetagResponse, { status, headers: NO_STORE });
  }
}
