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
  V.seatPlayer(match, 0, '가', 1000, 'P-ga');
  V.seatPlayer(match, 1, '나', 1000, 'P-na');
  return match;
}

/** index 번 플레이어 판에서 닫혀 있고 지뢰가 아닌 칸 / 지뢰인 칸 하나. */
const safeCell = (match, index) => match.players[index].game.open.findIndex((o, i) => !o && !match.players[index].game.mine[i]);
const mineCell = (match, index) => match.players[index].game.mine.indexOf(true);

/** index 번 플레이어가 지뢰 아닌 칸을 전부 연다 (다 열기). */
function clearBoard(match, index, now) {
  const g = match.players[index].game;
  for (let i = 0; i < g.rows * g.cols; i++) {
    if (g.mine[i] || g.open[i]) continue;
    V.act(match, index, 'reveal', i, now);
    if (match.phase === V.Phase.OVER) break;
  }
}

test('normalizeOptions — 지뢰찾기 범위를 따르되 출발 지점 뒤에도 한 칸은 남긴다', () => {
  assert.deepEqual(V.normalizeOptions({ rows: 5, cols: 5, mines: 99 }), { rows: 5, cols: 5, mines: 15, countdownSeconds: 3 });
  assert.deepEqual(V.normalizeOptions({ countdownSeconds: 99 }), { rows: 9, cols: 9, mines: 10, countdownSeconds: 10 });
  assert.deepEqual(V.normalizeOptions({ countdownSeconds: -1 }), { rows: 9, cols: 9, mines: 10, countdownSeconds: 0 });
  assert.equal(V.normalizeOptions({ countdownSeconds: 'x' }).countdownSeconds, 3);
});

test('scoreOf — 칸 점수 − 시간 + 클리어 보너스 − 지뢰 페널티, 0 아래로는 안 내려간다', () => {
  assert.deepEqual(V.scoreOf({ opened: 60, total: 71, seconds: 50.9, cleared: false, exploded: true }),
    { cells: 600, time: 50, clear: 0, mine: 142, total: 408 });
  assert.deepEqual(V.scoreOf({ opened: 71, total: 71, seconds: 90, cleared: true, exploded: false }),
    { cells: 710, time: 90, clear: 355, mine: 0, total: 975 });
  assert.equal(V.scoreOf({ opened: 5, total: 71, seconds: 300, cleared: false, exploded: true }).total, 0);
  assert.equal(V.scoreOf({ opened: 0, total: 71, seconds: -5, cleared: false, exploded: false }).total, 0);
  // 다 연 사람은 지뢰를 밟은 사람보다 항상 앞선다 (같은 판 크기, 상식적인 시간)
  const cleared = V.scoreOf({ opened: 216, total: 216, seconds: 600, cleared: true, exploded: false }).total;
  const mined = V.scoreOf({ opened: 215, total: 216, seconds: 0, cleared: false, exploded: true }).total;
  assert.ok(cleared > mined);
});

test('둘 다 앉으면 카운트다운, 시각이 되면 출발한다', () => {
  const match = V.createGame({ countdownSeconds: 3 }, seeded(1));
  assert.equal(match.phase, V.Phase.LOBBY);
  V.seatPlayer(match, 0, '가', 1000, 'A');
  assert.equal(match.phase, V.Phase.LOBBY);
  assert.equal(match.players[0].game, null);
  V.seatPlayer(match, 1, '', 1000, 'B');
  assert.equal(match.players[1].name, '플레이어 2');
  assert.equal(match.phase, V.Phase.COUNTDOWN);
  assert.equal(match.startAt, 4000);
  assert.equal(V.status(match), 'playing');
  assert.equal(V.tick(match, 3999), false);
  assert.equal(V.tick(match, 4000), true);
  assert.equal(match.phase, V.Phase.PLAYING);
  assert.equal(V.tick(match, 5000), false);
});

test('카운트다운 0초면 바로 출발한다', () => {
  assert.equal(ready({ countdownSeconds: 0 }).phase, V.Phase.PLAYING);
});

