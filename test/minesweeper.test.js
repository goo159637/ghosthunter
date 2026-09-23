import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from '../shared/minesweeper.js';

/** 재현 가능한 난수 (mulberry32). */
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

/**
 * 그림으로 판을 만든다. '*' 가 지뢰. 이미 지뢰가 심긴(PLAYING) 상태로 돌려준다.
 *   boardFrom(['*..', '...', '..*'])
 */
function boardFrom(lines) {
  const rows = lines.length;
  const cols = lines[0].length;
  const mines = lines.join('').split('').filter((ch) => ch === '*').length;
  const game = M.createGame({ rows, cols, mines });
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) game.mine[M.index(game, r, c)] = lines[r][c] === '*';
  }
  for (let i = 0; i < rows * cols; i++) {
    game.count[i] = game.mine[i] ? 0 : M.neighbors(game, i).filter((n) => game.mine[n]).length;
  }
  game.phase = M.Phase.PLAYING;
  game.startedAt = 0;
  return game;
}

const at = (game, r, c) => M.index(game, r, c);

/** 자주 쓰는 5×5 예제판. (1,1) 은 2, (0,2) 는 0 이라 조금만 열린다. */
const CORNERS = () => boardFrom([
  '*...*',
  '.....',
  '..*..',
  '.....',
  '*...*',
]);

test('normalizeOptions — 범위를 벗어나면 잘라내고, 지뢰는 안전지대 9칸을 남긴다', () => {
  assert.deepEqual(M.normalizeOptions({ rows: 9, cols: 9, mines: 10 }), { rows: 9, cols: 9, mines: 10 });
  assert.deepEqual(M.normalizeOptions({ rows: 1, cols: 999, mines: 0 }), { rows: 5, cols: 60, mines: 1 });
  assert.deepEqual(M.normalizeOptions({ rows: 5, cols: 5, mines: 100 }), { rows: 5, cols: 5, mines: 16 });
  assert.deepEqual(M.normalizeOptions({ rows: 'x', cols: null }), { rows: 9, cols: 9, mines: 10 });
  assert.deepEqual(M.normalizeOptions({ rows: 7.9, cols: 6.2, mines: 3.5 }), { rows: 7, cols: 6, mines: 3 });
});

test('presetFor — 프리셋과 똑같은 옵션만 이름을 돌려준다', () => {
  assert.equal(M.presetFor(M.PRESETS.easy), 'easy');
  assert.equal(M.presetFor({ rows: 16, cols: 30, mines: 99 }), 'hard');
  assert.equal(M.presetFor({ rows: 16, cols: 30, mines: 98 }), null);
});

test('neighbors — 모서리 3, 변 5, 가운데 8', () => {
  const game = M.createGame({ rows: 5, cols: 5, mines: 1 });
  assert.deepEqual(M.neighbors(game, at(game, 0, 0)), [1, 5, 6]);
  assert.equal(M.neighbors(game, at(game, 0, 2)).length, 5);
  assert.equal(M.neighbors(game, at(game, 2, 2)).length, 8);
  assert.equal(M.neighbors(game, at(game, 4, 4)).length, 3);
});

test('createGame — 지뢰는 아직 없고, 첫 클릭 전까지 시작하지 않는다', () => {
  const game = M.createGame(M.PRESETS.easy);
  assert.equal(game.phase, M.Phase.READY);
  assert.equal(game.mine.filter(Boolean).length, 0);
  assert.equal(game.startedAt, null);
  assert.equal(M.elapsedMs(game, 5000), 0);
});

test('첫 클릭 — 절대 터지지 않고, 주변 8칸도 비어 있어 최소 9칸이 열린다', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const game = M.createGame(M.PRESETS.normal, seeded(seed));
    const first = at(game, 7, 7);
    const out = M.reveal(game, first, 1000);
    assert.equal(out.ok, true);
    assert.equal(game.phase === M.Phase.PLAYING || game.phase === M.Phase.WON, true);
    assert.equal(game.startedAt, 1000);
    assert.equal(game.mine[first], false);
    for (const n of M.neighbors(game, first)) assert.equal(game.mine[n], false, `seed ${seed}: 주변에 지뢰`);
    assert.equal(game.count[first], 0);
    assert.ok(out.opened.length >= 9, `seed ${seed}: ${out.opened.length}칸만 열림`);
    assert.equal(game.mine.filter(Boolean).length, game.mines, `seed ${seed}: 지뢰 수`);
  }
});

