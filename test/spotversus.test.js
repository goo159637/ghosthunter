import test from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../shared/spotversus.js';
import * as S from '../shared/spot.js';

function seeded(seed) {
  return S.makeRng(seed);
}

function ready(opts = {}, seed = 1) {
  const match = V.createGame({ difficulty: 'easy', countdownSeconds: 0, ...opts }, seeded(seed));
  V.seatPlayer(match, 0, '가', 1000, 'P-ga');
  V.seatPlayer(match, 1, '나', 1000, 'P-na');
  return match;
}

/** 아직 아무도 안 가져간 차이 하나의 중심 */
function unclaimed(match) {
  const i = match.claims.indexOf(null);
  const d = match.puzzle.diffs[i];
  return { i, x: d.cx, y: d.cy };
}

/** 어떤 차이 원에도 안 들어가는 점 */
function emptySpot(match) {
  for (let x = 0; x < S.WIDTH; x += 5) {
    for (let y = 0; y < S.HEIGHT; y += 5) {
      if (match.puzzle.diffs.every((d) => Math.hypot(d.cx - x, d.cy - y) > d.r + 1)) return { x, y };
    }
  }
  throw new Error('빈 곳이 없다');
}

test('normalizeOptions — 퍼즐 옵션 + 카운트다운 + 제한시간', () => {
  const o = V.normalizeOptions({ difficulty: 'hard', countdownSeconds: 99, timeLimitSeconds: 5 });
  assert.equal(o.diffs, 10);
  assert.equal(o.countdownSeconds, 10);
  assert.equal(o.timeLimitSeconds, 10);
  assert.equal(V.normalizeOptions({}).timeLimitSeconds, 180);
});

test('둘 다 앉으면 같은 퍼즐로 카운트다운 → 출발, 제한시간이 끝나면 종료', () => {
  const match = V.createGame({ difficulty: 'easy', countdownSeconds: 2, timeLimitSeconds: 30 }, seeded(3));
  V.seatPlayer(match, 0, '가', 1000, 'A');
  assert.equal(match.puzzle, null);
  V.seatPlayer(match, 1, '나', 1000, 'B');
  assert.equal(match.phase, V.Phase.COUNTDOWN);
  assert.equal(match.startAt, 3000);
  assert.equal(match.endsAt, 33000);
  assert.equal(match.puzzle.diffs.length, 5);
  assert.deepEqual(match.claims, [null, null, null, null, null]);
  assert.equal(V.tick(match, 2999), false);
  assert.equal(V.tick(match, 3000), true);
  assert.equal(match.phase, V.Phase.PLAYING);
  assert.equal(V.tick(match, 33000), true);
  assert.equal(match.phase, V.Phase.OVER);
  assert.equal(match.overReason, 'time');
  assert.equal(match.winner, 'draw');
});

test('click — 맞으면 가져가고, 틀리면 잠깐 잠기고, 이미 찾은 건 틀린 걸로', () => {
  const match = ready();
  const { i, x, y } = unclaimed(match);
  const out = V.click(match, 0, x, y, 2000);
  assert.deepEqual(out, { ok: true, hit: true, index: i });
  assert.equal(match.claims[i], 0);
  assert.equal(match.players[0].found, 1);

  // 같은 곳을 나가 찍으면 틀림 + 잠김
  const again = V.click(match, 1, x, y, 2100);
  assert.equal(again.hit, false);
  assert.equal(again.lockedUntil, 2100 + V.MISS_LOCK_MS);
  assert.equal(match.players[1].misses, 1);
  const locked = V.click(match, 1, unclaimed(match).x, unclaimed(match).y, 2500);
  assert.equal(locked.hit, false);
  assert.equal(locked.locked, true);
  assert.equal(match.players[1].found, 0, '잠긴 동안엔 맞아도 안 쳐준다');
  const free = V.click(match, 1, unclaimed(match).x, unclaimed(match).y, 2100 + V.MISS_LOCK_MS);
  assert.equal(free.hit, true);

  const e = emptySpot(match);
  assert.equal(V.click(match, 0, e.x, e.y, 5000).hit, false);
  assert.equal(match.players[0].misses, 1);
  assert.equal(V.click(match, 0, 'x', 1, 9000).error, 'bad_message');
});