test('각자 판은 서로 다르고, 출발 지점이 미리 열려 있으며, 시계는 출발 신호부터 흐른다', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const match = ready({}, seed);
    const [a, b] = match.players.map((p) => p.game);
    assert.equal(a.phase, M.Phase.PLAYING);
    assert.ok(a.opened >= 9, `seed ${seed}: 출발 지점 ${a.opened}칸`);
    assert.ok(b.opened >= 9);
    assert.equal(a.startedAt, 4000);
    assert.equal(a.mine.filter(Boolean).length, 10);
    assert.notDeepEqual(a.mine, b.mine, `seed ${seed}: 두 판이 같다`);
  }
});

test('카운트다운 중엔 둘 수 없고, 출발 시각이 지났으면 act 가 알아서 출발시킨다', () => {
  const match = ready();
  const i = safeCell(match, 0);
  assert.equal(V.act(match, 0, 'reveal', i, 2000).error, 'not_playing');
  assert.equal(V.act(match, 0, 'reveal', i, 4000).ok, true);
  assert.equal(match.phase, V.Phase.PLAYING);
});

test('act — reveal / mark / chord 가 내 판에만 적용되고, 규칙 위반은 그대로 돌려준다', () => {
  const match = ready({ countdownSeconds: 0 });
  const g0 = match.players[0].game;
  const before1 = M.encodeBoard(match.players[1].game);
  const i = safeCell(match, 0);
  assert.equal(V.act(match, 0, 'mark', i, 5000).ok, true);
  assert.equal(V.act(match, 0, 'reveal', i, 5000).error, 'flagged');
  assert.equal(V.act(match, 0, 'mark', i, 5000).ok, true);
  assert.equal(V.act(match, 0, 'mark', i, 5000, { question: true }).ok, true);
  assert.equal(V.act(match, 0, 'mark', i, 5000, { question: true }).ok, true);
  assert.equal(g0.mark[i], M.Mark.QUESTION);
  assert.equal(V.act(match, 0, 'chord', i, 5000).error, 'not_open');
  assert.equal(V.act(match, 0, 'dance', i, 5000).error, 'bad_action');
  assert.equal(V.act(match, 0, 'reveal', 9999, 5000).error, 'out_of_board');
  assert.equal(M.encodeBoard(match.players[1].game), before1, '상대 판은 그대로');
});

test('지뢰를 밟으면 내 판만 끝나고 라운드는 이어진다 — 상대가 끝내면 점수로 승부', () => {
  const match = ready({ countdownSeconds: 0 });
  V.act(match, 1, 'reveal', mineCell(match, 1), 9000);        // 나: 지뢰
  assert.equal(match.phase, V.Phase.PLAYING, '라운드는 계속');
  assert.equal(match.players[1].game.phase, M.Phase.LOST);
  assert.equal(match.players[1].game.endedAt, 9000);
  assert.equal(V.act(match, 1, 'reveal', safeCell(match, 1), 9500).error, 'board_over');
  assert.equal(V.act(match, 0, 'reveal', safeCell(match, 0), 9500).ok, true, '가는 계속 둘 수 있다');

  clearBoard(match, 0, 20000);                                  // 가: 다 열기
  assert.equal(match.phase, V.Phase.OVER);
  assert.equal(match.winner, 0);
  assert.equal(match.overReason, 'points');
  const h = match.history[0];
  assert.deepEqual(h.outcome, ['clear', 'mine']);
  assert.ok(h.points[0] > h.points[1]);
  assert.equal(h.points[1], V.scoreOf({ opened: match.players[1].game.opened, total: 71, seconds: 8, cleared: false, exploded: true }).total);
});

test('둘 다 지뢰를 밟으면 그 자리에서 끝 — 많이 연 쪽이 이긴다 (억울함 방지)', () => {
  const match = ready({ countdownSeconds: 0 });
  // 나: 출발 지점만 연 채 바로 지뢰. 가: 열 수 있는 만큼 열고 지뢰.
  V.act(match, 1, 'reveal', mineCell(match, 1), 2000);
  const g0 = match.players[0].game;
  const goal = match.players[1].game.opened + 10;   // 나보다 확실히 많이, 다 열진 않게
  while (g0.opened < goal && match.phase === V.Phase.PLAYING) {
    V.act(match, 0, 'reveal', safeCell(match, 0), 3000);
  }
  assert.equal(match.phase, V.Phase.PLAYING);
  V.act(match, 0, 'reveal', mineCell(match, 0), 4000);
  assert.equal(match.phase, V.Phase.OVER);
  assert.equal(match.winner, 0, '지뢰를 밟았어도 더 많이 연 가가 이긴다');
  assert.deepEqual(match.history[0].outcome, ['mine', 'mine']);
  assert.ok(match.history[0].opened[0] > match.history[0].opened[1]);
});

