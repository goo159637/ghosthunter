/**
 * 지뢰찾기 1:1 대전의 상태머신.
 *
 * 두 사람이 각자 자기 판을 동시에 풀고 점수로 승부한다.
 *   점수 = 연 칸 × CELL_POINTS − 걸린 초 × SECOND_PENALTY
 *          + (다 열면 칸 수 × CLEAR_BONUS) − (지뢰를 밟으면 칸 수 × MINE_PENALTY)
 * 지뢰를 밟으면 내 판만 끝나고, 라운드는 상대가 다 열거나 지뢰를 밟을 때까지 이어진다.
 * 누가 다 열면 그 순간 라운드가 끝난다 (먼저 다 여는 게 유리하다).
 *
 * 판은 서로 다르다 — 같은 판이면 상대 화면을 보는 것만으로 안전한 칸이 새기 때문이다.
 * 시작할 때 서버가 각 판의 출발 지점을 하나 열어 준다(첫 클릭 안전과 같은 효과).
 *
 * 자리(0/1)와 사람(pid)은 다르다. 관전자가 자리를 넘겨받을 수 있으므로
 * 승수는 자리가 아니라 사람에게 붙는다 (history 의 pids 로 센다).
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
const HISTORY_LIMIT = 30;   // 방 안에서 이어 한 판들의 기록

/* ───────── 점수 ───────── */

export const CELL_POINTS = 10;     // 연 칸 하나
export const SECOND_PENALTY = 1;   // 걸린 1초마다
export const CLEAR_BONUS = 5;      // 다 열면 칸 수 × 이만큼
export const MINE_PENALTY = 2;     // 지뢰를 밟으면 칸 수 × 이만큼

/** 한 사람의 점수 내역. total 은 열어야 하는 칸 수(판 크기 − 지뢰). */
export function scoreOf({ opened, total, seconds, cleared, exploded }) {
  const cells = opened * CELL_POINTS;
  const time = Math.floor(Math.max(0, seconds)) * SECOND_PENALTY;
  const clear = cleared ? total * CLEAR_BONUS : 0;
  const mine = exploded ? total * MINE_PENALTY : 0;
  return { cells, time, clear, mine, total: Math.max(0, cells - time + clear - mine) };
}

/** 판 하나의 지금 점수. 판이 끝났으면 끝난 시각까지, 아니면 now 까지 센다. */
export function scoreOfGame(game, total, now) {
  if (!game) return scoreOf({ opened: 0, total, seconds: 0, cleared: false, exploded: false });
  return scoreOf({
    opened: game.opened,
    total,
    seconds: M.elapsedMs(game, now) / 1000,
    cleared: game.phase === M.Phase.WON,
    exploded: game.phase === M.Phase.LOST,
  });
}

/* ───────── 상태 ───────── */

function fail(error) {
  return { ok: false, error };
}

