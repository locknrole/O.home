// 카톡 대화 내보내기(txt/csv) 파서 — 썰 백업(카톡 아카이브) 1단계.
//
// 지원 형식 (카톡 버전마다 조금씩 다르다):
//   · PC(Windows) txt   — `--------------- 2024년 1월 3일 수요일 ---------------` 날짜줄 +
//                          `[이름] [오후 3:05] 메시지`
//   · 안드로이드 txt     — `2024년 1월 3일 오후 3:05, 이름 : 메시지`
//   · iOS txt           — `2024. 1. 3. 오후 3:05, 이름 : 메시지` (날짜줄 `2024년 1월 3일 수요일` 섞임)
//   · Mac csv           — `Date,User,Message` 헤더 + `"2024-01-03 15:05:00","이름","메시지"`
// 접두가 없는 줄은 바로 앞 메시지의 이어진 줄로 붙인다(여러 줄 메시지).
//
// 서버·브라우저 어디서든 돌도록 순수 함수로만 둔다 (DOM·Node API 안 씀).

export type MsgKind = 'text' | 'photo' | 'video' | 'emoticon' | 'file' | 'voice' | 'deleted' | 'system';

export interface KakaoMsg {
  /** 원본 안에서의 순번 — 검수 화면에서 병합·분할 기준점으로 쓴다 */
  i: number;
  /** 로컬 시각, 'YYYY-MM-DDTHH:mm' (타임존 정보 없음 — 카톡 내보내기가 기기 시간 그대로라) */
  at: string;
  sender: string;
  text: string;
  kind: MsgKind;
  /** 사진 n장 묶음일 때 장수, 미디어 포함 내보내기면 파일 이름 */
  media?: { count?: number; file?: string };
  /** 이모티콘과 글을 같이 보낸 메시지 (본문은 글만 남긴다) */
  sticker?: boolean;
}