test('먼저 다 열면 그 순간 끝 — 상대는 stopped 로 남고 클리어한 쪽이 이긴다', () => {
  const match = ready({ countdownSeconds: 0 });
  clearBoard(match, 0, 7000);
  assert.equal(match.phase, V.Phase.OVER);
  assert.equal(match.winner, 0);
  assert.deepEqual(match.history[0].outcome, ['clear', 'stopped']);
  assert.equal(match.players[1].game.endedAt, 7000, '상대 시계도 멈춘다');
  assert.equal(V.act(match, 1, 'reveal', safeCell(match, 1), 8000).error, 'not_playing');
});

test('점수가 같으면 무승부', () => {
  const match = ready({ countdownSeconds: 0 });
  // 둘 다 출발 지점만 연 상태로 같은 시각에 지뢰 → 연 칸 수가 같아야 무승부
  const a = match.players[0].game.opened;
  const b = match.players[1].game.opened;
  V.act(match, 0, 'reveal', mineCell(match, 0), 1000);
  V.act(match, 1, 'reveal', mineCell(match, 1), 1000);
  assert.equal(match.phase, V.Phase.OVER);
  if (a === b) assert.equal(match.winner, 'draw');
  else assert.equal(match.winner, a > b ? 0 : 1);
  assert.equal(V.winsOf(match, 'P-ga') + V.winsOf(match, 'P-na'), match.winner === 'draw' ? 0 : 1);
});

test('forfeit — 진행 중에만, 점수와 상관없이 상대 승리', () => {
  const lobby = V.createGame({}, seeded(1));
  V.seatPlayer(lobby, 0, '가', 0, 'A');
  assert.equal(V.forfeit(lobby, 0, 'forfeit', 0).error, 'not_playing');

  const match = ready();                                  // 카운트다운 중에도 기권은 된다
  assert.equal(V.forfeit(match, 0, 'forfeit', 2000).ok, true);
  assert.equal(match.winner, 1);
  assert.equal(match.overReason, 'forfeit');
  assert.equal(match.history[0].ms, 0);
  assert.equal(V.forfeit(match, 1, 'forfeit', 2000).error, 'already_over');
});

test('재대결 — 둘 다 눌러야 새 판과 새 카운트다운, 승수는 이어진다', () => {
  const match = ready({ countdownSeconds: 0 });
  assert.equal(V.requestRematch(match, 0, 0).error, 'not_over');
  clearBoard(match, 0, 9000);
  const oldBoards = match.players.map((p) => M.encodeLayout(p.game));
  V.requestRematch(match, 0, 10000);
  assert.equal(match.phase, V.Phase.OVER);
  V.requestRematch(match, 1, 10000);
  assert.equal(match.phase, V.Phase.PLAYING);
  assert.equal(match.gameNo, 2);
  assert.equal(match.winner, null);
  assert.notDeepEqual(match.players.map((p) => M.encodeLayout(p.game)), oldBoards);
  assert.equal(V.winsOf(match, 'P-ga'), 1);
  assert.equal(V.winsOf(match, 'P-na'), 0);
});

