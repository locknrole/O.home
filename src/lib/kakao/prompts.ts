// 썰 판별 프롬프트 공용 조각 — 업로드 판별(/api/ssul/analyze)과 키워드 다시 붙이기(/api/ssul/retag)가
// 같은 기준으로 키워드를 붙이도록 한 곳에 둔다.

/** 키워드 규칙 — 구체적인 설정·소재를 먼저, 범용 키워드는 덧붙일 때만 (사용자 요청: 안드로이드 썰에 IF만 붙던 문제) */
export const TAG_RULES = `2–5 short Korean keywords that would let someone find this 썰 again. Lead with the concrete specifics: the premise or setup (e.g. 안드로이드, 뱀파이어, 기억상실, 계약연애, 학원), the setting or world, the situation or event (e.g. 첫만남, 고백, 이별, 재회), and recognizable tropes. A broad label such as "IF", "AU", "일상" or "썰" may be added only alongside specific tags, never instead of them — an android-premise 썰 must carry "안드로이드" even if it is also an IF. Prefer a tag from the existing list when it names the same concept (including spelling or wording variants of it), but never swap a specific concept for a broader existing tag; if no existing tag names the concept, write a new one. Do not repeat the AU or character names as tags.`;
