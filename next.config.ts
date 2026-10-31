import type { NextConfig } from "next";

/* 기본 보안 헤더 (v2.1) — 동작은 그대로 두고 흔한 공격 통로만 닫는다.
   · nosniff: 올린 파일을 브라우저가 멋대로 HTML·스크립트로 해석하지 않게
   · frame-ancestors: 다른 사이트가 이 홈을 투명 프레임으로 덮어 클릭을 가로채지 못하게
   · Referrer: 다른 사이트로 나갈 때 글 주소(경로)까지 넘기지 않게
   · Permissions: 쓰지 않는 카메라·마이크·위치 권한은 아예 막는다
   CSP(스크립트 출처 제한)는 유튜브 BGM·인라인 테마 스크립트와 얽혀 있어 따로 다룬다 */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
