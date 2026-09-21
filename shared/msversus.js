/**
 * 지뢰찾기 1:1 대전의 상태머신.
 *
 * 두 사람이 각자 자기 판을 동시에 풀고, 먼저 다 여는 쪽이 이긴다. 지뢰를 밟으면 그 자리에서 진다.
 * 판은 서로 다르다 — 같은 판이면 상대 화면을 보는 것만으로 안전한 칸이 새기 때문이다.
 * 시작할 때 서버가 각 판의 출발 지점을 하나 열어 준다(첫 클릭 안전과 같은 효과).
 *
 * 순수 로직만 담는다 — 소켓도 타이머도 모른다. 시간은 항상 인자로 받는다.
 */
import * as M from './minesweeper.js';

export const Phase = {
  LOBBY: 'lobby',           // 상대를 기다리는 중
  COUNTDOWN: 'countdown',   // 판은 만들어졌고 출발 신호를 기다리는 중
  PLAYING: 'playing',
  OVER: 'over',
};

export const DEFAULT_COUNTDOWN_SECONDS = 3;
export const MAX_COUNTDOWN_SECONDS = 10;

function fail(error) {
  return { ok: false, error };
}

function mkPlayer() {
  return { name: '', joined: false, present: false, game: null, rematch: false };
}

/** 판 크기·지뢰 수는 지뢰찾기 규칙을 따르되, 출발 지점을 연 뒤에도 최소 한 칸은 남게 한다. */
export function normalizeOptions(opts = {}) {
  const board = M.normalizeOptions(opts);
  const maxMines = board.rows * board.cols - M.SAFE_ZONE - 1;
  const mines = Math.min(board.mines, maxMines);
  const raw = Number(opts.countdownSeconds);
  const countdownSeconds = Number.isFinite(raw)
    ? Math.min(MAX_COUNTDOWN_SECONDS, Math.max(0, Math.trunc(raw)))
    : DEFAULT_COUNTDOWN_SECONDS;
  return { rows: board.rows, cols: board.cols, mines, countdownSeconds };
}

export function createGame(opts = {}, rand = Math.random) {
  return {
    ...normalizeOptions(opts),
    phase: Phase.LOBBY,
    startAt: null,        // 출발 시각 (카운트다운이 끝나는 때)
    winner: null,         // 0 | 1
    overReason: null,     // 'clear' | 'mine' | 'forfeit'
    gameNo: 1,
    players: [mkPlayer(), mkPlayer()],
    rand,
  };
}

/**
 * 대전용 새 판 — 출발 지점을 하나 골라 미리 연다. 시계는 출발 신호부터 흐른다.
 * 가장자리를 피해서 고르므로 출발 지점은 언제나 주변 8칸까지 함께 열린다.
 */
function newBoard(match, startAt) {
  const game = M.createGame(match, match.rand);
  const row = 1 + Math.floor(match.rand() * (game.rows - 2));
  const col = 1 + Math.floor(match.rand() * (game.cols - 2));
  M.reveal(game, M.index(game, row, col), startAt);
  game.startedAt = startAt;
  return game;
}

function beginRound(match, now) {
  match.phase = Phase.COUNTDOWN;
  match.startAt = now + match.countdownSeconds * 1000;
  match.winner = null;
  match.overReason = null;
  for (const p of match.players) {
    p.game = newBoard(match, match.startAt);
    p.rematch = false;
  }
  tick(match, now);
}

function finish(match, winner, reason, now) {
  match.phase = Phase.OVER;
  match.winner = winner;
  match.overReason = reason;
  // 아직 풀고 있던 판의 시계를 멈춘다
  for (const p of match.players) {
    if (p.game && p.game.endedAt === null) p.game.endedAt = now;
  }
}