export interface ParseResult {
  format: 'pc' | 'android' | 'ios' | 'mac-csv' | 'unknown';
  title?: string;
  msgs: KakaoMsg[];
  /** 어떤 패턴에도 안 맞고 붙일 앞 메시지도 없던 줄 — 형식 인식 실패 점검용 */
  orphans: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (y: number, mo: number, d: number, h: number, mi: number) =>
  `${y}-${pad(mo)}-${pad(d)}T${pad(h)}:${pad(mi)}`;

/** '오후 3:05' / '오전 12:10' / '15:05' → [시, 분] */
function hm(ampm: string | undefined, h: string, m: string): [number, number] {
  let hh = Number(h);
  if (ampm === '오후' || ampm === 'PM') { if (hh < 12) hh += 12; }
  else if (ampm === '오전' || ampm === 'AM') { if (hh === 12) hh = 0; }
  return [hh, Number(m)];
}

const AMPM = '(오전|오후|AM|PM)?\\s*';
// 날짜만 있는 줄 (PC는 대시로 감싸고, 모바일은 맨몸)
const RE_DATE_LINE = /^-*\s*(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*\S*요일\s*-*$/;
// PC: [이름] [오후 3:05] 메시지
const RE_PC = new RegExp(`^\\[(.+?)\\] \\[${AMPM}(\\d{1,2}):(\\d{2})\\] ?(.*)$`);
// 안드로이드: 2024년 1월 3일 오후 3:05, 이름 : 메시지
const RE_AND = new RegExp(`^(\\d{4})년 (\\d{1,2})월 (\\d{1,2})일 ${AMPM}(\\d{1,2}):(\\d{2}),? (.+?) : ?(.*)$`);
// iOS: 2024. 1. 3. 오후 3:05, 이름 : 메시지   (구버전은 '2024. 1. 3. 15:05, …')
const RE_IOS = new RegExp(`^(\\d{4})\\. ?(\\d{1,2})\\. ?(\\d{1,2})\\.? ${AMPM}(\\d{1,2}):(\\d{2}),? (.+?) : ?(.*)$`);
// 모바일 시스템 줄: '2024년 1월 3일 오후 3:05, 누구님이 들어왔습니다.' (콜론 없음)
const RE_AND_SYS = new RegExp(`^(\\d{4})년 (\\d{1,2})월 (\\d{1,2})일 ${AMPM}(\\d{1,2}):(\\d{2}),? (.+)$`);
const RE_IOS_SYS = new RegExp(`^(\\d{4})\\. ?(\\d{1,2})\\. ?(\\d{1,2})\\.? ${AMPM}(\\d{1,2}):(\\d{2}),? (.+)$`);

const RE_PC_SYS = /^.+님(?:이 들어왔습니다|이 나갔습니다|이 .+님을 초대했습니다|을 내보냈습니다)\.?$/;

// 최신 모바일 내보내기는 날짜가 바뀔 때 요일 없이 「날짜 + 첫 메시지 시각」만 한 줄 찍는다 — 구분줄로 버린다
const RE_DT_LINE = new RegExp(`^(?:\\d{4}년 \\d{1,2}월 \\d{1,2}일|\\d{4}\\. ?\\d{1,2}\\. ?\\d{1,2}\\.?) ${AMPM}\\d{1,2}:\\d{2}\\s*$`);
// 접두 없이 한 줄로만 남는 삭제 표시 (누가 지웠는지는 내보내기에 없다)
const RE_DELETED_LINE = /^(?:메시지가 삭제되었습니다|삭제된 메시지입니다)\.?$/;

const RE_HEADER = /^(.+?)(?: 님과)? 카카오톡 대화$|^저장한 날짜\s*:/;

/** 본문만 보고 종류 판정. 미디어 포함 내보내기는 파일 이름이 본문으로 찍힌다. */
export function classify(text: string): Pick<KakaoMsg, 'kind' | 'media'> {
  const t = text.trim();
  let m: RegExpMatchArray | null;
  if (t === '사진') return { kind: 'photo', media: { count: 1 } };
  if ((m = t.match(/^사진 (\d+)장$/))) return { kind: 'photo', media: { count: Number(m[1]) } };
  if (t === '동영상') return { kind: 'video' };
  if (t === '이모티콘' || t === '(이모티콘)') return { kind: 'emoticon' };
  if (t === '음성메시지') return { kind: 'voice' };
  if (t === '삭제된 메시지입니다.' || t === '메시지가 삭제되었습니다.' || t === '채팅방 관리자가 메시지를 가렸습니다.') return { kind: 'deleted' };
  if ((m = t.match(/^파일: (.+)$/))) return { kind: 'file', media: { file: m[1] } };
  if (/^\S+\.(jpe?g|png|gif|webp|heic)$/i.test(t)) return { kind: 'photo', media: { count: 1, file: t } };
  if (/^\S+\.(mp4|mov|m4v)$/i.test(t)) return { kind: 'video', media: { file: t } };
  return { kind: 'text' };
}

/** 이모티콘 + 같이 보낸 글 ('이모티콘\n안녕') → 글로 취급하되 표시 */
function finalize(msg: KakaoMsg): KakaoMsg {
  if (msg.kind !== 'text') return msg;
  const c = classify(msg.text);
  if (c.kind !== 'text') return { ...msg, ...c };
  if (msg.text.startsWith('이모티콘\n')) return { ...msg, text: msg.text.slice(5), sticker: true };
  return msg;
}

/* ---------- CSV (Mac) ---------- */

function parseCsvRows(src: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = '', q = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

function parseMacCsv(src: string): ParseResult {
  const rows = parseCsvRows(src).slice(1);
  const msgs: KakaoMsg[] = [];
  for (const r of rows) {
    if (r.length < 3) continue;
    const m = r[0].match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) continue;
    msgs.push(finalize({
      i: msgs.length, at: iso(+m[1], +m[2], +m[3], +m[4], +m[5]),
      sender: r[1], text: r.slice(2).join(','), kind: 'text',
    }));
  }
  return { format: 'mac-csv', msgs, orphans: [] };
}

/* ---------- txt ---------- */

export function parseKakao(raw: string): ParseResult {
  const src = raw.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  if (/^"?Date"?,"?User"?,"?Message"?/.test(src)) return parseMacCsv(src);

  const lines = src.split('\n');
  const msgs: KakaoMsg[] = [];
  const orphans: string[] = [];
  const votes = { pc: 0, android: 0, ios: 0 };
  let title: string | undefined;
  let day: [number, number, number] | null = null; // PC 형식은 날짜줄에서만 날짜를 안다
  let cur: KakaoMsg | null = null;

  const push = (m: KakaoMsg) => { if (cur) msgs.push(finalize(cur)); cur = m; };

  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    let m: RegExpMatchArray | null;

    if (li < 4 && RE_HEADER.test(line)) {
      const t = line.match(/^(.+?)(?: 님과)? 카카오톡 대화$/);
      if (t) title = t[1];
      continue;
    }
    if (RE_DT_LINE.test(line)) {
      if (cur) { msgs.push(finalize(cur)); cur = null; }
      continue;
    }
    if (cur && RE_DELETED_LINE.test(line.trim())) {
      push({ i: 0, at: (cur as KakaoMsg).at, sender: '', text: line.trim(), kind: 'system' });
      continue;
    }
    if ((m = line.match(RE_DATE_LINE))) {
      day = [+m[1], +m[2], +m[3]];
      if (cur) { msgs.push(finalize(cur)); cur = null; }
      continue;
    }
    if ((m = line.match(RE_PC)) && day) {
      votes.pc++;
      const [h, mi] = hm(m[2], m[3], m[4]);
      push({ i: 0, at: iso(...day, h, mi), sender: m[1], text: m[5], kind: 'text' });
      continue;
    }
    if ((m = line.match(RE_AND)) || (m = line.match(RE_IOS))) {
      votes[m[0].includes('년') ? 'android' : 'ios']++;
      const [h, mi] = hm(m[4], m[5], m[6]);
      push({ i: 0, at: iso(+m[1], +m[2], +m[3], h, mi), sender: m[7], text: m[8], kind: 'text' });
      continue;
    }
    if ((m = line.match(RE_AND_SYS)) || (m = line.match(RE_IOS_SYS))) {
      const [h, mi] = hm(m[4], m[5], m[6]);
      push({ i: 0, at: iso(+m[1], +m[2], +m[3], h, mi), sender: '', text: m[7], kind: 'system' });
      continue;
    }
    // PC 형식 시스템 줄은 시각 접두가 없다 — 알려진 문구면 이어진 줄이 아니라 시스템 메시지로 (시각은 앞 메시지 것)
    if (cur && day && RE_PC_SYS.test(line)) {
      push({ i: 0, at: (cur as KakaoMsg).at, sender: '', text: line, kind: 'system' });
      continue;
    }
    // 이어지는 줄
    if (cur) { (cur as KakaoMsg).text += '\n' + line; continue; }
    if (line.trim()) orphans.push(line);
  }
  if (cur) msgs.push(finalize(cur));

  // 여러 줄 메시지 끝의 빈 줄(다음 날짜줄 앞 공백) 정리 + 순번
  msgs.forEach((m, i) => { m.i = i; m.text = m.text.replace(/\n+$/, ''); });
  const best = (Object.entries(votes) as [ParseResult['format'], number][]).sort((a, b) => b[1] - a[1])[0];
  return { format: best[1] ? best[0] : 'unknown', title, msgs, orphans };
}
