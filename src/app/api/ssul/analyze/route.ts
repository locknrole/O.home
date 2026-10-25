// 썰 판별 (썰 백업 — 카톡 아카이브). 업로드 화면이 세션 묶음을 보내면 Claude가
// 썰/잡담을 가르고 제목·요약·AU·태그·이어짐을 돌려준다.
//
// API 키는 브라우저에 둘 수 없으므로 Vercel 환경변수 ANTHROPIC_API_KEY 에 둔다.
//   SSUL_MODEL   (선택) 기본 claude-opus-5-5
//   SSUL_EFFORT  (선택) low | medium | high — 기본 low (분류라 깊게 생각할 필요가 적다)
//   SSUL_MOCK=1  (개발용) 키 없이 글자 수로 대충 가른다 — 화면 흐름 확인용
// 키를 가진 서버를 아무나 쓰지 못하게, 호출한 사람이 **이 홈의 관리자**인지 확인한다.
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { verifyAdmin, claudeError } from '@/lib/serverAuth';
import { TAG_RULES } from '@/lib/kakao/prompts';
import type { AnalyzeRequest, AnalyzeResult, AnalyzeResponse } from '@/lib/kakao/analyze';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'no-store' };

const SYSTEM = `You sort KakaoTalk chat logs between two friends who do 자캐 (original-character) roleplay and storytelling together. Your output feeds a personal archive of their "썰" — the stories they spin about their characters.

A 썰 is creative content: narrating scenes, headcanons, what-if scenarios, AU (alternate universe) setups, character backstory or relationship dynamics, dialogue written for characters, worldbuilding. Reactions to that content ("미쳤다", "ㅠㅠㅠ", "그래서 어떻게 됐어") belong to the 썰 when they sit inside it.
잡담 (chit-chat) is everything else: daily life, meals, plans, work/school, memes, logistics, news, scheduling a session, talking about other media without spinning their own story. A session that is mostly 잡담 with one passing mention of a character is 잡담.

A session can hold several 썰. Start a new entry when the topic changes (a different story, scene set, AU, or pair of characters), and also whenever 잡담 comes between two story parts, so that no entry contains 잡담. If the part after the 잡담 is the same story as the part before it, mark it with continues so the two are joined into one post without the 잡담; if it is a different topic, leave continues empty so it becomes its own post. Reactions to the story itself ("미쳤다", "ㅠㅠ", "그래서?") are part of the 썰, not 잡담.

For each session you receive (lines look like "#<index> <name>: <text>"; "나(...)" is the archive owner), return "ssuls": one entry per distinct 썰 in it, in order. Use an empty list when the session is only 잡담. For each entry:
- from / to: the first and last message index of that 썰, with no 잡담 inside it. Entries must not overlap.
- title: a short, evocative Korean title (≤ 20 characters) naming what happens, not "썰" or the date.
- summary: one Korean sentence (≤ 80 characters).
- au: the key of the AU option it belongs to, chosen only when the characters or setting clearly match; otherwise "". Do not invent keys.
- tags: ${TAG_RULES}
- continues: if this 썰 is the same story as an earlier 썰 — an earlier entry of this same session (split only by 잡담), an earlier session in this batch, a "previous 썰", or a session that was cut mid-story — give that earlier 썰's id; otherwise "". The id of a 썰 in this batch is "<session id>#<its 0-based position in that session's ssuls>"; previous 썰 ids are given in their list. Only point backwards in time.

Return one result per session, using the session ids exactly as given.`;

const PART = {
  type: 'object',
  additionalProperties: false,
  required: ['from', 'to', 'title', 'summary', 'au', 'tags', 'continues'],
  properties: {
    from: { type: 'integer' },
    to: { type: 'integer' },
    title: { type: 'string' },
    summary: { type: 'string' },
    au: { type: 'string' },
    tags: { type: 'array', items: { type: 'string' } },
    continues: { type: 'string' },
  },
} as const;

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
        required: ['id', 'ssuls'],
        properties: { id: { type: 'string' }, ssuls: { type: 'array', items: PART } },
      },
    },
  },
} as const;

