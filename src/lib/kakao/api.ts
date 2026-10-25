// 썰 API 계약 — /api/ssul/* 라우트와 화면이 함께 쓰는 요청·응답 모양 (타입만).
// 오류는 { error: 코드 } — 코드 → 안내 문구는 ssulStore의 ssulErrText.

/* ---------- 업로드 판별 (/api/ssul/analyze) ---------- */
export interface AnalyzeSession {
  id: string;
  /** 사람이 읽는 대화록 — `#순번 이름: 내용` 한 줄씩 */
  text: string;
}
/** 이전 결과 — 이번 세션이 그 썰의 이어지는 부분인지 판단할 때 */
export interface PrevSsul { id: string; title: string; au: string; end: string; tail: string }
export interface AuOption { key: string; label: string; chars: string[] }

export interface AnalyzeRequest {
  me: string;
  partner: string;
  sessions: AnalyzeSession[];
  aus: AuOption[];
  tags: string[];
  prev: PrevSsul[];
}

/** 세션 안의 썰 하나 — 한 세션에서 주제가 바뀌면 여러 개가 나온다 */
export interface SsulPart {
  /** 이 썰의 첫/끝 메시지 순번 — 앞뒤·사이 잡담을 잘라낸다 */
  from: number;
  to: number;
  title: string;
  summary: string;
  /** AuOption.key 또는 '' */
  au: string;
  tags: string[];
  /** 이 썰이 이어 가는 앞 썰(partKey 또는 PrevSsul.id) — 없으면 '' */
  continues: string;
}

export interface AnalyzeResult {
  id: string;
  /** 비어 있으면 잡담만 있던 세션 */
  ssuls: SsulPart[];
}

export interface AnalyzeResponse { results: AnalyzeResult[]; error?: string }

/* ---------- 키워드 정리 제안 (/api/ssul/tags) ---------- */
export interface TagGroup { canonical: string; members: string[] }
export interface TagSuggestRequest { tags: { tag: string; count: number }[] }
export interface TagSuggestResponse { groups: TagGroup[]; error?: string }

/* ---------- 키워드 다시 붙이기 (/api/ssul/retag) ---------- */
export interface RetagItem { id: string; title: string; summary: string; au: string; text: string }
export interface RetagRequest { items: RetagItem[]; tags: string[] }
export interface RetagResponse { results: { id: string; tags: string[] }[]; error?: string }
