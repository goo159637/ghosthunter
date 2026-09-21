import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../shared/msversus.js';
import * as M from '../shared/minesweeper.js';

function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ready(opts = {}, seed = 1) {
  const match = V.createGame({ rows: 9, cols: 9, mines: 10, countdownSeconds: 3, ...opts }, seeded(seed));
  V.seatPlayer(match, 0, '가', 1000);
  V.seatPlayer(match, 1, '나', 1000);
  return match;
}

/** index 번 플레이어 판에서 닫혀 있고 지뢰가 아닌 칸 / 지뢰인 칸 하나. */
const safeCell = (match, index) => match.players[index].game.open.findIndex((o, i) => !o && !match.players[index].game.mine[i]);
const mineCell = (match, index) => match.players[index].game.mine.indexOf(true);

test('normalizeOptions — 지뢰찾기 범위를 따르되 출발 지점 뒤에도 한 칸은 남긴다', () => {
  assert.deepEqual(V.normalizeOptions({ rows: 5, cols: 5, mines: 99 }), { rows: 5, cols: 5, mines: 15, countdownSeconds: 3 });
  assert.deepEqual(V.normalizeOptions({ countdownSeconds: 99 }), { rows: 9, cols: 9, mines: 10, countdownSeconds: 10 });
  assert.deepEqual(V.normalizeOptions({ countdownSeconds: -1 }), { rows: 9, cols: 9, mines: 10, countdownSeconds: 0 });
  assert.equal(V.normalizeOptions({ countdownSeconds: 'x' }).countdownSeconds, 3);
});

test('둘 다 앉으면 카운트다운, 시각이 되면 출발한다', () => {
  const match = V.createGame({ countdownSeconds: 3 }, seeded(1));
  assert.equal(match.phase, V.Phase.LOBBY);
  V.seatPlayer(match, 0, '가', 1000);
  assert.equal(match.phase, V.Phase.LOBBY);
  assert.equal(match.players[0].game, null);
  V.seatPlayer(match, 1, '', 1000);
  assert.equal(match.players[1].name, '플레이어 2');
  assert.equal(match.phase, V.Phase.COUNTDOWN);
  assert.equal(match.startAt, 4000);
  assert.equal(V.status(match), 'playing');
  assert.equal(V.tick(match, 3999), false);
  assert.equal(match.phase, V.Phase.COUNTDOWN);
  assert.equal(V.tick(match, 4000), true);
  assert.equal(match.phase, V.Phase.PLAYING);
  assert.equal(V.tick(match, 5000), false);
});

test('카운트다운 0초면 바로 출발한다', () => {
  const match = ready({ countdownSeconds: 0 });
  assert.equal(match.phase, V.Phase.PLAYING);
});

test('각자 판은 서로 다르고, 출발 지점이 미리 열려 있으며, 시계는 출발 신호부터 흐른다', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const match = ready({}, seed);
    const [a, b] = match.players.map((p) => p.game);
    assert.equal(a.phase, M.Phase.PLAYING);
    assert.equal(b.phase, M.Phase.PLAYING);
    assert.ok(a.opened >= 9, `seed ${seed}: 출발 지점 ${a.opened}칸`);
    assert.ok(b.opened >= 9);
    assert.equal(a.startedAt, 4000);
    assert.equal(b.startedAt, 4000);
    assert.equal(a.mine.filter(Boolean).length, 10);
    assert.equal(b.mine.filter(Boolean).length, 10);
    assert.notDeepEqual(a.mine, b.mine, `seed ${seed}: 두 판이 같다`);
  }
});

test('카운트다운 중엔 둘 수 없고, 출발 시각이 지났으면 act 가 알아서 출발시킨다', () => {
  const match = ready();
  const i = safeCell(match, 0);
  assert.equal(V.act(match, 0, 'reveal', i, 2000).error, 'not_playing');
  assert.equal(match.phase, V.Phase.COUNTDOWN);
  assert.equal(V.act(match, 0, 'reveal', i, 4000).ok, true);
  assert.equal(match.phase, V.Phase.PLAYING);
  assert.equal(match.players[0].game.open[i], true);
});

test('act — reveal / mark / chord 가 내 판에만 적용되고, 규칙 위반은 그대로 돌려준다', () => {
  const match = ready({ countdownSeconds: 0 });
  const g0 = match.players[0].game;
  const g1 = match.players[1].game;
  const before1 = M.encodeBoard(g1);
  const i = safeCell(match, 0);
  assert.equal(V.act(match, 0, 'mark', i, 5000).ok, true);
  assert.equal(g0.mark[i], M.Mark.FLAG);
  assert.equal(V.act(match, 0, 'reveal', i, 5000).error, 'flagged');
  assert.equal(V.act(match, 0, 'mark', i, 5000).ok, true);       // 물음표 옵션 없이 → 없음
  assert.equal(g0.mark[i], M.Mark.NONE);
  assert.equal(V.act(match, 0, 'mark', i, 5000, { question: true }).ok, true);
  assert.equal(V.act(match, 0, 'mark', i, 5000, { question: true }).ok, true);
  assert.equal(g0.mark[i], M.Mark.QUESTION);
  assert.equal(V.act(match, 0, 'chord', i, 5000).error, 'not_open');
  assert.equal(V.act(match, 0, 'dance', i, 5000).error, 'bad_action');
  assert.equal(V.act(match, 0, 'reveal', 9999, 5000).error, 'out_of_board');
  assert.equal(M.encodeBoard(g1), before1, '상대 판은 그대로');
  assert.equal(match.phase, V.Phase.PLAYING);
});