test('자리 비우기·앉기 — 진행 중엔 안 되고, 승수는 사람을 따라간다', () => {
  const match = ready({ countdownSeconds: 0 });
  assert.equal(V.unseatPlayer(match, 1).error, 'in_progress');
  assert.equal(V.seatPlayer(match, 1, '다', 5000, 'P-da').error, 'in_progress');
  clearBoard(match, 0, 9000);                                   // 가 승
  assert.equal(V.unseatPlayer(match, 1).ok, true);              // 나가 관전으로
  assert.equal(match.phase, V.Phase.LOBBY);
  assert.equal(match.players[1].joined, false);
  assert.equal(match.players[0].rematch, false);
  assert.equal(match.history.length, 1, '기록은 남는다');

  assert.equal(V.seatPlayer(match, 1, '다', 10000, 'P-da').ok, true);   // 관전자 다가 앉음 → 바로 시작
  assert.equal(match.phase, V.Phase.PLAYING);
  assert.equal(match.gameNo, 2, '교대 뒤 새 판도 판 번호가 이어진다');
  clearBoard(match, 1, 12000);                                  // 다 승
  assert.equal(match.winner, 1);
  assert.equal(V.winsOf(match, 'P-ga'), 1);
  assert.equal(V.winsOf(match, 'P-na'), 0);
  assert.equal(V.winsOf(match, 'P-da'), 1);

  // 나가 다시 1번 자리에 앉으면 (다는 비우고) 승수 0 그대로, 다가 0번에 앉으면 1
  assert.equal(V.unseatPlayer(match, 1).ok, true);
  assert.equal(V.unseatPlayer(match, 0).ok, true);
  V.seatPlayer(match, 0, '다', 13000, 'P-da');
  V.seatPlayer(match, 1, '나', 13000, 'P-na');
  const v = V.viewFor(match, 1, 13000);
  assert.equal(v.seats[0].wins, 1);
  assert.equal(v.seats[1].wins, 0);
});

test('viewFor — 내 판의 지뢰 배치는 나에게만, 상대 판은 열린 칸과 깃발만, pids 는 안 나간다', () => {
  const match = ready({ countdownSeconds: 0 });
  V.act(match, 1, 'mark', safeCell(match, 1), 5000);
  const v0 = V.viewFor(match, 0, 5000);
  assert.equal(v0.role, 'player');
  assert.equal(v0.you, 0);
  assert.equal(v0.phase, 'playing');
  assert.equal(v0.total, 71);
  assert.equal(v0.seats[0].name, '가');
  assert.equal(v0.seats[0].layout, M.encodeLayout(match.players[0].game));
  assert.equal(v0.seats[1].name, '나');
  assert.equal(v0.seats[1].layout, null);
  assert.equal(v0.seats[1].board, M.encodeBoard(match.players[1].game));
  assert.equal(/[*X]/.test(v0.seats[1].board), false);
  assert.equal(v0.seats[1].flags, 1);
  assert.equal(typeof v0.seats[0].points.total, 'number');
  assert.equal(v0.winner, null);

  V.act(match, 1, 'reveal', mineCell(match, 1), 6000);
  clearBoard(match, 0, 7000);
  const over0 = V.viewFor(match, 0, 7000);
  assert.equal(over0.winner, 0);
  assert.equal(over0.overReason, 'points');
  assert.equal(over0.seats[1].boardPhase, 'lost');
  assert.ok(over0.seats[1].board.includes('X'), '진 뒤엔 상대 판의 지뢰가 보인다');
  assert.equal(over0.history.length, 1);
  assert.equal(over0.history[0].pids, undefined, 'pid 목록은 서버 안에서만');
  assert.deepEqual(over0.history[0].names, ['가', '나']);
  assert.equal(over0.seats[0].wins, 1);
});

test('viewForSpectator — 두 판 모두 지뢰 배치 없이, 관전자 표시', () => {
  const match = ready({ countdownSeconds: 0 });
  const v = V.viewForSpectator(match, 5000);
  assert.equal(v.role, 'spectator');
  assert.equal(v.you, null);
  assert.equal(v.seats[0].layout, null);
  assert.equal(v.seats[1].layout, null);
  assert.equal(v.seats[0].board.length, 81);
  assert.equal(v.seats[0].pid, 'P-ga');
});

test('viewFor — 판이 없을 때(대기 중)도 안전하다', () => {
  const match = V.createGame({}, seeded(1));
  V.seatPlayer(match, 0, '가', 0, 'A');
  const v = V.viewFor(match, 0, 0);
  assert.equal(v.phase, 'lobby');
  assert.equal(v.seats[0].board, undefined);
  assert.equal(v.seats[1].joined, false);
  assert.equal(v.seats[0].wins, 0);
  assert.deepEqual(v.history, []);
});
