import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../shared/engine.js';

function readyGame(opts = {}) {
  const game = E.createGame({ digits: 3, turnSeconds: 60, firstMover: 0, ...opts });
  E.seatPlayer(game, 0, '가', 0);
  E.seatPlayer(game, 1, '나', 0);
  E.submitSecret(game, 0, '123', 0);
  E.submitSecret(game, 1, '456', 0);
  return game;
}

test('두 명이 앉으면 비밀번호 단계로 넘어간다', () => {
  const game = E.createGame({ digits: 3, turnSeconds: 60 });
  assert.equal(game.phase, E.Phase.LOBBY);
  E.seatPlayer(game, 0, '가', 0);
  assert.equal(game.phase, E.Phase.LOBBY);
  E.seatPlayer(game, 1, '나', 0);
  assert.equal(game.phase, E.Phase.SETUP);
  assert.equal(game.deadline, E.SETUP_SECONDS * 1000);
});

test('둘 다 비밀번호를 확정하면 선공부터 시작한다', () => {
  const game = readyGame({ firstMover: 1 });
  assert.equal(game.phase, E.Phase.PLAYING);
  assert.equal(game.turn, 1);
  assert.equal(game.round, 1);
});

test('잘못된 비밀번호는 거부된다', () => {
  const game = E.createGame({ digits: 3 });
  E.seatPlayer(game, 0, '가', 0);
  E.seatPlayer(game, 1, '나', 0);
  assert.deepEqual(E.submitSecret(game, 0, '112', 0), { ok: false, error: 'invalid_number' });
  assert.equal(game.players[0].ready, false);
});

test('내 차례가 아니면 공격할 수 없고, 같은 숫자를 두 번 던질 수 없다', () => {
  const game = readyGame();
  assert.deepEqual(E.makeGuess(game, 1, '123', 0), { ok: false, error: 'not_your_turn' });
  E.makeGuess(game, 0, '456', 0);   // 정답이므로 선공이 맞힘 → 후공에게 마지막 공격권
  assert.equal(game.lastChance, 0);
  assert.equal(game.turn, 1);
  E.makeGuess(game, 1, '789', 0);
  assert.equal(game.phase, E.Phase.OVER);
  assert.equal(game.winner, 0);
  assert.equal(game.overReason, 'strikes');
});

test('판정 결과가 기록에 남는다', () => {
  const game = readyGame();
  const out = E.makeGuess(game, 0, '465', 0);
  assert.equal(out.ok, true);
  assert.deepEqual(
    { s: out.result.strikes, b: out.result.balls },
    { s: 1, b: 2 },
  );
  assert.equal(game.turn, 1);
  assert.deepEqual(E.makeGuess(game, 1, '123', 0).ok, true); // 후공이 맞힘 → 바로 승리
  assert.equal(game.winner, 1);
});

test('둘 다 같은 라운드에 맞히면 무승부', () => {
  const game = readyGame();
  E.makeGuess(game, 0, '456', 0);
  E.makeGuess(game, 1, '123', 0);
  assert.equal(game.phase, E.Phase.OVER);
  assert.equal(game.winner, 'draw');
});

test('중복 추측은 막는다', () => {
  const game = readyGame();
  E.makeGuess(game, 0, '789', 0);
  E.makeGuess(game, 1, '789', 0);
  assert.deepEqual(E.makeGuess(game, 0, '789', 0), { ok: false, error: 'duplicate_guess' });
});

test('제한시간을 넘기면 턴을 잃고, 3번 연속이면 기권', () => {
  const game = readyGame();
  let now = 60_000;
  E.tick(game, now);                       // 0번이 시간 초과 1
  assert.equal(game.players[0].misses, 1);
  assert.equal(game.turn, 1);
  now += 60_000; E.tick(game, now);        // 1번 시간 초과 1
  now += 60_000; E.tick(game, now);        // 0번 2
  now += 60_000; E.tick(game, now);        // 1번 2
  now += 60_000; E.tick(game, now);        // 0번 3 → 기권
  assert.equal(game.phase, E.Phase.OVER);
  assert.equal(game.winner, 1);
  assert.equal(game.overReason, 'timeout');
});

test('비밀번호 단계에서 시간이 다 되면 자동으로 숫자가 배정된다', () => {
  const game = E.createGame({ digits: 4, turnSeconds: 30 });
  E.seatPlayer(game, 0, '가', 0);
  E.seatPlayer(game, 1, '나', 0);
  E.submitSecret(game, 0, '0123', 0);
  E.tick(game, E.SETUP_SECONDS * 1000);
  assert.equal(game.phase, E.Phase.PLAYING);
  assert.equal(game.players[1].secret.length, 4);
  assert.equal(game.log.some((l) => l.type === 'auto_secret'), true);
});

test('무제한 모드에는 마감시간이 없다', () => {
  const game = readyGame({ turnSeconds: 0 });
  assert.equal(game.deadline, null);
  assert.equal(E.tick(game, 10 ** 12), false);
});

test('기권하면 상대가 이긴다', () => {
  const game = readyGame();
  E.forfeit(game, 1);
  assert.equal(game.winner, 0);
  assert.equal(game.overReason, 'forfeit');
});

test('재대결하면 선공이 바뀌고 기록이 비워진다', () => {
  const game = readyGame();
  E.makeGuess(game, 0, '456', 0);
  E.makeGuess(game, 1, '789', 0);          // 마지막 공격권을 못 살림 → 선공 승리
  assert.equal(game.phase, E.Phase.OVER);
  E.requestRematch(game, 0, 0);
  assert.equal(game.phase, E.Phase.OVER);  // 한 명만으로는 안 된다
  E.requestRematch(game, 1, 0);
  assert.equal(game.phase, E.Phase.SETUP);
  assert.equal(game.firstMover, 1);
  assert.equal(game.gameNo, 2);
  assert.deepEqual(game.players[0].guesses, []);
  assert.equal(game.players[0].secret, null);
});

test('규칙에 어긋난 추측은 턴을 소모하지 않는다', () => {
  const game = readyGame();
  assert.deepEqual(E.makeGuess(game, 0, '112', 0), { ok: false, error: 'invalid_number' });
  assert.equal(game.turn, 0);
  assert.deepEqual(game.players[0].guesses, []);
});

test('상대 비밀번호는 게임이 끝나기 전까지 보이지 않는다', () => {
  const game = readyGame();
  const view = E.viewFor(game, 0);
  assert.equal(view.me.secret, '123');
  assert.equal(view.opponent.secret, null);
  E.forfeit(game, 1);
  assert.equal(E.viewFor(game, 0).opponent.secret, '456');
  assert.equal(E.viewFor(game, 0).winner, 'you');
  assert.equal(E.viewFor(game, 1).winner, 'opponent');
});

test('옵션은 안전한 범위로 정리된다', () => {
  assert.deepEqual(E.normalizeOptions({ digits: 99, turnSeconds: 5 }), { digits: 6, turnSeconds: 60 });
  assert.deepEqual(E.normalizeOptions({ digits: 1, turnSeconds: 0 }), { digits: 3, turnSeconds: 0 });
  assert.deepEqual(E.normalizeOptions({}), { digits: 3, turnSeconds: 60 });
});
