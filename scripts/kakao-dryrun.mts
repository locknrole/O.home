// 카톡 내보내기 파일 → 파싱·세션 분할 결과를 터미널에 찍어 본다 (아무 데도 올리지 않음).
//   node scripts/kakao-dryrun.mts <대화.txt|csv> [자를간격분=180] [--json 결과.json]
import { readFileSync, writeFileSync } from 'node:fs';
import { parseKakao } from '../src/lib/kakao/parse.ts';
import { splitSessions, gapHistogram } from '../src/lib/kakao/segment.ts';

const args = process.argv.slice(2);
const file = args[0];
if (!file) { console.error('사용법: node scripts/kakao-dryrun.mts <대화.txt> [간격분] [--json out.json]'); process.exit(1); }
const gapMin = Number(args.find((a, k) => k > 0 && /^\d+$/.test(a)) ?? 180);
const jsonOut = args.includes('--json') ? args[args.indexOf('--json') + 1] : null;

const res = parseKakao(readFileSync(file, 'utf8'));
const kinds: Record<string, number> = {};
for (const m of res.msgs) kinds[m.kind] = (kinds[m.kind] ?? 0) + 1;
const senders = [...new Set(res.msgs.filter(m => m.sender).map(m => m.sender))];

console.log(`형식: ${res.format}${res.title ? `  (제목: ${res.title})` : ''}`);
console.log(`메시지 ${res.msgs.length}개  ${res.msgs[0]?.at ?? '-'} ~ ${res.msgs.at(-1)?.at ?? '-'}`);
console.log(`보낸 사람: ${senders.join(', ')}`);
console.log(`종류: ${Object.entries(kinds).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
if (res.orphans.length) console.log(`⚠ 인식 못 한 줄 ${res.orphans.length}개:`, res.orphans.slice(0, 5));

console.log('\n메시지 간격 분포:');
for (const [label, n] of gapHistogram(res.msgs)) console.log(`  ${label.padEnd(8)} ${String(n).padStart(6)}`);

const sessions = splitSessions(res.msgs, { gapMin });
console.log(`\n세션 ${sessions.length}개 (간격 ${gapMin}분 기준)`);
const preview = (i: number) => {
  const m = res.msgs[i];
  const body = m.kind === 'text' ? m.text.replace(/\n/g, ' ⏎ ') : `[${m.kind}${m.media?.count ? ` ${m.media.count}` : ''}]`;
  return `${m.sender || '(시스템)'}: ${body.slice(0, 60)}`;
};
for (const s of sessions) {
  const who = Object.entries(s.senders).map(([k, v]) => `${k} ${v}`).join('/');
  const med = Object.entries(s.media).filter(([, v]) => v).map(([k, v]) => `${k} ${v}`).join(' ');
  console.log(
    `\n▸ ${s.id}  ${s.start} → ${s.end.slice(5)}  (앞 간격 ${s.gapBefore === null ? '-' : fmtGap(s.gapBefore)})` +
    `\n  ${s.count}개 · ${s.chars}자 · 장문비율 ${s.longRatio} · ${who}${med ? ` · ${med}` : ''}` +
    `\n  ┌ ${preview(s.from)}` + (s.to > s.from ? `\n  └ ${preview(s.to)}` : ''),
  );
}
if (jsonOut) { writeFileSync(jsonOut, JSON.stringify({ ...res, sessions }, null, 1)); console.log(`\n→ ${jsonOut}`); }

function fmtGap(min: number) {
  return min >= 1440 ? `${(min / 1440).toFixed(1)}일` : min >= 60 ? `${(min / 60).toFixed(1)}h` : `${min}분`;
}