test('지뢰를 밟으면 그 자리에서 상대 승리, 두 판의 시계가 멈춘다', () => {
  const match = ready({ countdownSeconds: 0 });
  const out = V.act(match, 1, 'reveal', mineCell(match, 1), 9000);
  assert.equal(out.ok, true);
  assert.equal(match.phase, V.Phase.OVER);
  assert.equal(match.winner, 0);
  assert.equal(match.overReason, 'mine');
  assert.equal(match.players[1].game.phase, M.Phase.LOST);
  assert.equal(match.players[1].game.endedAt, 9000);
  assert.equal(match.players[0].game.endedAt, 9000);
  assert.equal(V.act(match, 0, 'reveal', safeCell(match, 0), 9500).error, 'not_playing');
  assert.equal(V.status(match), 'over');
});

test('먼저 다 열면 승리', () => {
  const match = ready({ countdownSeconds: 0 });
  const g = match.players[0].game;
  for (let i = 0; i < g.rows * g.cols; i++) {
    if (g.mine[i] || g.open[i]) continue;
    V.act(match, 0, 'reveal', i, 7000);
    if (match.phase === V.Phase.OVER) break;
  }
  assert.equal(match.phase, V.Phase.OVER);
  assert.equal(match.winner, 0);
  assert.equal(match.overReason, 'clear');
  assert.equal(g.phase, M.Phase.WON);
});

test('forfeit — 진행 중에만, 상대 승리', () => {
  const lobby = V.createGame({}, seeded(1));
  V.seatPlayer(lobby, 0, '가', 0);
  assert.equal(V.forfeit(lobby, 0, 'forfeit', 0).error, 'not_playing');

  const match = ready();                                  // 카운트다운 중에도 기권은 된다
  assert.equal(V.forfeit(match, 0, 'forfeit', 2000).ok, true);
  assert.equal(match.winner, 1);
  assert.equal(match.overReason, 'forfeit');
  assert.equal(V.forfeit(match, 1, 'forfeit', 2000).error, 'already_over');
});

test('재대결 — 둘 다 눌러야 새 판과 새 카운트다운', () => {
  const match = ready({ countdownSeconds: 0 });
  assert.equal(V.requestRematch(match, 0, 0).error, 'not_over');
  V.act(match, 1, 'reveal', mineCell(match, 1), 9000);
  const oldBoards = match.players.map((p) => M.encodeLayout(p.game));
  V.requestRematch(match, 0, 10000);
  assert.equal(match.phase, V.Phase.OVER);
  assert.equal(match.players[0].rematch, true);
  V.requestRematch(match, 1, 10000);
  assert.equal(match.phase, V.Phase.PLAYING);              // 0초 카운트다운
  assert.equal(match.gameNo, 2);
  assert.equal(match.winner, null);
  assert.equal(match.overReason, null);
  assert.equal(match.players.every((p) => !p.rematch), true);
  assert.notDeepEqual(match.players.map((p) => M.encodeLayout(p.game)), oldBoards);
  assert.equal(match.players[1].game.phase, M.Phase.PLAYING);
});

test('viewFor — 내 판의 지뢰 배치는 나에게만, 상대 판은 열린 칸과 깃발만', () => {
  const match = ready({ countdownSeconds: 0 });
  V.act(match, 1, 'mark', safeCell(match, 1), 5000);
  const v0 = V.viewFor(match, 0, 5000);
  assert.equal(v0.you, 0);
  assert.equal(v0.phase, 'playing');
  assert.equal(v0.total, 71);
  assert.equal(v0.now, 5000);
  assert.equal(v0.me.name, '가');
  assert.equal(v0.me.layout, M.encodeLayout(match.players[0].game));
  assert.equal(v0.me.board, M.encodeBoard(match.players[0].game));
  assert.equal(v0.opponent.name, '나');
  assert.equal(v0.opponent.layout, null);
  assert.equal(v0.opponent.board, M.encodeBoard(match.players[1].game));
  assert.equal(/[*X]/.test(v0.opponent.board), false);
  assert.equal(v0.opponent.flags, 1);
  assert.equal(v0.opponent.opened, match.players[1].game.opened);
  assert.equal(v0.winner, null);

  V.act(match, 1, 'reveal', mineCell(match, 1), 6000);
  const over0 = V.viewFor(match, 0, 6000);
  assert.equal(over0.winner, 'you');
  assert.equal(over0.overReason, 'mine');
  assert.equal(over0.opponent.boardPhase, 'lost');
  assert.ok(over0.opponent.board.includes('X'), '진 뒤엔 상대 판의 지뢰가 보인다');
  assert.equal(V.viewFor(match, 1, 6000).winner, 'opponent');
});

test('viewFor — 판이 없을 때(대기 중)도 안전하다', () => {
  const match = V.createGame({}, seeded(1));
  V.seatPlayer(match, 0, '가', 0);
  const v = V.viewFor(match, 0, 0);
  assert.equal(v.phase, 'lobby');
  assert.equal(v.me.board, undefined);
  assert.equal(v.opponent.joined, false);
});
