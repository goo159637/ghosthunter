/**
 * 틀린그림찾기 1:1 대전의 상태머신.
 *
 * 두 사람이 같은 그림 한 쌍을 보고, 차이를 먼저 클릭한 사람이 그 차이를 가져간다.
 * 다 찾히거나 제한시간이 끝나면 더 많이 찾은 쪽이 승리, 같으면 무승부.
 * 틀리게 찍으면 잠깐(MISS_LOCK_MS) 못 찍는다 — 마구 찍기 방지.
 *
 * 정답(차이 위치)은 서버만 안다. 브라우저에는 그림(물체 목록)과 이미 찾은 차이만 간다.
 * 자리(0/1)와 사람(pid)은 다르다 — 승수는 사람에게 붙는다 (지뢰찾기와 같은 구조).
 *
 * 순수 로직만 담는다 — 소켓도 타이머도 모른다. 시간은 항상 인자로 받는다.
 */
import * as S from './spot.js';

export const Phase = {
  LOBBY: 'lobby',
  COUNTDOWN: 'countdown',
  PLAYING: 'playing',
  OVER: 'over',
};

export const DEFAULT_COUNTDOWN_SECONDS = 3;
export const MAX_COUNTDOWN_SECONDS = 10;
export const DEFAULT_TIME_LIMIT_SECONDS = 180;
export const MISS_LOCK_MS = 1500;
const HISTORY_LIMIT = 30;

function fail(error) {
  return { ok: false, error };
}

function mkPlayer() {
  return { pid: null, name: '', joined: false, present: false, rematch: false, found: 0, misses: 0, lockedUntil: 0 };
}

export function normalizeOptions(opts = {}) {
  const puzzle = S.normalizeOptions(opts);
  const c = Number(opts.countdownSeconds);
  const countdownSeconds = Number.isFinite(c) ? Math.min(MAX_COUNTDOWN_SECONDS, Math.max(0, Math.trunc(c))) : DEFAULT_COUNTDOWN_SECONDS;
  const t = Number(opts.timeLimitSeconds);
  const timeLimitSeconds = Number.isFinite(t) ? Math.min(600, Math.max(10, Math.trunc(t))) : DEFAULT_TIME_LIMIT_SECONDS;
  return { ...puzzle, countdownSeconds, timeLimitSeconds };
}

export function createGame(opts = {}, rand = Math.random) {
  return {
    ...normalizeOptions(opts),
    phase: Phase.LOBBY,
    puzzle: null,         // 라운드마다 새로 만든다
    claims: [],           // 차이 번호 → 가져간 자리 (null 이면 아직)
    startAt: null,
    endsAt: null,
    winner: null,         // 0 | 1 | 'draw'
    overReason: null,     // 'found' | 'time' | 'forfeit'
    gameNo: 1,
    history: [],
    players: [mkPlayer(), mkPlayer()],
    rand,
  };
}

function beginRound(match, now) {
  match.phase = Phase.COUNTDOWN;
  match.gameNo = match.history.length + 1;
  match.startAt = now + match.countdownSeconds * 1000;
  match.endsAt = match.startAt + match.timeLimitSeconds * 1000;
  match.puzzle = S.generatePuzzle({ seed: S.randomSeed(match.rand), diffs: match.diffs, theme: match.theme, difficulty: match.difficulty === 'custom' ? undefined : match.difficulty });
  match.claims = new Array(match.puzzle.diffs.length).fill(null);
  match.winner = null;
  match.overReason = null;
  for (const p of match.players) {
    p.rematch = false;
    p.found = 0;
    p.misses = 0;
    p.lockedUntil = 0;
  }
  tick(match, now);
}

function finish(match, now, { forcedWinner = null, reason } = {}) {
  const found = match.players.map((p) => p.found);
  let winner = forcedWinner;
  if (winner === null) {
    if (found[0] > found[1]) winner = 0;
    else if (found[1] > found[0]) winner = 1;
    else winner = 'draw';
  }
  match.phase = Phase.OVER;
  match.winner = winner;
  match.overReason = reason;
  match.history.push({
    gameNo: match.gameNo,
    winner,
    reason,
    found,
    misses: match.players.map((p) => p.misses),
    total: match.puzzle.diffs.length,
    ms: Math.max(0, Math.min(now, match.endsAt) - match.startAt),
    names: match.players.map((p) => p.name),
    pids: match.players.map((p) => p.pid),
    theme: match.puzzle.theme,
  });
  if (match.history.length > HISTORY_LIMIT) match.history.shift();
}

/* ───────── 자리 ───────── */

export function seatPlayer(match, index, name, now = Date.now(), pid = null) {
  if (match.phase === Phase.COUNTDOWN || match.phase === Phase.PLAYING) return fail('in_progress');
  const p = match.players[index];
  p.pid = pid ?? `seat${index}`;
  p.joined = true;
  p.present = true;
  p.rematch = false;
  p.name = (name || '').trim().slice(0, 16) || (index === 0 ? '플레이어 1' : '플레이어 2');
  if (match.phase === Phase.OVER) match.phase = Phase.LOBBY;
  if (match.phase === Phase.LOBBY && match.players.every((x) => x.joined)) beginRound(match, now);
  return { ok: true };
}

