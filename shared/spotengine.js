/**
 * 틀린그림찾기 상태머신.
 *
 * 숫자야구의 engine.js 와 같은 방식 — 순수 로직만 담고, 시간은 항상 인자로 받는다.
 * 온라인 대전(서버)과 혼자 하기(브라우저)가 이 파일을 그대로 함께 쓴다.
 *
 * 대전 규칙: 같은 그림을 둘이 동시에 보고, 먼저 누른 사람이 그 자리를 가져간다.
 * 다 찾거나 남은 개수로 역전이 불가능해지면 바로 끝. 시간이 끝나면 많이 찾은 쪽이 승리.
 */
import { LEVELS, DEFAULT_LEVEL, SCENE_W, SCENE_H, generatePuzzle, hitTest } from './spotdiff.js';

export const SpotPhase = {
  LOBBY: 'lobby',         // 상대를 기다리는 중
  COUNTDOWN: 'countdown', // 3, 2, 1
  PLAYING: 'playing',
  OVER: 'over',
};

export const COUNTDOWN_SECONDS = 3;
export const MISS_LOCK_MS = 1500;       // 틀린 곳을 누르면 잠시 못 누른다
export const HINT_PENALTY_SECONDS = 10; // 혼자 하기에서 힌트 값
export const HINT_SHOW_MS = 2500;

function mkPlayer(name = '') {
  return {
    name,
    joined: false,
    present: false,
    found: 0,
    misses: 0,
    lockUntil: 0,
    lastMiss: null,
    hints: 0,
    rematch: false,
  };
}

function fail(code) {
  return { ok: false, error: code };
}

export function normalizeSpotOptions(opts = {}) {
  const level = LEVELS[opts.level] ? opts.level : DEFAULT_LEVEL;
  return { level };
}

function randomSeed() {
  return Math.floor(Math.random() * 0x100000000) >>> 0;
}

/**
 * @param {{level?:string, solo?:boolean, seed?:number}} opts
 *   seed 는 테스트용 — 첫 판 그림을 고정한다. 그 뒤 판은 무작위.
 */
export function createSpotGame(opts = {}) {
  const { level } = normalizeSpotOptions(opts);
  const solo = !!opts.solo;
  return {
    level,
    solo,
    phase: SpotPhase.LOBBY,
    deadline: null,
    startedAt: null,
    endedAt: null,
    puzzle: null,
    found: [],          // { id, by, at }
    hint: null,         // 혼자 하기 전용 { x, y, r, until }
    winner: null,       // 0 | 1 | 'draw' | null
    overReason: null,   // 'found' | 'time' | 'forfeit' | 'cleared'
    players: solo ? [mkPlayer()] : [mkPlayer(), mkPlayer()],
    gameNo: 1,
    nextSeed: Number.isInteger(opts.seed) ? opts.seed >>> 0 : null,
  };
}

function beginCountdown(game, now) {
  const seed = game.nextSeed ?? randomSeed();
  game.nextSeed = null;
  const puzzle = generatePuzzle(seed, game.level);
  puzzle.id = `${game.gameNo}-${Math.random().toString(36).slice(2, 8)}`;
  game.puzzle = puzzle;
  game.found = [];
  game.hint = null;
  game.phase = SpotPhase.COUNTDOWN;
  game.deadline = now + COUNTDOWN_SECONDS * 1000;
}

function beginPlaying(game, now) {
  game.phase = SpotPhase.PLAYING;
  game.startedAt = now;
  game.deadline = now + LEVELS[game.level].seconds * 1000;
}

function finish(game, winner, reason, now) {
  game.phase = SpotPhase.OVER;
  game.winner = winner;
  game.overReason = reason;
  game.deadline = null;
  game.endedAt = now;
  game.hint = null;
}

function finishByScore(game, reason, now) {
  if (game.solo) {
    finish(game, null, reason, now);
    return;
  }
  const [a, b] = game.players.map((p) => p.found);
  finish(game, a > b ? 0 : b > a ? 1 : 'draw', reason, now);
}

/** 찾은 뒤 승부가 났는지 본다. */
function checkEnd(game, now) {
  const remaining = game.puzzle.diffs.length - game.found.length;
  if (game.solo) {
    if (remaining === 0) finish(game, 0, 'cleared', now);
    return;
  }
  const [a, b] = game.players.map((p) => p.found);
  if (remaining === 0 || Math.abs(a - b) > remaining) finishByScore(game, 'found', now);
}

export function seatSpotPlayer(game, index, name, now = Date.now()) {
  const p = game.players[index];
  p.joined = true;
  p.present = true;
  p.name = (name || '').trim().slice(0, 16) || (index === 0 ? '플레이어 1' : '플레이어 2');
  if (game.phase === SpotPhase.LOBBY && game.players.every((x) => x.joined)) beginCountdown(game, now);
  return { ok: true };
}

export function setSpotPresence(game, index, present) {
  game.players[index].present = present;
}

/** 시간 경과를 반영한다. 자주 불러도 안전하다. 바뀐 게 있으면 true. */
export function spotTick(game, now = Date.now()) {
  let changed = false;
  if (game.hint && now >= game.hint.until) {
    game.hint = null;
    changed = true;
  }
  if (!game.deadline || now < game.deadline) return changed;
  if (game.phase === SpotPhase.COUNTDOWN) {
    beginPlaying(game, game.deadline);
    return true;
  }
  if (game.phase === SpotPhase.PLAYING) {
    finishByScore(game, 'time', now);
    return true;
  }
  return changed;
}