test('지뢰가 최대치라면 첫 클릭으로 정확히 9칸이 열리고 바로 승리한다', () => {
  const game = M.createGame({ rows: 5, cols: 5, mines: 16 }, seeded(7));
  const out = M.reveal(game, at(game, 2, 2), 0);
  assert.equal(out.opened.length, 9);
  assert.equal(game.phase, M.Phase.WON);
  assert.equal(game.flags, 16);
});

test('주변 지뢰 수가 정확하다', () => {
  for (let seed = 1; seed <= 30; seed++) {
    const game = M.createGame(M.PRESETS.hard, seeded(seed));
    M.reveal(game, 0, 0);
    for (let i = 0; i < game.rows * game.cols; i++) {
      if (game.mine[i]) continue;
      const expect = M.neighbors(game, i).filter((n) => game.mine[n]).length;
      assert.equal(game.count[i], expect, `seed ${seed}, 칸 ${i}`);
    }
  }
});

test('flood — 0 인 칸에서 번져 나가고 숫자 칸에서 멈춘다', () => {
  const game = boardFrom([
    '.....',
    '.....',
    '.....',
    '...*.',
    '.....',
  ]);
  const out = M.reveal(game, at(game, 0, 0), 0);
  assert.equal(out.ok, true);
  // 지뢰 오른쪽·아래·대각선 아래 3칸은 0 인 칸과 닿아 있지 않아 남는다
  assert.equal(out.opened.length, 21);
  assert.equal(game.phase, M.Phase.PLAYING);
  for (const [r, c] of [[3, 4], [4, 3], [4, 4]]) assert.equal(game.open[at(game, r, c)], false);
  M.reveal(game, at(game, 3, 4), 0);
  M.reveal(game, at(game, 4, 3), 0);
  M.reveal(game, at(game, 4, 4), 0);
  assert.equal(game.phase, M.Phase.WON);
});

test('flood — 깃발은 건너뛰고 물음표는 열면서 지운다', () => {
  const game = boardFrom([
    '.....',
    '.....',
    '.....',
    '.....',
    '....*',
  ]);
  M.toggleMark(game, at(game, 1, 1));                      // 깃발
  M.toggleMark(game, at(game, 2, 2));
  M.toggleMark(game, at(game, 2, 2));                      // 물음표
  const out = M.reveal(game, at(game, 0, 0), 0);
  assert.equal(game.open[at(game, 1, 1)], false);
  assert.equal(game.mark[at(game, 1, 1)], M.Mark.FLAG);
  assert.equal(game.open[at(game, 2, 2)], true);
  assert.equal(game.mark[at(game, 2, 2)], M.Mark.NONE);
  assert.equal(out.opened.length, 23);                     // 25 - 지뢰 1 - 깃발 1
  assert.equal(game.phase, M.Phase.PLAYING);               // 깃발 칸이 아직 안 열려서 미완
  assert.equal(game.flags, 1);
});

test('reveal — 지뢰를 밟으면 진다', () => {
  const game = boardFrom(['*..', '...', '..*']);
  const out = M.reveal(game, 0, 4321);
  assert.deepEqual(out, { ok: true, exploded: 0, opened: [] });
  assert.equal(game.phase, M.Phase.LOST);
  assert.equal(game.exploded, 0);
  assert.equal(game.endedAt, 4321);
  assert.equal(M.reveal(game, 6).ok, false);
  assert.equal(M.toggleMark(game, 6).ok, false);
  assert.equal(M.chord(game, 6).ok, false);
});

