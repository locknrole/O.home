'use client';
// 인용구 모음 (v2.1 사용자 요청) — 옮겨 적은 문장을 카드로 모아 보는 게시판.
// 카드 앞면 = 본문, UFO를 누르면 빛줄기가 위에서 아래로 훑으며 같은 자리가 뒷면(출처·코멘트·댓글)으로 바뀐다 (app/quotes/page.tsx)
import type { Visibility } from './charStore';

export const QUOTE_KEY = 'ohome.quotes.v1';

export interface Quote {
  id: string;
  no: number;                // 화면의 「No. N」 — 지워도 다른 카드 번호는 그대로
  text: string;
  source: string;            // 출처 (작가 <작품>) — 비워도 된다
  memo: string;              // 옮겨 적은 사람의 코멘트 — 뒷면에만
  author: string;
  authorId: string;
  visibility: Visibility;
  date: string;              // ISO
}

export const QUOTE_SEED: Quote[] = [];

/** 2025-09-30 02:26:25 */
export const fmtQuoteDate = (iso: string) => {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
};
