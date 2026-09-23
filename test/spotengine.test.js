import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../shared/spotengine.js';
import { LEVELS } from '../shared/spotdiff.js';

const T0 = 1_000_000;
const START = T0 + S.COUNTDOWN_SECONDS * 1000;

function duel(level = 'normal', seed = 1) {
  const game = S.createSpotGame({ level, seed });
  S.seatSpotPlayer(game, 0, '가', T0);
  S.seatSpotPlayer(game, 1, '나', T0);
  S.spotTick(game, START);
  return game;
}

function solo(level = 'normal', seed = 1) {
  const game = S.createSpotGame({ level, seed, solo: true });
  S.seatSpotPlayer(game, 0, '나', T0);
  S.spotTick(game, START);
  return game;
}

/** 아직 못 찾은 차이 하나 */
function unfound(game) {
  return game.puzzle.diffs.find((d) => !game.found.some((f) => f.id === d.id));
}

/** 어떤 차이에도 걸리지 않는 점 */
function emptySpot(game) {
  for (let y = 5; y < 300; y += 7) {
    for (let x = 5; x < 400; x += 7) {
      if (game.puzzle.diffs.every((d) => Math.hypot(d.x - x, d.y - y) > d.r + 20)) return { x, y };
    }
  }
  throw new Error('빈 곳이 없다');
}

test('둘 다 앉으면 카운트다운, 끝나면 시작', () => {
  const game = S.createSpotGame({ level: 'easy', seed: 3 });
  S.seatSpotPlayer(game, 0, '가', T0);
  assert.equal(game.phase, S.SpotPhase.LOBBY);
  S.seatSpotPlayer(game, 1, '나', T0);
  assert.equal(game.phase, S.SpotPhase.COUNTDOWN);
  assert.ok(game.puzzle, '카운트다운 중에 이미 그림이 있다');
  assert.equal(S.tap(game, 0, 10, 10, T0 + 100).error, 'not_playing');
  assert.equal(S.spotTick(game, START - 1), false);
  assert.equal(S.spotTick(game, START), true);
  assert.equal(game.phase, S.SpotPhase.PLAYING);
  assert.equal(game.deadline, START + LEVELS.easy.seconds * 1000);
});

test('맞히면 점수, 틀리면 잠금, 이미 찾은 곳은 무시', () => {
  const game = duel();
  const d = unfound(game);
  assert.deepEqual(S.tap(game, 0, d.x, d.y, START + 10), { ok: true, hit: d.id });
  assert.equal(game.players[0].found, 1);
  assert.deepEqual(S.tap(game, 1, d.x, d.y, START + 20), { ok: true, hit: null, already: true });
  assert.equal(game.players[1].misses, 0, '이미 찾은 곳은 오답이 아니다');

  const e = emptySpot(game);
  assert.deepEqual(S.tap(game, 1, e.x, e.y, START + 30), { ok: true, hit: null });
  assert.equal(game.players[1].misses, 1);
  assert.equal(S.tap(game, 1, e.x, e.y, START + 30 + S.MISS_LOCK_MS - 1).error, 'locked');
  const d2 = unfound(game);
  assert.equal(S.tap(game, 1, d2.x, d2.y, START + 30 + S.MISS_LOCK_MS).hit, d2.id, '잠금이 풀리면 다시 누를 수 있다');
  assert.equal(S.tap(game, 0, -1, 5, START + 40).error, 'bad_tap');
  assert.equal(S.tap(game, 0, 'x', 5, START + 40).error, 'bad_tap');
});

test('남은 개수로 역전이 불가능해지면 바로 끝난다', () => {
  const game = duel('normal'); // 7개
  for (let i = 0; i < 4; i++) {
    const d = unfound(game);
    S.tap(game, 0, d.x, d.y, START + i);
  }
  assert.equal(game.phase, S.SpotPhase.OVER);
  assert.equal(game.winner, 0);
  assert.equal(game.overReason, 'found');
  assert.equal(game.found.length, 4, '남은 3개는 의미가 없으니 여기서 멈춘다');
});

test('시간이 끝나면 많이 찾은 쪽이 이기고, 같으면 무승부', () => {
  const game = duel('normal');
  const d = unfound(game);
  S.tap(game, 1, d.x, d.y, START + 1);
  const end = START + LEVELS.normal.seconds * 1000;
  assert.equal(S.spotTick(game, end - 1), false);
  assert.equal(S.spotTick(game, end), true);
  assert.equal(game.winner, 1);
  assert.equal(game.overReason, 'time');

  const tie = duel('normal', 2);
  S.spotTick(tie, START + LEVELS.normal.seconds * 1000);
  assert.equal(tie.winner, 'draw');
});

