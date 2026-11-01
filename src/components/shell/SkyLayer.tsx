// 밤하늘 (v2.1 사용자 요청) — 바깥 여백의 별 네 장 + 다크모드 별똥별. 모양·위치·박자는 전부 skin.css(.sky)에 있다.
// 별을 장마다 따로 깜빡이려면 요소가 여러 개 필요해서(body::after 한 장으로는 전부 같이 깜빡였다) 빈 요소만 놓는다.
const STAR_LAYERS = 4;
const SHOOTING_STARS = 6;

export function SkyLayer() {
  return (
    <div className="sky" aria-hidden>
      {Array.from({ length: STAR_LAYERS }, (_, i) => <i key={`s${i}`} className={`sky-stars s${i + 1}`} />)}
      {Array.from({ length: SHOOTING_STARS }, (_, i) => <i key={`k${i}`} className={`sky-shoot k${i + 1}`} />)}
    </div>
  );
}
