/**
 * 방이 돌릴 수 있는 게임 목록.
 * 방(rooms.js)은 여기 있는 함수만 부르고, 어떤 게임인지는 모른다.
 */
import * as baseball from '../shared/engine.js';
import * as spot from '../shared/spotengine.js';

export const GAMES = {
  baseball: {
    key: 'baseball',
    normalize: (msg) => baseball.normalizeOptions({ digits: msg.digits, turnSeconds: msg.turnSeconds }),
    createGame: baseball.createGame,
    seatPlayer: baseball.seatPlayer,
    setPresence: baseball.setPresence,
    tick: baseball.tick,
    forfeit: baseball.forfeit,
    requestRematch: baseball.requestRematch,
    viewFor: baseball.viewFor,
    // 진행 중인 판 — 연결이 끊기면 재접속 유예를 주고, 못 돌아오면 기권 처리한다
    isLive: (game) => game.phase === baseball.Phase.SETUP || game.phase === baseball.Phase.PLAYING,
  },
  spot: {
    key: 'spot',
    normalize: (msg) => spot.normalizeSpotOptions({ level: msg.level }),
    createGame: spot.createSpotGame,
    seatPlayer: spot.seatSpotPlayer,
    setPresence: spot.setSpotPresence,
    tick: spot.spotTick,
    forfeit: spot.spotForfeit,
    requestRematch: spot.requestSpotRematch,
    viewFor: spot.spotViewFor,
    isLive: (game) => game.phase === spot.SpotPhase.COUNTDOWN || game.phase === spot.SpotPhase.PLAYING,
  },
};

export function gameFor(key) {
  return GAMES[key] ?? GAMES.baseball;
}