test('서버 틱보다 먼저 온 입력도 제 단계에서 처리된다', () => {
  const game = S.createSpotGame({ level: 'easy', seed: 5 });
  S.seatSpotPlayer(game, 0, '가', T0);
  S.seatSpotPlayer(game, 1, '나', T0);
  // 아직 tick 을 안 불렀지만 카운트다운은 끝난 시각
  const d = game.puzzle.diffs[0];
  assert.equal(S.tap(game, 0, d.x, d.y, START + 5).hit, d.id);
  assert.equal(game.phase, S.SpotPhase.PLAYING);
  // 시간이 끝난 뒤의 입력은 종료 처리로 이어진다
  assert.equal(S.tap(game, 1, d.x, d.y, START + LEVELS.easy.seconds * 1000).error, 'not_playing');
  assert.equal(game.phase, S.SpotPhase.OVER);
});

test('기권과 재대결 — 재대결은 둘 다 눌러야 하고 새 그림이 나온다', () => {
  const game = duel();
  const firstId = game.puzzle.id;
  assert.equal(S.spotForfeit(game, 1).ok, true);
  assert.equal(game.winner, 0);
  assert.equal(game.overReason, 'forfeit');
  assert.equal(S.spotForfeit(game, 0).error, 'already_over');

  S.requestSpotRematch(game, 0, START + 10);
  assert.equal(game.phase, S.SpotPhase.OVER);
  S.requestSpotRematch(game, 1, START + 10);
  assert.equal(game.phase, S.SpotPhase.COUNTDOWN);
  assert.equal(game.gameNo, 2);
  assert.notEqual(game.puzzle.id, firstId);
  assert.equal(game.players[0].found, 0);
  assert.equal(game.found.length, 0);
});

test('혼자 하기 — 다 찾으면 성공, 힌트는 시간을 깎는다', () => {
  const game = solo('easy');
  const before = game.deadline;
  assert.equal(S.useHint(game, 0, START + 10).ok, true);
  assert.equal(game.deadline, before - S.HINT_PENALTY_SECONDS * 1000);
  assert.ok(game.hint && game.hint.until === START + 10 + S.HINT_SHOW_MS);
  assert.equal(S.useHint(game, 0, START + 20).error, 'hint_active');
  assert.equal(S.spotTick(game, START + 10 + S.HINT_SHOW_MS), true, '힌트가 사라지면 바뀐 것으로 친다');
  assert.equal(game.hint, null);

  let t = START + 100;
  while (game.phase === S.SpotPhase.PLAYING) {
    const d = unfound(game);
    S.tap(game, 0, d.x, d.y, t++);
  }
  assert.equal(game.overReason, 'cleared');
  assert.equal(game.winner, 0);
  assert.equal(S.spotViewFor(game, 0).winner, 'you');

  S.requestSpotRematch(game, 0, t); // 혼자이니 바로 새 그림
  assert.equal(game.phase, S.SpotPhase.COUNTDOWN);
  assert.equal(game.gameNo, 2);
});

test('혼자 하기 — 시간이 끝나면 찾은 개수만 남는다', () => {
  const game = solo('easy');
  const d = unfound(game);
  S.tap(game, 0, d.x, d.y, START + 1);
  S.spotTick(game, START + LEVELS.easy.seconds * 1000);
  assert.equal(game.phase, S.SpotPhase.OVER);
  assert.equal(game.overReason, 'time');
  assert.equal(game.winner, null);
  const view = S.spotViewFor(game, 0);
  assert.equal(view.winner, null);
  assert.equal(view.answers.filter((a) => a.found).length, 1);
  assert.equal(S.useHint(game, 0, START + 5).error, 'not_playing');
});

test('대전에서는 힌트를 쓸 수 없다', () => {
  const game = duel();
  assert.equal(S.useHint(game, 0, START + 1).error, 'not_solo');
});

test('view 에는 끝나기 전까지 정답 위치가 없다', () => {
  const game = duel();
  const d = unfound(game);
  S.tap(game, 1, d.x, d.y, START + 1);
  const view = S.spotViewFor(game, 0);
  assert.equal(view.answers, null);
  assert.equal(view.puzzle.left.length, game.puzzle.left.length);
  assert.equal('diffs' in view.puzzle, false);
  assert.equal(view.found.length, 1);
  assert.equal(view.found[0].by, 'opponent');
  assert.equal(view.opponent.found, 1);
  assert.equal(view.total, 7);
  assert.equal(view.timeTotal, LEVELS.normal.seconds * 1000);
  assert.equal(JSON.stringify(view).includes('"diffs"'), false);

  S.spotForfeit(game, 1);
  const over = S.spotViewFor(game, 0);
  assert.equal(over.answers.length, 7);
  assert.equal(over.answers.filter((a) => a.found).length, 1);
});
