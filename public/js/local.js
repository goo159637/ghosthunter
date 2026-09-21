/**
 * AI 연습 모드 엔진.
 * 온라인 대전과 완전히 같은 규칙(shared/engine.js)을 브라우저 안에서 돌린다.
 * 그래서 화면 코드는 온라인인지 AI인지 구분할 필요가 없다.
 */
import * as E from '/shared/engine.js';
import { createAI } from '/js/ai.js';

export function createLocalEngine({ digits, turnSeconds, difficulty, name }) {
  const ai = createAI({ digits, difficulty });
  const game = E.createGame({ digits, turnSeconds, firstMover: Math.random() < 0.5 ? 0 : 1 });
  E.seatPlayer(game, 0, name);
  E.seatPlayer(game, 1, ai.name);

  const listeners = new Set();
  let aiTimer = null;
  let stopped = false;

  const emit = () => {
    const view = E.viewFor(game, 0);
    for (const fn of listeners) fn({ view, chat: [], grace: null, code: null, status: 'local' });
  };

  const clearAiTimer = () => {
    if (aiTimer) clearTimeout(aiTimer);
    aiTimer = null;
  };

  const scheduleAi = () => {
    if (stopped || aiTimer) return;

    if (game.phase === E.Phase.SETUP && !game.players[1].ready) {
      aiTimer = setTimeout(() => {
        aiTimer = null;
        E.submitSecret(game, 1, ai.chooseSecret());
        emit();
        scheduleAi();
      }, 500 + Math.random() * 700);
      return;
    }

    if (game.phase === E.Phase.PLAYING && game.turn === 1) {
      aiTimer = setTimeout(() => {
        aiTimer = null;
        if (game.phase === E.Phase.PLAYING && game.turn === 1) {
          E.makeGuess(game, 1, ai.nextGuess(game.players[1].guesses));
          emit();
        }
        scheduleAi();
      }, ai.thinkingDelay());
    }
  };

  const loop = setInterval(() => {
    if (stopped) return;
    if (E.tick(game)) {
      clearAiTimer();
      emit();
    }
    scheduleAi();
  }, 250);

  scheduleAi();
  queueMicrotask(emit);

  return {
    mode: 'ai',
    aiProfile: ai.profile,

    subscribe(fn) {
      listeners.add(fn);
      emit();
      return () => listeners.delete(fn);
    },

    secret(value) {
      const out = E.submitSecret(game, 0, value);
      emit();
      scheduleAi();
      return out;
    },

    guess(value) {
      const out = E.makeGuess(game, 0, value);
      emit();
      scheduleAi();
      return out;
    },

    chat() {
      return { ok: false, error: 'ai_mode' };
    },

    rematch() {
      E.requestRematch(game, 0);
      E.requestRematch(game, 1); // AI 는 항상 재대결에 응한다
      clearAiTimer();
      emit();
      scheduleAi();
      return { ok: true };
    },

    surrender() {
      E.forfeit(game, 0);
      clearAiTimer();
      emit();
      return { ok: true };
    },

    leave() {
      stopped = true;
      clearAiTimer();
      clearInterval(loop);
      listeners.clear();
    },
  };
}