function mkPlayer() {
  return { pid: null, name: '', joined: false, present: false, game: null, rematch: false };
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
  const o = normalizeOptions(opts);
  return {
    ...o,
    total: o.rows * o.cols - o.mines,   // 열어야 하는 칸 수
    phase: Phase.LOBBY,
    startAt: null,        // 출발 시각 (카운트다운이 끝나는 때)
    winner: null,         // 0 | 1 | 'draw'
    overReason: null,     // 'points' | 'forfeit'
    gameNo: 1,
    history: [],          // 끝난 판들 — 아래 finish() 참고
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
  match.gameNo = match.history.length + 1;   // 재대결이든 교대 뒤든, 끝난 판 다음 번호
  match.startAt = now + match.countdownSeconds * 1000;
  match.winner = null;
  match.overReason = null;
  for (const p of match.players) {
    p.game = newBoard(match, match.startAt);
    p.rematch = false;
  }
  tick(match, now);
}

function outcomeOf(game) {
  if (game.phase === M.Phase.WON) return 'clear';
  if (game.phase === M.Phase.LOST) return 'mine';
  return 'stopped';   // 상대가 먼저 다 열어서, 또는 기권으로 멈춤
}

/**
 * 라운드를 끝낸다. forcedWinner 가 없으면 점수가 높은 쪽이 이긴다 (같으면 무승부).
 * 아직 풀고 있던 판은 여기서 시계를 멈추고 'stopped' 로 남는다.
 */
function finish(match, now, { forcedWinner = null, reason = 'points' } = {}) {
  for (const p of match.players) {
    if (p.game.endedAt === null) p.game.endedAt = now;
  }
  const points = match.players.map((p) => scoreOfGame(p.game, match.total, now).total);
  let winner = forcedWinner;
  if (winner === null) {
    if (points[0] > points[1]) winner = 0;
    else if (points[1] > points[0]) winner = 1;
    else winner = 'draw';
  }
  match.phase = Phase.OVER;
  match.winner = winner;
  match.overReason = reason;
  match.history.push({
    gameNo: match.gameNo,
    winner,
    reason,
    points,
    opened: match.players.map((p) => p.game.opened),
    outcome: match.players.map((p) => outcomeOf(p.game)),
    ms: Math.max(0, now - match.startAt),   // 카운트다운 중 기권이면 0
    names: match.players.map((p) => p.name),
    pids: match.players.map((p) => p.pid),  // 승수는 사람에게 붙는다 — 브라우저엔 보내지 않는다
  });
  if (match.history.length > HISTORY_LIMIT) match.history.shift();
}

/** 조작 뒤 라운드가 끝났는지 본다: 누가 다 열었거나, 둘 다 판이 끝났으면. */
function settle(match, now) {
  const games = match.players.map((p) => p.game);
  if (games.some((g) => g.phase === M.Phase.WON)) return finish(match, now);
  if (games.every((g) => M.isOver(g))) return finish(match, now);
  return false;
}

/* ───────── 자리 ───────── */

/** 자리에 앉는다. 둘 다 앉으면 바로 카운트다운. pid 는 사람을 구분하는 공개 id. */
export function seatPlayer(match, index, name, now = Date.now(), pid = null) {
  if (match.phase === Phase.COUNTDOWN || match.phase === Phase.PLAYING) return fail('in_progress');
  const p = match.players[index];
  p.pid = pid ?? `seat${index}`;
  p.joined = true;
  p.present = true;
  p.rematch = false;
  p.name = (name || '').trim().slice(0, 16) || (index === 0 ? '플레이어 1' : '플레이어 2');
  if (match.phase === Phase.OVER) match.phase = Phase.LOBBY;   // 새 사람이 앉았으니 지난 판은 정리
  if (match.phase === Phase.LOBBY && match.players.every((x) => x.joined)) beginRound(match, now);
  return { ok: true };
}

/** 자리를 비운다 (관전으로 빠지기 / 교대). 진행 중엔 안 된다 — 먼저 기권해야 한다. */
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

/** 카운트다운이 끝났으면 출발. 바뀐 게 있으면 true. */
export function tick(match, now = Date.now()) {
  if (match.phase !== Phase.COUNTDOWN || now < match.startAt) return false;
  match.phase = Phase.PLAYING;
  return true;
}

/* ───────── 조작 ───────── */

/**
 * 내 판을 조작한다. action 은 'reveal' | 'mark' | 'chord'.
 * 내 판이 이미 끝났으면(지뢰) 거절. 라운드가 끝나는지는 settle 이 본다.
 */
export function act(match, index, action, i, now = Date.now(), { question = false } = {}) {
  tick(match, now);
  if (match.phase !== Phase.PLAYING) return fail('not_playing');
  const game = match.players[index].game;
  if (M.isOver(game)) return fail('board_over');
  let out;
  if (action === 'reveal') out = M.reveal(game, i, now);
  else if (action === 'mark') out = M.toggleMark(game, i, { question });
  else if (action === 'chord') out = M.chord(game, i, now);
  else return fail('bad_action');
  if (!out.ok) return out;
  settle(match, now);
  return { ok: true };
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

/** 방 관리가 보는 굵은 상태. 카운트다운은 진행 중으로 친다 (끊기면 유예를 준다). */
export function status(match) {
  if (match.phase === Phase.LOBBY) return 'lobby';
  if (match.phase === Phase.OVER) return 'over';
  return 'playing';
}

/* ───────── 보기 ───────── */

/** 이 사람이 이 방에서 이긴 판 수. */
export function winsOf(match, pid) {
  if (!pid) return 0;
  let n = 0;
  for (const h of match.history) if (h.winner !== 'draw' && h.pids[h.winner] === pid) n++;
  return n;
}

function seatView(match, p, { own }, now) {
  const g = p.game;
  const base = {
    pid: p.pid,
    name: p.name,
    joined: p.joined,
    present: p.present,
    rematch: p.rematch,
    wins: winsOf(match, p.pid),
  };
  if (!g) return base;
  return {
    ...base,
    board: M.encodeBoard(g),
    layout: own ? M.encodeLayout(g) : null,   // 내 판의 지뢰 위치는 나만 안다
    boardPhase: g.phase,
    opened: g.opened,
    flags: g.flags,
    startedAt: g.startedAt,
    endedAt: g.endedAt,
    points: scoreOfGame(g, match.total, now),
  };
}

function publicHistory(match) {
  return match.history.map(({ pids, ...h }) => h);   // pids 는 서버 안에서만
}

/**
 * 자리에 앉은 사람(index)에게 보여줄 상태. you 가 내 자리 번호.
 * 상대 판은 열린 칸과 깃발만 보인다.
 */
export function viewFor(match, index, now = Date.now()) {
  return {
    role: 'player',
    you: index,
    phase: match.phase,
    rows: match.rows,
    cols: match.cols,
    mines: match.mines,
    total: match.total,
    countdownSeconds: match.countdownSeconds,
    startAt: match.startAt,
    now,                                            // 서버 시계 — 브라우저가 시차를 보정한다
    gameNo: match.gameNo,
    winner: match.winner,                           // 0 | 1 | 'draw' | null
    overReason: match.overReason,
    seats: match.players.map((p, i) => seatView(match, p, { own: i === index }, now)),
    history: publicHistory(match),
  };
}

/** 관전자에게 보여줄 상태 — 두 판 모두 열린 칸과 깃발만. */
export function viewForSpectator(match, now = Date.now()) {
  return {
    role: 'spectator',
    you: null,
    phase: match.phase,
    rows: match.rows,
    cols: match.cols,
    mines: match.mines,
    total: match.total,
    countdownSeconds: match.countdownSeconds,
    startAt: match.startAt,
    now,
    gameNo: match.gameNo,
    winner: match.winner,
    overReason: match.overReason,
    seats: match.players.map((p) => seatView(match, p, { own: false }, now)),
    history: publicHistory(match),
  };
}
