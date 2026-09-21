/**
 * AI 상대.
 *
 * 기본 전략은 "지금까지의 단서와 모순되지 않는 후보 중 하나를 고른다"이고,
 * 난이도는 그 단서를 얼마나 기억하느냐로 조절한다 —
 * 쉬움일수록 과거 단서를 자주 잊고, 가끔 아무 숫자나 던진다.
 */
import { allCandidates, judge, randomNumber } from '/shared/baseball.js';

export const PROFILES = {
  easy:   { key: 'easy',   label: '쉬움',   memory: 0.45, noise: 0.30, minDelay: 700, maxDelay: 1600 },
  normal: { key: 'normal', label: '보통',   memory: 0.80, noise: 0.10, minDelay: 600, maxDelay: 1300 },
  hard:   { key: 'hard',   label: '어려움', memory: 1.00, noise: 0.00, minDelay: 400, maxDelay: 1000 },
};

const AI_NAMES = { easy: 'AI 루키', normal: 'AI 에이스', hard: 'AI 괴물' };

function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function createAI({ digits, difficulty = 'normal' }) {
  const profile = PROFILES[difficulty] ?? PROFILES.normal;
  let universe = null; // 후보 전체는 실제로 필요할 때 한 번만 만든다 (6자리 = 151,200개)

  return {
    profile,
    name: AI_NAMES[profile.key],

    chooseSecret() {
      return randomNumber(digits);
    },

    thinkingDelay() {
      return profile.minDelay + Math.random() * (profile.maxDelay - profile.minDelay);
    },

    /**
     * @param {Array<{value:string|null,strikes:number,balls:number,timeout?:boolean}>} history
     *   AI 가 지금까지 던진 추측과 그 결과
     */
    nextGuess(history) {
      if (!universe) universe = allCandidates(digits);
      const tried = new Set(history.map((h) => h.value).filter(Boolean));
      const clues = history.filter((h) => h.value && !h.timeout);

      // 마지막 단서는 항상 기억하고, 나머지는 난이도만큼만 기억한다.
      const remembered = clues.filter(
        (_, i) => i === clues.length - 1 || Math.random() < profile.memory,
      );

      let pool = universe;
      for (const clue of remembered) {
        pool = pool.filter((cand) => {
          const v = judge(cand, clue.value);
          return v.strikes === clue.strikes && v.balls === clue.balls;
        });
        if (!pool.length) break;
      }

      let choices = pool.filter((x) => !tried.has(x));
      if (!choices.length) choices = universe.filter((x) => !tried.has(x));
      if (!choices.length) return randomNumber(digits);

      if (Math.random() < profile.noise) {
        const wild = universe.filter((x) => !tried.has(x));
        return pick(wild.length ? wild : choices);
      }
      return pick(choices);
    },
  };
}
