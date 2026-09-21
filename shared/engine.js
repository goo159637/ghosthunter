/**
 * 1:1 숫자야구 대전의 상태머신.
 *
 * 순수 로직만 담는다 — 소켓도, 타이머도 모른다. 시간은 항상 인자로 받는다.
 * 덕분에 서버(온라인 대전)와 브라우저(AI 연습)가 같은 규칙을 공유한다.
 */
import { MIN_DIGITS, MAX_DIGITS, isValidNumber, judge, randomNumber } from './baseball.js';

export const Phase = {
  LOBBY: 'lobby',     // 상대를 기다리는 중
  SETUP: 'setup',     // 둘 다 비밀번호를 정하는 중
  PLAYING: 'playing', // 번갈아 공격
  OVER: 'over',       // 종료
};

export const SETUP_SECONDS = 90;
export const MAX_MISSES = 3;        // 연속 시간초과 3번이면 기권 처리
export const DEFAULT_TURN_SECONDS = 60;
export const TURN_SECONDS_CHOICES = [0, 30, 60, 120]; // 0 = 무제한

const LOG_LIMIT = 60;

function mkPlayer(name = '') {
  return {
    name,
    joined: false,
    present: false,
    secret: null,
    ready: false,
    guesses: [],
    misses: 0,
    rematch: false,
  };
}

function fail(code) {
  return { ok: false, error: code };
}

/** 옵션을 안전한 범위로 정리한다. */
export function normalizeOptions(opts = {}) {
  const digits = Math.min(MAX_DIGITS, Math.max(MIN_DIGITS, Number(opts.digits) || MIN_DIGITS));
  const raw = opts.turnSeconds === undefined ? DEFAULT_TURN_SECONDS : Number(opts.turnSeconds);
  const turnSeconds = TURN_SECONDS_CHOICES.includes(raw) ? raw : DEFAULT_TURN_SECONDS;
  return { digits, turnSeconds };
}

export function createGame(opts = {}) {
  const { digits, turnSeconds } = normalizeOptions(opts);
  return {
    digits,
    turnSeconds,
    phase: Phase.LOBBY,
    firstMover: opts.firstMover === 1 ? 1 : 0,
    turn: opts.firstMover === 1 ? 1 : 0,
    round: 0,
    deadline: null,
    lastChance: null,   // 선공이 먼저 맞혔을 때, 후공에게 남은 마지막 공격권
    winner: null,       // 0 | 1 | 'draw'
    overReason: null,   // 'strikes' | 'timeout' | 'forfeit'
    players: [mkPlayer(), mkPlayer()],
    log: [],
    gameNo: 1,
  };
}

function push(game, type, data = {}) {
  game.log.push({ type, ...data });
  if (game.log.length > LOG_LIMIT) game.log.splice(0, game.log.length - LOG_LIMIT);
}

function turnDeadline(game, now) {
  return game.turnSeconds ? now + game.turnSeconds * 1000 : null;
}

function beginSetup(game, now) {
  game.phase = Phase.SETUP;
  game.deadline = game.turnSeconds ? now + SETUP_SECONDS * 1000 : null;
  push(game, 'setup_started');
}

function beginPlaying(game, now) {
  game.phase = Phase.PLAYING;
  game.turn = game.firstMover;
  game.round = 1;
  game.lastChance = null;
  game.deadline = turnDeadline(game, now);
  push(game, 'play_started', { firstMover: game.firstMover });
}

function finish(game, winner, reason) {
  game.phase = Phase.OVER;
  game.winner = winner;
  game.overReason = reason;
  game.deadline = null;
  push(game, 'game_over', { winner, reason });
}

/** 후공이 한 라운드를 끝낸 뒤 호출. 선공이 이미 맞혔다면 여기서 승부가 난다. */
function endOfRoundCheck(game, actor) {
  if (game.lastChance === null) return false;
  if (actor === game.firstMover) return false;
  finish(game, game.lastChance, 'strikes');
  return true;
}

function advanceTurn(game, now) {
  game.turn = 1 - game.turn;
  if (game.turn === game.firstMover) game.round++;
  game.deadline = turnDeadline(game, now);
}

/** 자리에 앉는다. 둘 다 앉으면 비밀번호 설정 단계로. */
export function seatPlayer(game, index, name, now = Date.now()) {
  const p = game.players[index];
  p.joined = true;
  p.present = true;
  p.name = (name || '').trim().slice(0, 16) || (index === 0 ? '플레이어 1' : '플레이어 2');
  push(game, 'joined', { player: index, name: p.name });
  if (game.phase === Phase.LOBBY && game.players.every((x) => x.joined)) {
    beginSetup(game, now);
  }
  return { ok: true };
}

export function setPresence(game, index, present) {
  game.players[index].present = present;
  push(game, present ? 'reconnected' : 'disconnected', { player: index });
}

export function submitSecret(game, index, value, now = Date.now()) {
  if (game.phase !== Phase.SETUP) return fail('not_setup_phase');
  if (!isValidNumber(value, game.digits)) return fail('invalid_number');
  const p = game.players[index];
  p.secret = value;
  p.ready = true;
  push(game, 'ready', { player: index });
  if (game.players.every((x) => x.ready)) beginPlaying(game, now);
  return { ok: true };
}