export function unseatPlayer(match, index) {
  if (match.phase === Phase.COUNTDOWN || match.phase === Phase.PLAYING) return fail('in_progress');
  match.players[index] = mkPlayer();
  match.phase = Phase.LOBBY;
  match.startAt = null;
  for (const p of match.players) p.rematch = false;
  return { ok: true };
}

export function setPresence(match, index, present) {
  match.players[index].present = present;
}

/** 카운트다운이 끝났으면 출발, 제한시간이 끝났으면 종료. 바뀐 게 있으면 true. */
export function tick(match, now = Date.now()) {
  if (match.phase === Phase.COUNTDOWN && now >= match.startAt) {
    match.phase = Phase.PLAYING;
    return true;
  }
  if (match.phase === Phase.PLAYING && now >= match.endsAt) {
    finish(match, now, { reason: 'time' });
    return true;
  }
  return false;
}

/* ───────── 조작 ───────── */

/**
 * 그림의 (x, y) 를 찍는다 (장면 좌표, 어느 쪽 그림이든 같다).
 * @returns {{ok:true, hit:boolean, index?:number, lockedUntil?:number} | {ok:false, error}}
 */
export function click(match, index, x, y, now = Date.now()) {
  tick(match, now);
  if (match.phase !== Phase.PLAYING) return fail('not_playing');
  const p = match.players[index];
  if (now < p.lockedUntil) return { ok: true, hit: false, locked: true, lockedUntil: p.lockedUntil };
  const px = Number(x);
  const py = Number(y);
  if (!Number.isFinite(px) || !Number.isFinite(py)) return fail('bad_message');
  const d = S.hitTest(match.puzzle, px, py);
  if (d === -1 || match.claims[d] !== null) {
    p.misses++;
    p.lockedUntil = now + MISS_LOCK_MS;
    return { ok: true, hit: false, lockedUntil: p.lockedUntil };
  }
  match.claims[d] = index;
  p.found++;
  if (match.claims.every((c) => c !== null)) finish(match, now, { reason: 'found' });
  return { ok: true, hit: true, index: d };
}

export function forfeit(match, index, reason = 'forfeit', now = Date.now()) {
  if (match.phase === Phase.OVER) return fail('already_over');
  if (match.phase === Phase.LOBBY) return fail('not_playing');
  finish(match, now, { forcedWinner: 1 - index, reason });
  return { ok: true };
}

export function requestRematch(match, index, now = Date.now()) {
  if (match.phase !== Phase.OVER) return fail('not_over');
  match.players[index].rematch = true;
  if (match.players.every((p) => p.rematch)) beginRound(match, now);
  return { ok: true };
}

export function status(match) {
  if (match.phase === Phase.LOBBY) return 'lobby';
  if (match.phase === Phase.OVER) return 'over';
  return 'playing';
}

/* ───────── 보기 ───────── */

export function winsOf(match, pid) {
  if (!pid) return 0;
  let n = 0;
  for (const h of match.history) if (h.winner !== 'draw' && h.pids[h.winner] === pid) n++;
  return n;
}

/** 이미 찾은 차이만 — 위치와 누가 찾았는지. 아직 못 찾은 것은 절대 안 나간다. */
function foundList(match) {
  if (!match.puzzle) return [];
  const out = [];
  match.claims.forEach((by, i) => {
    if (by === null) return;
    const d = match.puzzle.diffs[i];
    out.push({ index: i, by, cx: d.cx, cy: d.cy, r: d.r, kind: d.kind });
  });
  return out;
}

function baseView(match, now) {
  return {
    phase: match.phase,
    difficulty: match.difficulty,
    diffs: match.diffs,
    countdownSeconds: match.countdownSeconds,
    timeLimitSeconds: match.timeLimitSeconds,
    startAt: match.startAt,
    endsAt: match.endsAt,
    now,
    gameNo: match.gameNo,
    winner: match.winner,
    overReason: match.overReason,
    puzzle: match.puzzle ? S.publicPuzzle(match.puzzle) : null,
    found: foundList(match),
    seats: match.players.map((p) => ({
      pid: p.pid,
      name: p.name,
      joined: p.joined,
      present: p.present,
      rematch: p.rematch,
      found: p.found,
      misses: p.misses,
      lockedUntil: p.lockedUntil,
      wins: winsOf(match, p.pid),
    })),
    history: match.history.map(({ pids, ...h }) => h),
  };
}

export function viewFor(match, index, now = Date.now()) {
  return { role: 'player', you: index, ...baseView(match, now) };
}

export function viewForSpectator(match, now = Date.now()) {
  return { role: 'spectator', you: null, ...baseView(match, now) };
}