test('reveal — 열린 칸, 깃발 칸, 판 밖은 거절한다', () => {
  const game = CORNERS();
  const me = at(game, 1, 1);
  assert.deepEqual(M.reveal(game, me, 0), { ok: true, opened: [me] });   // 2 라서 한 칸만
  assert.equal(M.reveal(game, me).error, 'already_open');
  M.toggleMark(game, 1);
  assert.equal(M.reveal(game, 1).error, 'flagged');
  assert.equal(M.reveal(game, 25).error, 'out_of_board');
  assert.equal(M.reveal(game, -1).error, 'out_of_board');
  assert.equal(M.reveal(game, 1.5).error, 'out_of_board');
});

test('toggleMark — 없음 → 깃발 → 물음표 → 없음, 옵션을 끄면 물음표를 건너뛴다', () => {
  const game = M.createGame({ rows: 5, cols: 5, mines: 3 });
  assert.equal(M.toggleMark(game, 0).mark, M.Mark.FLAG);   // 시작 전에도 꽂을 수 있다
  assert.equal(game.flags, 1);
  assert.equal(M.remainingMines(game), 2);
  assert.equal(M.toggleMark(game, 0).mark, M.Mark.QUESTION);
  assert.equal(game.flags, 0);
  assert.equal(M.toggleMark(game, 0).mark, M.Mark.NONE);
  assert.equal(M.toggleMark(game, 0, { question: false }).mark, M.Mark.FLAG);
  assert.equal(M.toggleMark(game, 0, { question: false }).mark, M.Mark.NONE);
  assert.equal(game.flags, 0);
});

test('toggleMark — 열린 칸에는 못 꽂고, 깃발은 지뢰 수보다 많아도 된다', () => {
  const game = CORNERS();
  const me = at(game, 1, 1);
  M.reveal(game, me, 0);
  assert.equal(M.toggleMark(game, me).error, 'already_open');
  for (const i of [1, 2, 3, 5, 7, 9]) M.toggleMark(game, i);
  assert.equal(game.flags, 6);
  assert.equal(M.remainingMines(game), -1);
});

test('chord — 깃발 수가 맞으면 주변을 한꺼번에 연다', () => {
  const game = boardFrom([
    '*....',
    '.....',
    '.....',
    '.....',
    '....*',
  ]);
  M.reveal(game, at(game, 1, 1), 0);           // 숫자 1
  assert.equal(game.opened, 1);
  assert.equal(M.chord(game, at(game, 1, 1)).error, 'flags_mismatch');
  M.toggleMark(game, at(game, 0, 0));
  const out = M.chord(game, at(game, 1, 1), 0);
  assert.equal(out.ok, true);
  // 주변 7칸 중 0 인 칸에서 번져 나가 오른쪽 아래 지뢰만 빼고 다 열린다
  assert.equal(game.opened, 23);
  assert.equal(game.phase, M.Phase.WON);
});

test('chord — 깃발을 잘못 꽂았으면 지뢰를 밟는다', () => {
  const game = boardFrom([
    '*....',
    '.....',
    '.....',
    '.....',
    '....*',
  ]);
  M.reveal(game, at(game, 1, 1), 0);
  M.toggleMark(game, at(game, 0, 1));           // 엉뚱한 곳에 깃발
  const out = M.chord(game, at(game, 1, 1), 99);
  assert.equal(out.ok, true);
  assert.equal(out.exploded, at(game, 0, 0));
  assert.equal(game.phase, M.Phase.LOST);
  assert.equal(game.endedAt, 99);
});

test('chord — 닫힌 칸, 0 칸, 열 게 없는 칸은 거절한다', () => {
  const game = CORNERS();
  assert.equal(M.chord(game, at(game, 0, 1)).error, 'not_open');
  const out = M.reveal(game, at(game, 0, 2), 0);   // 0 인 칸 → 주변 5칸까지만 열린다
  assert.equal(out.opened.length, 6);
  assert.equal(M.chord(game, at(game, 0, 2)).error, 'nothing_to_open');
  // (0,1) 은 1. 지뢰에 깃발을 꽂고 나머지 이웃 (1,0) 을 따로 열어 두면 열 게 없다
  M.toggleMark(game, at(game, 0, 0));
  M.reveal(game, at(game, 1, 0), 0);
  assert.equal(M.chord(game, at(game, 0, 1)).error, 'nothing_to_open');
  const fresh = M.createGame({ rows: 5, cols: 5, mines: 1 });
  assert.equal(M.chord(fresh, 0).error, 'not_playing');
});

