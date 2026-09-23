/**
 * 틀린그림찾기 혼자 하기 엔진.
 * 온라인 대전과 완전히 같은 규칙(shared/spotengine.js)을 브라우저 안에서 돌린다.
 */
import * as S from '/shared/spotengine.js';
import { LEVELS } from '/shared/spotdiff.js';

export function createSpotSoloEngine({ level, name }) {
  const game = S.createSpotGame({ level, solo: true });
  S.seatSpotPlayer(game, 0, name);

  const listeners = new Set();
  let stopped = false;

  const emit = () => {
    const view = S.spotViewFor(game, 0);
    for (const fn of listeners) fn({ game: 'spot', view, chat: [], grace: null, code: null, status: 'local' });
  };

  const loop = setInterval(() => {
    if (!stopped && S.spotTick(game)) emit();
  }, 100);

  queueMicrotask(emit);

  return {
    mode: 'solo',
    levelLabel: LEVELS[game.level].label,

    subscribe(fn) {
      listeners.add(fn);
      emit();
      return () => listeners.delete(fn);
    },

    tap(x, y) {
      const out = S.tap(game, 0, x, y);
      emit();
      return out;
    },

    hint() {
      const out = S.useHint(game, 0);
      emit();
      return out;
    },

    chat() {
      return { ok: false, error: 'solo_mode' };
    },

    rematch() {
      const out = S.requestSpotRematch(game, 0); // 혼자이니 바로 새 그림
      emit();
      return out;
    },

    surrender() {
      S.spotForfeit(game, 0);
      emit();
      return { ok: true };
    },

    leave() {
      stopped = true;
      clearInterval(loop);
      listeners.clear();
    },
  };
}
