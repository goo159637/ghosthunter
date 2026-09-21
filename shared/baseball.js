/**
 * 숫자야구 핵심 규칙.
 * 서버와 브라우저가 그대로 함께 쓰는 순수 모듈 (의존성 없음).
 */

export const MIN_DIGITS = 3;
export const MAX_DIGITS = 6;

/** 비밀번호/추측이 규칙에 맞는지 검사한다. 서로 다른 숫자 digits개. */
export function isValidNumber(value, digits) {
  if (typeof value !== 'string') return false;
  if (value.length !== digits) return false;
  if (!/^[0-9]+$/.test(value)) return false;
  return new Set(value).size === digits;
}

/**
 * 추측을 판정한다. secret 은 중복 없는 숫자열이라고 가정한다.
 * @returns {{strikes:number, balls:number, out:boolean}}
 */
export function judge(secret, guess) {
  let strikes = 0;
  let balls = 0;
  for (let i = 0; i < guess.length; i++) {
    const at = secret.indexOf(guess[i]);
    if (at === -1) continue;
    if (at === i) strikes++;
    else balls++;
  }
  return { strikes, balls, out: strikes === 0 && balls === 0 };
}

/** "2스트라이크 1볼" 같은 표시용 문자열. */
export function formatResult({ strikes, balls }) {
  if (!strikes && !balls) return '아웃';
  const parts = [];
  if (strikes) parts.push(`${strikes}스트라이크`);
  if (balls) parts.push(`${balls}볼`);
  return parts.join(' ');
}

/** 규칙에 맞는 무작위 숫자를 만든다. */
export function randomNumber(digits, rand = Math.random) {
  const pool = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, digits).join('');
}

/** digits 자리로 가능한 모든 숫자(서로 다른 숫자 조합)를 만든다. AI 가 쓴다. */
export function allCandidates(digits) {
  const out = [];
  const used = new Array(10).fill(false);
  const cur = [];
  const walk = () => {
    if (cur.length === digits) {
      out.push(cur.join(''));
      return;
    }
    for (let d = 0; d < 10; d++) {
      if (used[d]) continue;
      used[d] = true;
      cur.push(String(d));
      walk();
      cur.pop();
      used[d] = false;
    }
  };
  walk();
  return out;
}