test('승리 — 지뢰 아닌 칸을 모두 열면 남은 지뢰에 깃발이 자동으로 꽂힌다', () => {
  const game = CORNERS();
  M.toggleMark(game, 1);                        // 아무 데나 꽂았던 깃발
  M.toggleMark(game, 1);
  M.toggleMark(game, 1);                        // 다시 없음
  M.toggleMark(game, 0);                        // 지뢰 하나에는 미리 깃발
  for (let i = 0; i < 25; i++) if (!game.mine[i]) M.reveal(game, i, 500);
  assert.equal(game.phase, M.Phase.WON);
  assert.equal(game.endedAt, 500);
  for (let i = 0; i < 25; i++) assert.equal(game.mark[i], game.mine[i] ? M.Mark.FLAG : M.Mark.NONE);
  assert.equal(game.flags, 5);
  assert.equal(M.remainingMines(game), 0);
  assert.equal(M.isOver(game), true);
});

test('elapsedMs — 시작 전 0, 진행 중엔 흐르고, 끝나면 멈춘다', () => {
  const game = M.createGame(M.PRESETS.normal, seeded(3));
  assert.equal(M.elapsedMs(game, 100), 0);
  M.reveal(game, 0, 1000);
  assert.equal(game.phase, M.Phase.PLAYING);
  assert.equal(M.elapsedMs(game, 4500), 3500);
  game.endedAt = 6000;
  assert.equal(M.elapsedMs(game, 99999), 5000);
});

test('cellView — 끝나기 전엔 지뢰가 보이지 않고, 진 뒤엔 지뢰와 잘못된 깃발이 드러난다', () => {
  const game = CORNERS();
  const me = at(game, 1, 1);
  M.toggleMark(game, 24);                       // 맞는 깃발
  M.toggleMark(game, 5);                        // 틀린 깃발
  M.reveal(game, me, 0);
  assert.deepEqual(M.cellView(game, 0), { open: false, count: 0, mark: 0, mine: false, exploded: false, wrongFlag: false });
  assert.deepEqual(M.cellView(game, me), { open: true, count: 2, mark: 0, mine: false, exploded: false, wrongFlag: false });
  assert.equal(M.cellView(game, 1).count, 0);   // 닫힌 칸은 숫자도 새지 않는다

  M.reveal(game, 0, 0);                         // 펑
  assert.equal(M.cellView(game, 0).mine, true);
  assert.equal(M.cellView(game, 0).exploded, true);
  assert.equal(M.cellView(game, 4).mine, true);   // 다른 지뢰도 드러난다
  assert.equal(M.cellView(game, 4).exploded, false);
  assert.equal(M.cellView(game, 24).mine, false); // 깃발이 꽂힌 지뢰는 깃발로 남는다
  assert.equal(M.cellView(game, 24).mark, M.Mark.FLAG);
  assert.equal(M.cellView(game, 5).wrongFlag, true);
});

test('무작위 판 — 어떤 크기든 지뢰 수가 정확하고 안전지대를 지킨다', () => {
  const cases = [
    { rows: 5, cols: 5, mines: 16 },
    { rows: 40, cols: 60, mines: 2391 },      // 최대 판, 최대 지뢰
    { rows: 5, cols: 60, mines: 291 },
    M.PRESETS.easy,
  ];
  for (const opts of cases) {
    for (let seed = 1; seed <= 5; seed++) {
      const game = M.createGame(opts, seeded(seed));
      const first = at(game, game.rows - 1, 0);   // 왼쪽 아래 모서리
      M.reveal(game, first, 0);
      assert.equal(game.mine.filter(Boolean).length, opts.mines);
      assert.equal(game.mine[first], false);
      for (const n of M.neighbors(game, first)) assert.equal(game.mine[n], false);
    }
  }
});

/* ───────── 전송용 직렬화 ───────── */

