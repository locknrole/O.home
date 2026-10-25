// 썰 API 라우트 공용 (서버 전용) — 관리자 확인 · 응답 · Claude 호출.
// /api/ssul/analyze · tags · retag가 같은 순서(관리자 확인 → 요청 읽기 → 키 없으면 mock/no-key → Claude → 오류 매핑)를
// 따르므로, 라우트에는 프롬프트·스키마·결과 거르기만 남긴다.
//
// 환경변수: ANTHROPIC_API_KEY(필수) · SSUL_MODEL(기본 claude-opus-5-5) · SSUL_EFFORT(low|medium|high, 기본 low)
//           SSUL_MOCK=1(개발용 — 키 없이 각 라우트의 가짜 결과)
import { NextRequest, NextResponse } from 'next/server';
import Anthropic from '@anthropic-ai/sdk';
import { serverSideConfig } from '@/lib/siteMeta';

const NO_STORE = { 'Cache-Control': 'no-store' };

/** 캐시하지 않는 JSON 응답 */
export const reply = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });

/** Authorization: Bearer <토큰> */
export const bearer = (req: NextRequest) => (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();

/** 요청 본문 JSON — 깨졌으면 null */
export async function readJson<T>(req: NextRequest): Promise<T | null> {
  try { return await req.json() as T; } catch { return null; }
}

/** 호출한 사람이 관리자인지 — 토큰을 각 서비스의 공개 API로 확인한다 (관리자 키 없이) */
export async function verifyAdmin(token: string): Promise<boolean> {
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

/** 키가 없을 때 — 개발용 mock이 켜져 있으면 'mock', 아니면 'no-key'. 키가 있으면 null */
export const claudeMissing = (): 'mock' | 'no-key' | null =>
  process.env.ANTHROPIC_API_KEY ? null : process.env.SSUL_MOCK === '1' ? 'mock' : 'no-key';

export type ClaudeResult<T> = { ok: true; data: T } | { ok: false; error: string; status: number };

/** 구조화 출력(JSON 스키마)으로 한 번 묻기.
 *  · 안전 분류기가 거절하면 서버에서 알맞은 모델로 다시 돌린다(fallbacks: default — 수위 있는 썰 대비)
 *  · 시스템 지시는 묶음마다 같으니 캐시
 *  · 오류는 화면이 알아듣는 코드로 (크레딧 부족은 400으로 오므로 메시지로 구분) */
export async function askClaudeJson<T>(o: { system: string; user: string; schema: Record<string, unknown> }): Promise<ClaudeResult<T>> {
  const effort = (['low', 'medium', 'high'].includes(process.env.SSUL_EFFORT ?? '') ? process.env.SSUL_EFFORT : 'low') as 'low' | 'medium' | 'high';
  try {
    const res = await new Anthropic().beta.messages.create({
      model: process.env.SSUL_MODEL || 'claude-opus-5-5',
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      system: [{ type: 'text', text: o.system, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: o.user }],
      output_config: { effort, format: { type: 'json_schema', schema: o.schema } },
    });
    if (res.stop_reason === 'refusal') return { ok: false, error: 'refusal', status: 422 };
    if (res.stop_reason === 'max_tokens') return { ok: false, error: 'too-long', status: 422 };
    const text = res.content.map(b => (b.type === 'text' ? b.text : '')).join('');
    return { ok: true, data: JSON.parse(text) as T };
  } catch (err) {
    if (err instanceof Anthropic.AuthenticationError) return { ok: false, error: 'bad-key', status: 503 };
    if (err instanceof Anthropic.RateLimitError) return { ok: false, error: 'rate-limit', status: 429 };
    if (err instanceof Anthropic.APIError) {
      if (/credit balance/i.test(err.message)) return { ok: false, error: 'no-credit', status: 402 };
      return { ok: false, error: err.message, status: err.status ?? 502 };
    }
    return { ok: false, error: err instanceof Error ? err.message : String(err), status: 502 };
  }
}