/** 자리에 앉는다. 둘 다 앉으면 바로 카운트다운. */
export function seatPlayer(match, index, name, now = Date.now()) {
  const p = match.players[index];
  p.joined = true;
  p.present = true;
  p.name = (name || '').trim().slice(0, 16) || (index === 0 ? '플레이어 1' : '플레이어 2');
  if (match.phase === Phase.LOBBY && match.players.every((x) => x.joined)) beginRound(match, now);
  return { ok: true };
}

export function setPresence(match, index, present) {
  match.players[index].present = present;
}

/** 카운트다운이 끝났으면 출발. 바뀐 게 있으면 true. */
export function tick(match, now = Date.now()) {
  if (match.phase !== Phase.COUNTDOWN || now < match.startAt) return false;
  match.phase = Phase.PLAYING;
  return true;
}

/**
 * 내 판을 조작한다. action 은 'reveal' | 'mark' | 'chord'.
 * 지뢰를 밟으면 상대 승리, 다 열면 내 승리.
 */
export function act(match, index, action, i, now = Date.now(), { question = false } = {}) {
  tick(match, now);
  if (match.phase !== Phase.PLAYING) return fail('not_playing');
  const game = match.players[index].game;
  let out;
  if (action === 'reveal') out = M.reveal(game, i, now);
  else if (action === 'mark') out = M.toggleMark(game, i, { question });
  else if (action === 'chord') out = M.chord(game, i, now);
  else return fail('bad_action');
  if (!out.ok) return out;
  if (game.phase === M.Phase.LOST) finish(match, 1 - index, 'mine', now);
  else if (game.phase === M.Phase.WON) finish(match, index, 'clear', now);
  return { ok: true };
}

export function forfeit(match, index, reason = 'forfeit', now = Date.now()) {
  if (match.phase === Phase.OVER) return fail('already_over');
  if (match.phase === Phase.LOBBY) return fail('not_playing');
  finish(match, 1 - index, reason, now);
  return { ok: true };
}

export function requestRematch(match, index, now = Date.now()) {
  if (match.phase !== Phase.OVER) return fail('not_over');
  match.players[index].rematch = true;
  if (match.players.every((p) => p.rematch)) {
    match.gameNo++;
    beginRound(match, now);
  }
  return { ok: true };
}

/** 방 관리가 보는 굵은 상태. 카운트다운은 진행 중으로 친다 (끊기면 유예를 준다). */
export function status(match) {
  if (match.phase === Phase.LOBBY) return 'lobby';
  if (match.phase === Phase.OVER) return 'over';
  return 'playing';
}

function snapshot(p, { own }) {
  const g = p.game;
  if (!g) return {};
  return {
    board: M.encodeBoard(g),
    layout: own ? M.encodeLayout(g) : null,   // 내 판의 지뢰 위치는 나만 안다
    boardPhase: g.phase,
    opened: g.opened,
    flags: g.flags,
    startedAt: g.startedAt,
    endedAt: g.endedAt,
  };
}

/** index 번 플레이어에게 보여줄 상태. 상대 판은 열린 칸과 깃발만 보인다. */
export function viewFor(match, index, now = Date.now()) {
  const me = match.players[index];
  const other = match.players[1 - index];
  return {
    phase: match.phase,
    rows: match.rows,
    cols: match.cols,
    mines: match.mines,
    total: match.rows * match.cols - match.mines,   // 열어야 하는 칸 수
    countdownSeconds: match.countdownSeconds,
    startAt: match.startAt,
    now,                                            // 서버 시계 — 브라우저가 시차를 보정한다
    you: index,
    gameNo: match.gameNo,
    winner: match.winner === null ? null : match.winner === index ? 'you' : 'opponent',
    overReason: match.overReason,
    me: { name: me.name, present: me.present, rematch: me.rematch, ...snapshot(me, { own: true }) },
    opponent: {
      name: other.name,
      joined: other.joined,
      present: other.present,
      rematch: other.rematch,
      ...snapshot(other, { own: false }),
    },
  };
}