test('encodeBoard — 글자 하나가 칸 하나, 끝나기 전엔 지뢰가 새지 않는다', () => {
  const game = CORNERS();
  M.toggleMark(game, 24);
  M.toggleMark(game, 5);
  M.toggleMark(game, 5);                        // 물음표
  M.reveal(game, at(game, 1, 1), 0);
  const s = M.encodeBoard(game);
  assert.equal(s.length, 25);
  assert.equal(s[at(game, 1, 1)], '2');
  assert.equal(s[24], 'F');
  assert.equal(s[5], '?');
  assert.equal(s[0], '.');                      // 지뢰지만 닫힌 칸은 그냥 '.'
  assert.equal(/[*X!]/.test(s), false);

  M.toggleMark(game, 5);                        // 없음
  M.toggleMark(game, 5);                        // 틀린 깃발
  M.reveal(game, 0, 0);                         // 펑
  const lost = M.encodeBoard(game);
  assert.equal(lost[0], 'X');
  assert.equal(lost[4], '*');
  assert.equal(lost[24], 'F');                  // 맞는 깃발은 그대로
  assert.equal(lost[5], '!');
});

test('encodeLayout — 지뢰 배치 문자열', () => {
  const game = CORNERS();
  const s = M.encodeLayout(game);
  assert.equal(s, '*...*' + '.....' + '..*..' + '.....' + '*...*');
});

test('fromSnapshot — layout 이 있으면 원래 게임과 똑같이 되살아나고 계속 둘 수 있다', () => {
  for (let seed = 1; seed <= 20; seed++) {
    const game = M.createGame(M.PRESETS.normal, seeded(seed));
    M.reveal(game, 100, 1000);
    M.toggleMark(game, 0);
    M.toggleMark(game, 1);
    M.toggleMark(game, 1);
    const copy = M.fromSnapshot({
      rows: game.rows, cols: game.cols, mines: game.mines,
      board: M.encodeBoard(game), layout: M.encodeLayout(game),
      phase: game.phase, startedAt: game.startedAt, endedAt: game.endedAt,
    });
    assert.deepEqual(copy.mine, game.mine);
    assert.deepEqual(copy.count, game.count);
    assert.deepEqual(copy.open, game.open);
    assert.deepEqual(copy.mark, game.mark);
    assert.equal(copy.opened, game.opened);
    assert.equal(copy.flags, game.flags);
    assert.equal(copy.phase, game.phase);
    assert.equal(copy.startedAt, 1000);
    // 같은 조작을 하면 같은 결과
    const safe = copy.open.findIndex((o, i) => !o && !copy.mine[i] && copy.mark[i] === M.Mark.NONE);
    const a = M.reveal(game, safe, 2000);
    const b = M.reveal(copy, safe, 2000);
    assert.deepEqual(a, b);
    assert.equal(M.encodeBoard(copy), M.encodeBoard(game));
  }
});

test('fromSnapshot — layout 없이도(상대 판) 그리기용 정보는 완전히 복원된다', () => {
  const game = CORNERS();
  M.toggleMark(game, 24);
  M.toggleMark(game, 5);
  M.reveal(game, at(game, 0, 2), 0);
  M.reveal(game, 0, 0);                         // 펑
  const snap = { rows: 5, cols: 5, mines: 5, board: M.encodeBoard(game), layout: null, phase: game.phase, startedAt: 0, endedAt: 0 };
  const copy = M.fromSnapshot(snap);
  for (let i = 0; i < 25; i++) assert.deepEqual(M.cellView(copy, i), M.cellView(game, i), `칸 ${i}`);
  assert.equal(copy.opened, game.opened);
  assert.equal(copy.flags, game.flags);
  assert.equal(copy.exploded, 0);
  assert.equal(M.encodeBoard(copy), snap.board);
});

test('fromSnapshot — 이상한 입력도 터지지 않는다', () => {
  const copy = M.fromSnapshot({ rows: 5, cols: 5, mines: 3, board: 'zz', layout: '***', phase: 'nope' });
  assert.equal(copy.phase, M.Phase.PLAYING);
  assert.equal(copy.opened, 0);
  assert.equal(copy.mine.filter(Boolean).length, 0);
});
