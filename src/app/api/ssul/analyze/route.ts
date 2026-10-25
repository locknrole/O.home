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
import { serverSideConfig } from '@/lib/siteMeta';
import type { AnalyzeRequest, AnalyzeResult, AnalyzeResponse } from '@/lib/kakao/analyze';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

const NO_STORE = { 'Cache-Control': 'no-store' };

/** 호출한 사람이 관리자인지 — 토큰을 각 서비스의 공개 API로 확인한다 (관리자 키 없이) */
async function verifyAdmin(token: string): Promise<boolean> {
  const cfg = await serverSideConfig();
  if (!cfg) return process.env.NODE_ENV === 'development';   // 브라우저 저장 모드 — 개발 중에만
  if (!token) return false;
  try {
    if (cfg.kind === 'supabase') {
      const r = await fetch(`${cfg.url}/rest/v1/rpc/is_admin`, {
        method: 'POST', cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, apikey: cfg.anonKey, 'Content-Type': 'application/json' },
        body: '{}',
      });
      return r.ok && (await r.json()) === true;
    }
    // Firebase — 토큰으로 uid를 확인한 뒤, 공개 문서 meta/owner의 소유자·관리자 목록과 맞춘다
    const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(cfg.apiKey)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ idToken: token }), cache: 'no-store',
    });
    if (!r.ok) return false;
    const uid = ((await r.json()) as { users?: { localId?: string }[] }).users?.[0]?.localId;
    if (!uid) return false;
    const db = encodeURIComponent(cfg.databaseId?.trim() || '(default)');
    const o = await fetch(
      `https://firestore.googleapis.com/v1/projects/${cfg.projectId}/databases/${db}/documents/meta/owner?key=${encodeURIComponent(cfg.apiKey)}`,
      { cache: 'no-store' },
    );
    if (!o.ok) return false;
    const f = ((await o.json()) as { fields?: Record<string, { stringValue?: string; arrayValue?: { values?: { stringValue?: string }[] } }> }).fields ?? {};
    const admins = (f.admins?.arrayValue?.values ?? []).map(v => v.stringValue);
    return f.uid?.stringValue === uid || admins.includes(uid);
  } catch { return false; }
}

const SYSTEM = `You sort KakaoTalk chat logs between two friends who do 자캐 (original-character) roleplay and storytelling together. Your output feeds a personal archive of their "썰" — the stories they spin about their characters.

A 썰 is creative content: narrating scenes, headcanons, what-if scenarios, AU (alternate universe) setups, character backstory or relationship dynamics, dialogue written for characters, worldbuilding. Reactions to that content ("미쳤다", "ㅠㅠㅠ", "그래서 어떻게 됐어") belong to the 썰 when they sit inside it.
잡담 (chit-chat) is everything else: daily life, meals, plans, work/school, memes, logistics, news, scheduling a session, talking about other media without spinning their own story. A session that is mostly 잡담 with one passing mention of a character is 잡담.

For each session you receive (lines look like "#<index> <name>: <text>"; "나(...)" is the archive owner):
- isSsul: true only if the session contains a real 썰.
- from / to: the first and last message index of the 썰 part, trimming leading and trailing 잡담. Keep 잡담 that is interleaved in the middle. If isSsul is false, use the session's first and last index.
- title: a short, evocative Korean title (≤ 20 characters) naming what happens, not "썰" or the date. Empty if not a 썰.
- summary: one Korean sentence (≤ 80 characters). Empty if not a 썰.
- au: the key of the AU option it belongs to, chosen only when the characters or setting clearly match; otherwise "". Do not invent keys.
- tags: 2–5 short Korean keywords (themes, tropes, situations, settings). Reuse an existing tag when one fits instead of coining a synonym. Do not repeat the AU or character names as tags. Empty if not a 썰.
- continues: if this session clearly picks up a 썰 from an earlier session in this batch or from the "previous 썰" list (e.g. "어제 썰 이어서", the same scene continuing), give that session's id or previous 썰 id; otherwise "". Only point backwards in time.

Return one result per session, using the session ids exactly as given.`;

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
        required: ['id', 'isSsul', 'from', 'to', 'title', 'summary', 'au', 'tags', 'continues'],
        properties: {
          id: { type: 'string' },
          isSsul: { type: 'boolean' },
          from: { type: 'integer' },
          to: { type: 'integer' },
          title: { type: 'string' },
          summary: { type: 'string' },
          au: { type: 'string' },
          tags: { type: 'array', items: { type: 'string' } },
          continues: { type: 'string' },
        },
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

/** 키 없이 화면만 확인할 때 — 장문 비율로 대충 가른다 */
function mock(q: AnalyzeRequest): AnalyzeResult[] {
  return q.sessions.map(s => {
    const lines = s.text.split('\n').filter(l => l.startsWith('#'));
    const idx = lines.map(l => Number(l.slice(1, l.indexOf(' '))));
    const long = lines.filter(l => l.length > 90).length;
    const isSsul = long >= 2;
    return {
      id: s.id, isSsul, from: idx[0] ?? 0, to: idx[idx.length - 1] ?? 0,
      title: isSsul ? (lines.find(l => l.length > 90) ?? '').replace(/^#\d+ [^:]+: /, '').slice(0, 16) : '',
      summary: '', au: '', tags: isSsul ? ['미분류'] : [],
      continues: /이어서|계속/.test(lines[0] ?? '') && q.prev.length ? q.prev[q.prev.length - 1].id : '',
    };
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
    const status = err instanceof Anthropic.RateLimitError ? 429
      : err instanceof Anthropic.AuthenticationError ? 503
        : err instanceof Anthropic.APIError ? (err.status ?? 502) : 502;
    const error = err instanceof Anthropic.AuthenticationError ? 'bad-key'
      : err instanceof Anthropic.RateLimitError ? 'rate-limit'
        : err instanceof Error ? err.message : String(err);
    return NextResponse.json({ results: [], error } satisfies AnalyzeResponse, { status, headers: NO_STORE });
  }
}