/**
 * 그림의 한 점을 누른다.
 * @returns {{ok:true, hit:number|null, already?:boolean} | {ok:false, error:string}}
 */
export function tap(game, index, x, y, now = Date.now()) {
  spotTick(game, now); // 서버 틱보다 먼저 도착한 입력도 제 단계에서 처리되도록
  if (game.phase !== SpotPhase.PLAYING) return fail('not_playing');
  x = Number(x);
  y = Number(y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0 || x > SCENE_W || y > SCENE_H) return fail('bad_tap');

  const p = game.players[index];
  if (now < p.lockUntil) return fail('locked');

  const d = hitTest(game.puzzle.diffs, x, y);
  if (d) {
    if (game.found.some((f) => f.id === d.id)) return { ok: true, hit: null, already: true };
    game.found.push({ id: d.id, by: index, at: now });
    p.found++;
    checkEnd(game, now);
    return { ok: true, hit: d.id };
  }

  p.misses++;
  p.lockUntil = now + MISS_LOCK_MS;
  p.lastMiss = { x, y, at: now };
  return { ok: true, hit: null };
}

/** 혼자 하기 전용 — 아직 못 찾은 곳 하나를 잠깐 보여주고 시간을 깎는다. */
export function useHint(game, index, now = Date.now(), rand = Math.random) {
  spotTick(game, now);
  if (!game.solo) return fail('not_solo');
  if (game.phase !== SpotPhase.PLAYING) return fail('not_playing');
  if (game.hint) return fail('hint_active');
  const left = game.puzzle.diffs.filter((d) => !game.found.some((f) => f.id === d.id));
  if (!left.length) return fail('nothing_left');
  const d = left[Math.floor(rand() * left.length)];
  game.hint = { x: d.x, y: d.y, r: Math.max(34, d.r * 1.6), until: now + HINT_SHOW_MS };
  game.deadline = Math.max(now + 1000, game.deadline - HINT_PENALTY_SECONDS * 1000);
  game.players[index].hints++;
  return { ok: true };
}

export function spotForfeit(game, index, reason = 'forfeit') {
  if (game.phase === SpotPhase.OVER) return fail('already_over');
  finish(game, game.solo ? null : 1 - index, reason, Date.now());
  return { ok: true };
}

export function requestSpotRematch(game, index, now = Date.now()) {
  if (game.phase !== SpotPhase.OVER) return fail('not_over');
  game.players[index].rematch = true;
  if (game.players.every((p) => p.rematch)) resetSpotForRematch(game, now);
  return { ok: true };
}

export function resetSpotForRematch(game, now = Date.now()) {
  game.gameNo++;
  game.winner = null;
  game.overReason = null;
  game.startedAt = null;
  game.endedAt = null;
  game.players.forEach((p) => {
    p.found = 0;
    p.misses = 0;
    p.lockUntil = 0;
    p.lastMiss = null;
    p.hints = 0;
    p.rematch = false;
  });
  beginCountdown(game, now);
}

function playerView(p) {
  return {
    name: p.name,
    joined: p.joined,
    present: p.present,
    found: p.found,
    misses: p.misses,
    rematch: p.rematch,
  };
}

/**
 * index 번 플레이어에게 보여줄 상태.
 * 정답 위치는 게임이 끝나기 전엔 절대 담지 않는다 — 찾은 곳만 보낸다.
 */
export function spotViewFor(game, index) {
  const me = game.players[index];
  const other = game.solo ? null : game.players[1 - index];
  const over = game.phase === SpotPhase.OVER;
  const level = LEVELS[game.level];
  const puzzle = game.puzzle;
  const byId = new Map((puzzle?.diffs ?? []).map((d) => [d.id, d]));
  return {
    game: 'spot',
    phase: game.phase,
    level: game.level,
    levelLabel: level.label,
    total: puzzle ? puzzle.diffs.length : level.diffs,
    seconds: level.seconds,
    deadline: game.deadline,
    timeTotal: (game.phase === SpotPhase.COUNTDOWN ? COUNTDOWN_SECONDS : level.seconds) * 1000,
    startedAt: game.startedAt,
    endedAt: game.endedAt,
    gameNo: game.gameNo,
    solo: game.solo,
    you: index,
    puzzle: puzzle ? { id: puzzle.id, theme: puzzle.theme, bg: puzzle.bg, left: puzzle.left, right: puzzle.right } : null,
    found: game.found.map((f) => {
      const d = byId.get(f.id);
      return { id: f.id, x: d.x, y: d.y, r: d.r, by: f.by === index ? 'you' : 'opponent', at: f.at };
    }),
    answers: over && puzzle ? puzzle.diffs.map((d) => ({ ...d, found: game.found.some((f) => f.id === d.id) })) : null,
    hint: game.hint,
    winner: game.winner === 'draw' ? 'draw' : game.winner === null ? null : game.winner === index ? 'you' : 'opponent',
    overReason: game.overReason,
    me: { ...playerView(me), lockUntil: me.lockUntil, lastMiss: me.lastMiss, hints: me.hints },
    opponent: other ? playerView(other) : null,
  };
}
