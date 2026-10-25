// 저장된 썰 키워드 다시 붙이기 — 썰 묶음(제목·요약·AU·대화록)을 받아 썰마다 새 키워드를 돌려준다.
// 바로 저장하지 않는다 — 업로드 화면 「썰 관리」에서 전/후를 보고 고른 것만 적용한다.
// 키워드 기준은 업로드 판별과 같다(TAG_RULES). 키·모델 설정도 같다 (ANTHROPIC_API_KEY · SSUL_MODEL · SSUL_MOCK).
import { NextRequest } from 'next/server';
import { reply, bearer, readJson, verifyAdmin, claudeMissing, askClaudeJson } from '@/lib/ssulServer';
import { TAG_RULES } from '@/lib/kakao/prompts';
import type { RetagItem, RetagRequest, RetagResponse } from '@/lib/kakao/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

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
  const fail = (error: string, status: number) => reply({ results: [], error } satisfies RetagResponse, status);
  if (!(await verifyAdmin(bearer(req)))) return fail('unauthorized', 401);
  const q = await readJson<RetagRequest>(req);
  if (!q) return fail('bad-request', 400);
  const items = (q.items ?? []).filter(it => it && typeof it.id === 'string');
  if (!items.length) return reply({ results: [] } satisfies RetagResponse);

  const missing = claudeMissing();
  if (missing === 'mock') return reply({ results: mock(items) } satisfies RetagResponse);
  if (missing) return fail(missing, 503);

  const user = `Existing tags: ${(q.tags ?? []).length ? q.tags.join(', ') : '(none)'}

${items.map(it => `<item id="${it.id}">
title: ${it.title}
summary: ${it.summary || '-'}
au: ${it.au || '-'}
${it.text}
</item>`).join('\n\n')}`;
  const r = await askClaudeJson<{ results: RetagResponse['results'] }>({ system: SYSTEM, user, schema: SCHEMA });
  if (!r.ok) return fail(r.error, r.status);
  const ids = new Set(items.map(it => it.id));
  return reply({ results: r.data.results.filter(x => ids.has(x.id)) } satisfies RetagResponse);
}
