// 서버 라우트 공용 — 호출한 사람이 이 홈의 관리자인지 확인 (썰 판별·키워드 정리처럼 API 키를 쓰는 라우트용).
// 관리자 키 없이 각 서비스의 공개 API로 확인한다.
import { serverSideConfig } from '@/lib/siteMeta';

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

/** Claude API 오류 → 화면이 알아듣는 코드 + HTTP 상태. 크레딧 부족은 400으로 오므로 메시지로 구분한다 */
export async function claudeError(err: unknown): Promise<{ error: string; status: number }> {
  const Anthropic = (await import('@anthropic-ai/sdk')).default;
  if (err instanceof Anthropic.AuthenticationError) return { error: 'bad-key', status: 503 };
  if (err instanceof Anthropic.RateLimitError) return { error: 'rate-limit', status: 429 };
  if (err instanceof Anthropic.APIError) {
    if (/credit balance/i.test(err.message)) return { error: 'no-credit', status: 402 };
    return { error: err.message, status: err.status ?? 502 };
  }
  return { error: err instanceof Error ? err.message : String(err), status: 502 };
}
