// 카톡 대화 → 세션(한 번 몰아서 떠든 덩어리) 자르기 — 썰 백업 1단계.
//
// 규칙은 단순하게: 앞 메시지와 gapMin분 이상 벌어지면 새 세션. 자정은 기준이 아니다
// (밤샘 썰이 날짜로 쪼개지면 안 되므로). 썰/잡담 판별·제목·세계관은 다음 단계(LLM)에서,
// 며칠에 걸친 썰 잇기는 그 다음 단계에서 한다 — 여기서는 판별에 쓸 숫자만 같이 뽑는다.
import type { KakaoMsg } from './parse';

export interface Session {
  /** 시작 메시지 순번 기반 — 다시 잘라도 같은 시작점이면 같은 id */
  id: string;
  from: number;          // 첫 메시지 i
  to: number;            // 마지막 메시지 i (포함)
  start: string;
  end: string;
  /** 바로 앞 세션 끝과의 간격(분) — 다일 썰 잇기 단서 */
  gapBefore: number | null;
  count: number;
  senders: Record<string, number>;
  media: { photo: number; video: number; emoticon: number; file: number };
  /** 글자 수 합 (텍스트 메시지만) */
  chars: number;
  /** 80자 이상 메시지가 차지하는 글자 비율 — 서술형 썰일수록 높다. LLM 전 1차 거르기용 */
  longRatio: number;
}

export interface SplitOptions {
  /** 이 간격(분) 이상 쉬면 새 세션. 기본 180분 */
  gapMin?: number;
  /** 세션 하나가 이 글자 수를 넘으면 거기서 끊는다 — 판별에 한 번에 보내기엔 너무 긴 세션(밤샘 썰 등).
   *  끊긴 조각은 판별 단계에서 「이어짐」으로 다시 합쳐진다. 기본 20,000자 */
  maxChars?: number;
}

/** 'YYYY-MM-DDTHH:mm' → 분 (타임존 무시 — 둘 다 같은 기기 시간이라 차이만 맞으면 된다) */
export function toMin(at: string): number {
  const [d, t] = at.split('T');
  const [y, mo, da] = d.split('-').map(Number);
  const [h, mi] = t.split(':').map(Number);
  return Date.UTC(y, mo - 1, da, h, mi) / 60000;
}

const LONG = 80;

function summarize(msgs: KakaoMsg[], gapBefore: number | null): Session {
  const senders: Record<string, number> = {};
  const media = { photo: 0, video: 0, emoticon: 0, file: 0 };
  let chars = 0, longChars = 0;
  for (const m of msgs) {
    if (m.kind === 'system') continue;
    senders[m.sender] = (senders[m.sender] ?? 0) + 1;
    if (m.kind === 'photo') media.photo += m.media?.count ?? 1;
    else if (m.kind === 'video') media.video++;
    else if (m.kind === 'emoticon') media.emoticon++;
    else if (m.kind === 'file') media.file++;
    if (m.sticker) media.emoticon++;
    if (m.kind === 'text') {
      chars += m.text.length;
      if (m.text.length >= LONG) longChars += m.text.length;
    }
  }
  const a = msgs[0], z = msgs[msgs.length - 1];
  return {
    id: `s${a.i}`, from: a.i, to: z.i, start: a.at, end: z.at, gapBefore,
    count: msgs.length, senders, media, chars,
    longRatio: chars ? Math.round((longChars / chars) * 100) / 100 : 0,
  };
}

export function splitSessions(msgs: KakaoMsg[], opt: SplitOptions = {}): Session[] {
  const gapMin = opt.gapMin ?? 180;
  const maxChars = opt.maxChars ?? 20_000;
  const out: Session[] = [];
  let buf: KakaoMsg[] = [];
  let lastEnd: number | null = null;
  let chars = 0;
  for (const m of msgs) {
    const t = toMin(m.at);
    if (buf.length && (t - toMin(buf[buf.length - 1].at) >= gapMin || chars + m.text.length > maxChars)) {
      out.push(summarize(buf, lastEnd === null ? null : toMin(buf[0].at) - lastEnd));
      lastEnd = toMin(buf[buf.length - 1].at);
      buf = [];
      chars = 0;
    }
    buf.push(m);
    chars += m.text.length + 20;   // 이름·순번 몫
  }
  if (buf.length) out.push(summarize(buf, lastEnd === null ? null : toMin(buf[0].at) - lastEnd));
  return out;
}

/** 메시지 사이 간격 분포 — 자를 기준(gapMin) 고를 때 참고. [구간 라벨, 개수] */
export function gapHistogram(msgs: KakaoMsg[]): [string, number][] {
  const bins: [string, number][] = [
    ['<10분', 10], ['10-30분', 30], ['30분-1h', 60], ['1-2h', 120], ['2-3h', 180],
    ['3-6h', 360], ['6-12h', 720], ['12-24h', 1440], ['1일+', Infinity],
  ];
  const counts = bins.map(() => 0);
  for (let i = 1; i < msgs.length; i++) {
    const g = toMin(msgs[i].at) - toMin(msgs[i - 1].at);
    counts[bins.findIndex(([, max]) => g < max)]++;
  }
  return bins.map(([label], k) => [label, counts[k]]);
}