test('다 찾히면 끝 — 더 많이 찾은 쪽이 승리, 기록과 승수', () => {
  const match = ready();
  let t = 5000;
  // 가가 3개, 나가 2개
  for (let k = 0; k < 5; k++) {
    const who = k < 3 ? 0 : 1;
    const { x, y } = unclaimed(match);
    assert.equal(V.click(match, who, x, y, (t += 100)).hit, true);
  }
  assert.equal(match.phase, V.Phase.OVER);
  assert.equal(match.overReason, 'found');
  assert.equal(match.winner, 0);
  assert.deepEqual(match.history[0].found, [3, 2]);
  assert.equal(match.history[0].total, 5);
  assert.equal(V.winsOf(match, 'P-ga'), 1);
  assert.equal(V.winsOf(match, 'P-na'), 0);
  assert.equal(V.click(match, 0, 10, 10, t + 1).error, 'not_playing');
});

test('forfeit 와 재대결 — 재대결이면 새 퍼즐, 판 번호와 승수는 이어진다', () => {
  const match = ready();
  const firstSeed = match.puzzle.seed;
  assert.equal(V.forfeit(match, 1, 'forfeit', 3000).ok, true);
  assert.equal(match.winner, 0);
  assert.equal(match.overReason, 'forfeit');
  V.requestRematch(match, 0, 4000);
  V.requestRematch(match, 1, 4000);
  assert.equal(match.phase, V.Phase.PLAYING);
  assert.equal(match.gameNo, 2);
  assert.notEqual(match.puzzle.seed, firstSeed);
  assert.equal(match.players[0].found, 0);
  assert.equal(V.winsOf(match, 'P-ga'), 1);
});

test('자리 비우기/앉기 — 진행 중엔 안 되고, 승수는 사람을 따라간다', () => {
  const match = ready();
  assert.equal(V.unseatPlayer(match, 1).error, 'in_progress');
  V.forfeit(match, 1, 'forfeit', 3000);
  assert.equal(V.unseatPlayer(match, 1).ok, true);
  assert.equal(match.phase, V.Phase.LOBBY);
  assert.equal(V.seatPlayer(match, 1, '다', 5000, 'P-da').ok, true);
  assert.equal(match.phase, V.Phase.PLAYING);
  assert.equal(match.gameNo, 2);
  const v = V.viewFor(match, 1, 5000);
  assert.equal(v.seats[0].wins, 1);
  assert.equal(v.seats[1].wins, 0);
});

test('viewFor / viewForSpectator — 정답은 절대 안 나가고, 찾은 것만 위치가 보인다', () => {
  const match = ready();
  const v0 = V.viewFor(match, 0, 2000);
  assert.equal(v0.role, 'player');
  assert.equal(v0.you, 0);
  assert.equal(v0.puzzle.diffs, undefined, '차이 위치는 서버만 안다');
  assert.equal(v0.puzzle.diffCount, 5);
  assert.deepEqual(v0.puzzle.left, match.puzzle.left);
  assert.deepEqual(v0.found, []);
  assert.equal(v0.endsAt, match.endsAt);

  const { i, x, y } = unclaimed(match);
  V.click(match, 1, x, y, 2500);
  const v1 = V.viewForSpectator(match, 2600);
  assert.equal(v1.role, 'spectator');
  assert.equal(v1.you, null);
  assert.equal(v1.found.length, 1);
  assert.equal(v1.found[0].index, i);
  assert.equal(v1.found[0].by, 1);
  assert.equal(v1.found[0].cx, x);
  assert.equal(v1.seats[1].found, 1);
  assert.equal(JSON.stringify(v1).includes('"diffs":['), false);
  assert.equal(v1.history.length, 0);
  V.forfeit(match, 0, 'forfeit', 3000);
  const h = V.viewFor(match, 0, 3000).history[0];
  assert.equal(h.pids, undefined);
  assert.deepEqual(h.names, ['가', '나']);
});
