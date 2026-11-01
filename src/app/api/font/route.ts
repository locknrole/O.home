// 업로드 폰트 파일 같은 출처 중계 (v2.0 사용자 제보 — 「등록한 폰트가 적용이 안 돼요」).
//
// 서버 모드의 폰트 파일은 저장소(파이어베이스/수파베이스)의 공개 URL인데, **폰트는 브라우저가
// CORS를 강제하는 자원**이라(이미지와 다르다) 저장소가 허용 헤더를 안 주면 로드가 통째로
// 거부된다 — 등록은 되는데 화면은 조용히 폴백 글꼴로 남는 원인. 이 라우트가 서버에서 대신
// 받아 같은 출처로 내주면 CORS가 아예 걸리지 않는다. 백업 옮기기(transfer.ts)의 원본 받기도 쓴다.
//
// 보안 (v2.1) — 예전엔 *아무* 파이어베이스/수파베이스 프로젝트의 파일을 원래 형식 그대로 내줬다.
// 남의 저장소에 올린 HTML을 이 주소로 열면 우리 사이트 출처에서 스크립트가 돌아 로그인 정보를
// 읽을 수 있었다. 이제 ① 이 홈의 저장소 파일만 받고 ② 어떤 형식이든 실행·렌더되지 않게 내준다.
import { serverSideConfig } from '@/lib/siteMeta';

export const runtime = 'nodejs';

/** 이 홈의 저장소 파일인지 — 설정이 없으면(브라우저 저장 모드) 저장소 파일 자체가 없다 */
async function isOwnStorage(target: URL): Promise<boolean> {
  if (target.protocol !== 'https:') return false;
  const cfg = await serverSideConfig();
  if (!cfg) return false;
  if (cfg.kind === 'supabase') {
    try { return target.hostname === new URL(cfg.url).hostname; } catch { return false; }
  }
  // https://firebasestorage.googleapis.com/v0/b/<버킷>/o/<경로>
  const m = target.pathname.match(/^\/v0\/b\/([^/]+)\/o\//);
  if (target.hostname !== 'firebasestorage.googleapis.com' || !m) return false;
  // 버킷 이름을 적어 두지 않은 설치는 프로젝트 기본 버킷 두 가지(신·구 이름)를 허용한다
  const own = cfg.storageBucket ? [cfg.storageBucket] : [`${cfg.projectId}.firebasestorage.app`, `${cfg.projectId}.appspot.com`];
  return own.includes(decodeURIComponent(m[1]));
}

export async function GET(req: Request) {
  const u = new URL(req.url).searchParams.get('u') ?? '';
  let target: URL;
  try { target = new URL(u); } catch { return new Response('bad url', { status: 400 }); }
  if (!(await isOwnStorage(target))) return new Response('host not allowed', { status: 400 });
  try {
    const res = await fetch(target, { cache: 'no-store', redirect: 'error' });
    if (!res.ok || !res.body) return new Response('fetch failed', { status: 502 });
    return new Response(res.body, {
      headers: {
        'content-type': res.headers.get('content-type') ?? 'application/octet-stream',
        // 주소창에 직접 열어도 페이지로 렌더되거나 스크립트가 돌지 않게 — fetch·FontFace에는 영향 없다
        'content-disposition': 'attachment',
        'content-security-policy': "sandbox; default-src 'none'",
        'x-content-type-options': 'nosniff',
        // 파일 주소에 고유 id가 들어 있어 내용이 변할 일이 없다 — 오래 캐시
        'cache-control': 'public, max-age=31536000, immutable',
      },
    });
  } catch {
    return new Response('fetch failed', { status: 502 });
  }
}