export function makeGuess(game, index, value, now = Date.now()) {
  if (game.phase !== Phase.PLAYING) return fail('not_playing');
  if (game.turn !== index) return fail('not_your_turn');
  if (!isValidNumber(value, game.digits)) return fail('invalid_number');

  const me = game.players[index];
  if (me.guesses.some((g) => g.value === value)) return fail('duplicate_guess');

  const target = game.players[1 - index].secret;
  const verdict = judge(target, value);
  const entry = { value, ...verdict, round: game.round, at: now };
  me.guesses.push(entry);
  me.misses = 0;
  push(game, 'guess', { player: index, ...entry });

  if (verdict.strikes === game.digits) {
    if (game.lastChance !== null) {
      finish(game, 'draw', 'strikes');         // 후공도 맞혔다 → 무승부
    } else if (index === game.firstMover) {
      game.lastChance = index;                  // 후공에게 마지막 공격권
      push(game, 'last_chance', { player: 1 - index });
      advanceTurn(game, now);
    } else {
      finish(game, index, 'strikes');
    }
    return { ok: true, result: entry };
  }

  if (!endOfRoundCheck(game, index)) advanceTurn(game, now);
  return { ok: true, result: entry };
}

/** 제한시간 경과를 반영한다. 매 초 호출해도 안전하다. */
export function tick(game, now = Date.now()) {
  if (!game.deadline || now < game.deadline) return false;

  if (game.phase === Phase.SETUP) {
    game.players.forEach((p, i) => {
      if (p.ready) return;
      p.secret = randomNumber(game.digits);
      p.ready = true;
      push(game, 'auto_secret', { player: i });
    });
    beginPlaying(game, now);
    return true;
  }

  if (game.phase === Phase.PLAYING) {
    const i = game.turn;
    const p = game.players[i];
    p.guesses.push({ value: null, strikes: 0, balls: 0, out: false, timeout: true, round: game.round, at: now });
    p.misses++;
    push(game, 'timeout', { player: i, misses: p.misses });
    if (p.misses >= MAX_MISSES) {
      finish(game, 1 - i, 'timeout');
    } else if (!endOfRoundCheck(game, i)) {
      advanceTurn(game, now);
    }
    return true;
  }

  return false;
}

export function forfeit(game, index, reason = 'forfeit') {
  if (game.phase === Phase.OVER) return { ok: false, error: 'already_over' };
  finish(game, 1 - index, reason);
  return { ok: true };
}

export function requestRematch(game, index, now = Date.now()) {
  if (game.phase !== Phase.OVER) return fail('not_over');
  game.players[index].rematch = true;
  push(game, 'rematch_request', { player: index });
  if (game.players.every((p) => p.rematch)) resetForRematch(game, now);
  return { ok: true };
}

export function resetForRematch(game, now = Date.now()) {
  game.firstMover = 1 - game.firstMover;   // 선공을 번갈아 — 선공 이점을 상쇄
  game.gameNo++;
  game.winner = null;
  game.overReason = null;
  game.lastChance = null;
  game.round = 0;
  game.log = [];
  game.players.forEach((p) => {
    p.secret = null;
    p.ready = false;
    p.guesses = [];
    p.misses = 0;
    p.rematch = false;
  });
  beginSetup(game, now);
}

/** 방 관리가 보는 굵은 상태: 'lobby' | 'playing' | 'over'. 비밀번호 설정 중도 진행 중으로 친다. */
export function status(game) {
  if (game.phase === Phase.LOBBY) return 'lobby';
  if (game.phase === Phase.OVER) return 'over';
  return 'playing';
}

/** index 번 플레이어에게 보여줄 상태. 상대 비밀번호는 게임이 끝나기 전엔 절대 담지 않는다. */
export function viewFor(game, index) {
  const me = game.players[index];
  const other = game.players[1 - index];
  const over = game.phase === Phase.OVER;
  return {
    phase: game.phase,
    digits: game.digits,
    turnSeconds: game.turnSeconds,
    round: game.round,
    turn: game.turn,
    you: index,
    firstMover: game.firstMover,
    deadline: game.deadline,
    yourTurn: game.phase === Phase.PLAYING && game.turn === index,
    lastChanceFor: game.lastChance === null ? null : 1 - game.lastChance,
    gameNo: game.gameNo,
    winner: game.winner === 'draw' ? 'draw' : game.winner === null ? null : game.winner === index ? 'you' : 'opponent',
    overReason: game.overReason,
    me: {
      name: me.name,
      ready: me.ready,
      secret: me.secret,
      guesses: me.guesses,
      misses: me.misses,
      rematch: me.rematch,
    },
    opponent: {
      name: other.name,
      joined: other.joined,
      present: other.present,
      ready: other.ready,
      guesses: other.guesses,
      misses: other.misses,
      rematch: other.rematch,
      secret: over ? other.secret : null,
    },
    log: game.log,
  };
}