function userContent(q: AnalyzeRequest): string {
  const aus = q.aus.length
    ? q.aus.map(a => `- ${a.key} | ${a.label}${a.chars.length ? ` | 캐릭터: ${a.chars.join(', ')}` : ''}`).join('\n')
    : '(none)';
  const prev = q.prev.length
    ? q.prev.map(p => `- ${p.id} | ${p.title} | au=${p.au || '-'} | ended ${p.end}\n  last lines: ${p.tail}`).join('\n')
    : '(none)';
  const sessions = q.sessions.map(s => `<session id="${s.id}">\n${s.text}\n</session>`).join('\n\n');
  return `Archive owner: ${q.me} / chat partner: ${q.partner}

AU options (key | 자관 · AU | characters):
${aus}

Existing tags: ${q.tags.length ? q.tags.join(', ') : '(none)'}

Previous 썰 (most recent last):
${prev}

Sessions:
${sessions}`;
}

/** 키 없이 화면만 확인할 때 — 장문 비율로 대충 가른다. 「생각났는데·생각남」으로 시작하는 줄에서 주제를 나눈다 */
function mock(q: AnalyzeRequest): AnalyzeResult[] {
  return q.sessions.map(s => {
    const lines = s.text.split('\n').filter(l => l.startsWith('#'));
    const idx = (l: string) => Number(l.slice(1, l.indexOf(' ')));
    const groups: string[][] = [];
    for (const l of lines) {
      if (!groups.length || (/생각났는데|생각남/.test(l) && groups[groups.length - 1].length > 1)) groups.push([]);
      groups[groups.length - 1].push(l);
    }
    const ssuls = groups.filter(g => g.filter(l => l.length > 90).length >= 2).map(g => ({
      from: idx(g[0]), to: idx(g[g.length - 1]),
      title: (g.find(l => l.length > 90) ?? '').replace(/^#\d+ [^:]+: /, '').slice(0, 16),
      summary: '', au: '', tags: ['미분류'],
      continues: /이어서|계속/.test(g[0]) && q.prev.length ? q.prev[q.prev.length - 1].id : '',
    }));
    return { id: s.id, ssuls };
  });
}

export async function POST(req: NextRequest) {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!(await verifyAdmin(token))) return NextResponse.json({ results: [], error: 'unauthorized' }, { status: 401, headers: NO_STORE });

  let q: AnalyzeRequest;
  try { q = await req.json() as AnalyzeRequest; } catch { return NextResponse.json({ results: [], error: 'bad-request' }, { status: 400 }); }
  if (!Array.isArray(q.sessions) || !q.sessions.length) return NextResponse.json({ results: [] } satisfies AnalyzeResponse);

  if (!process.env.ANTHROPIC_API_KEY) {
    if (process.env.SSUL_MOCK === '1') return NextResponse.json({ results: mock(q) } satisfies AnalyzeResponse, { headers: NO_STORE });
    return NextResponse.json({ results: [], error: 'no-key' }, { status: 503, headers: NO_STORE });
  }

  const client = new Anthropic();
  const effort = (['low', 'medium', 'high'].includes(process.env.SSUL_EFFORT ?? '') ? process.env.SSUL_EFFORT : 'low') as 'low' | 'medium' | 'high';
  try {
    const res = await client.beta.messages.create({
      model: process.env.SSUL_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      // 안전 분류기가 거절하면 서버에서 알맞은 모델로 다시 돌린다 (수위 있는 썰 대비)
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // 시스템 지시는 업로드 내내 같다 — 묶음마다 다시 내지 않게 캐시
      system: [{ type: 'text', text: SYSTEM, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: userContent(q) }],
      output_config: { effort, format: { type: 'json_schema', schema: SCHEMA } },
    });
    if (res.stop_reason === 'refusal') {
      return NextResponse.json({ results: [], error: 'refusal' } satisfies AnalyzeResponse, { status: 422, headers: NO_STORE });
    }
    if (res.stop_reason === 'max_tokens') {
      return NextResponse.json({ results: [], error: 'too-long' } satisfies AnalyzeResponse, { status: 422, headers: NO_STORE });
    }
    const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('');
    const out = JSON.parse(text) as { results: AnalyzeResult[] };
    const ids = new Set(q.sessions.map(s => s.id));
    return NextResponse.json({ results: out.results.filter(r => ids.has(r.id)) } satisfies AnalyzeResponse, { headers: NO_STORE });
  } catch (err) {
    const { error, status } = await claudeError(err);
    return NextResponse.json({ results: [], error } satisfies AnalyzeResponse, { status, headers: NO_STORE });
  }
}
