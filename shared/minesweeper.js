/**
 * 지뢰찾기 핵심 규칙.
 * 의존성 없는 순수 모듈. 화면 코드는 여기 상태를 읽기만 하고,
 * 상태를 바꿀 때는 반드시 아래 함수(reveal / toggleMark / chord)를 거친다.
 *
 * 판은 1차원 배열로 들고, 칸 번호 i = row * cols + col 이다.
 */

export const PRESETS = {
  easy: { rows: 9, cols: 9, mines: 10 },
  normal: { rows: 16, cols: 16, mines: 40 },
  hard: { rows: 16, cols: 30, mines: 99 },
};

export const MIN_SIZE = 5;
export const MAX_ROWS = 40;
export const MAX_COLS = 60;
/** 첫 클릭 칸과 그 주변 8칸에는 지뢰를 두지 않으므로 최소 9칸은 비워 둔다. */
export const SAFE_ZONE = 9;

export const Phase = {
  READY: 'ready',     // 판만 있고 지뢰는 아직 없음 (첫 클릭 뒤에 심는다)
  PLAYING: 'playing',
  WON: 'won',
  LOST: 'lost',
};

export const Mark = { NONE: 0, FLAG: 1, QUESTION: 2 };

function clampInt(value, lo, hi, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

/** 판 크기와 지뢰 수를 허용 범위로 맞춘다. */
export function normalizeOptions(opts = {}) {
  const rows = clampInt(opts.rows, MIN_SIZE, MAX_ROWS, PRESETS.easy.rows);
  const cols = clampInt(opts.cols, MIN_SIZE, MAX_COLS, PRESETS.easy.cols);
  const maxMines = rows * cols - SAFE_ZONE;
  const mines = clampInt(opts.mines, 1, maxMines, Math.min(maxMines, PRESETS.easy.mines));
  return { rows, cols, mines };
}

/** 옵션이 프리셋과 똑같으면 그 이름을, 아니면 null 을 돌려준다. (최고 기록 저장용) */
export function presetFor({ rows, cols, mines }) {
  for (const [name, p] of Object.entries(PRESETS)) {
    if (p.rows === rows && p.cols === cols && p.mines === mines) return name;
  }
  return null;
}

/**
 * 새 판. 지뢰는 첫 클릭 때 심는다 (첫 클릭은 절대 터지지 않고, 주변도 비어 있다).
 * @param {function} rand 0 이상 1 미만의 난수 — 테스트에서 고정된 판을 만들 때 바꿔 끼운다.
 */
export function createGame(opts, rand = Math.random) {
  const { rows, cols, mines } = normalizeOptions(opts);
  const size = rows * cols;
  return {
    rows,
    cols,
    mines,
    phase: Phase.READY,
    mine: new Array(size).fill(false),
    count: new Array(size).fill(0),  // 주변 지뢰 수
    open: new Array(size).fill(false),
    mark: new Array(size).fill(Mark.NONE),
    opened: 0,   // 연 칸 수 (지뢰 아닌 칸만)
    flags: 0,
    startedAt: null,
    endedAt: null,
    exploded: null, // 밟은 지뢰 칸 번호
    rand,
  };
}

export function index(game, row, col) {
  return row * game.cols + col;
}

export function inBoard(game, i) {
  return Number.isInteger(i) && i >= 0 && i < game.rows * game.cols;
}

/** 주변 8칸(판 가장자리는 그보다 적다)의 칸 번호. */
export function neighbors(game, i) {
  const { rows, cols } = game;
  const r = Math.floor(i / cols);
  const c = i % cols;
  const out = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr;
      const nc = c + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      out.push(nr * cols + nc);
    }
  }
  return out;
}

export function isOver(game) {
  return game.phase === Phase.WON || game.phase === Phase.LOST;
}

export function remainingMines(game) {
  return game.mines - game.flags;
}

/** 첫 클릭부터 지금(또는 끝난 시점)까지 흐른 밀리초. */
export function elapsedMs(game, now = Date.now()) {
  if (game.startedAt === null) return 0;
  return Math.max(0, (game.endedAt ?? now) - game.startedAt);
}

/* ───────── 내부 ───────── */

function fail(error) {
  return { ok: false, error };
}

/** safe 칸과 그 주변을 피해 지뢰를 심고 주변 지뢰 수를 센다. */
function placeMines(game, safe) {
  const size = game.rows * game.cols;
  const forbidden = new Set([safe, ...neighbors(game, safe)]);
  const pool = [];
  for (let i = 0; i < size; i++) if (!forbidden.has(i)) pool.push(i);
  // 부분 Fisher–Yates — 앞에서 mines 개만 뽑는다.
  for (let k = 0; k < game.mines; k++) {
    const j = k + Math.floor(game.rand() * (pool.length - k));
    [pool[k], pool[j]] = [pool[j], pool[k]];
    game.mine[pool[k]] = true;
  }
  for (let i = 0; i < size; i++) {
    if (game.mine[i]) continue;
    let n = 0;
    for (const nb of neighbors(game, i)) if (game.mine[nb]) n++;
    game.count[i] = n;
  }
}

function start(game, safe, now) {
  placeMines(game, safe);
  game.phase = Phase.PLAYING;
  game.startedAt = now;
}

/**
 * i 부터 열고, 0 인 칸을 만나면 주변으로 번져 나간다 (반복문, 깊은 재귀 없음).
 * 깃발이 꽂힌 칸은 건너뛰고, 물음표는 열면서 지운다.
 * @returns {number[]} 이번에 새로 연 칸 번호들
 */
function flood(game, from) {
  const opened = [];
  const stack = [from];
  while (stack.length) {
    const i = stack.pop();
    if (game.open[i] || game.mark[i] === Mark.FLAG) continue;
    game.open[i] = true;
    game.mark[i] = Mark.NONE;
    game.opened++;
    opened.push(i);
    if (game.count[i] !== 0) continue;
    for (const nb of neighbors(game, i)) if (!game.open[nb]) stack.push(nb);
  }
  return opened;
}

function explode(game, i, now) {
  game.exploded = i;
  game.phase = Phase.LOST;
  game.endedAt = now;
  return { ok: true, exploded: i, opened: [] };
}

/** 지뢰 아닌 칸을 전부 열었으면 승리. 남은 지뢰엔 깃발을 자동으로 꽂는다. */
function checkWin(game, now) {
  if (game.opened !== game.rows * game.cols - game.mines) return;
  game.phase = Phase.WON;
  game.endedAt = now;
  for (let i = 0; i < game.mine.length; i++) {
    if (game.mine[i]) game.mark[i] = Mark.FLAG;
  }
  game.flags = game.mines;
}

/* ───────── 조작 ───────── */

/** 칸을 연다. 첫 클릭이면 그때 지뢰를 심는다. */
export function reveal(game, i, now = Date.now()) {
  if (!inBoard(game, i)) return fail('out_of_board');
  if (isOver(game)) return fail('not_playing');
  if (game.open[i]) return fail('already_open');
  if (game.mark[i] === Mark.FLAG) return fail('flagged');
  if (game.phase === Phase.READY) start(game, i, now);
  if (game.mine[i]) return explode(game, i, now);
  const opened = flood(game, i);
  checkWin(game, now);
  return { ok: true, opened };
}

/**
 * 표시를 바꾼다: 없음 → 깃발 → (물음표 →) 없음.
 * 지뢰를 심기 전(READY)에도 꽂을 수 있다.
 */
export function toggleMark(game, i, { question = true } = {}) {
  if (!inBoard(game, i)) return fail('out_of_board');
  if (isOver(game)) return fail('not_playing');
  if (game.open[i]) return fail('already_open');
  const cur = game.mark[i];
  let next;
  if (cur === Mark.NONE) next = Mark.FLAG;
  else if (cur === Mark.FLAG) next = question ? Mark.QUESTION : Mark.NONE;
  else next = Mark.NONE;
  if (cur === Mark.FLAG) game.flags--;
  if (next === Mark.FLAG) game.flags++;
  game.mark[i] = next;
  return { ok: true, mark: next };
}

/**
 * 열린 숫자 칸을 눌러 주변을 한꺼번에 연다.
 * 주변 깃발 수가 숫자와 같을 때만 동작하고, 깃발을 잘못 꽂았다면 지뢰를 밟는다.
 */
export function chord(game, i, now = Date.now()) {
  if (!inBoard(game, i)) return fail('out_of_board');
  if (game.phase !== Phase.PLAYING) return fail('not_playing');
  if (!game.open[i]) return fail('not_open');
  if (game.count[i] === 0) return fail('nothing_to_open');
  const around = neighbors(game, i);
  let flagged = 0;
  for (const nb of around) if (game.mark[nb] === Mark.FLAG) flagged++;
  if (flagged !== game.count[i]) return fail('flags_mismatch');
  const targets = around.filter((nb) => !game.open[nb] && game.mark[nb] !== Mark.FLAG);
  if (targets.length === 0) return fail('nothing_to_open');
  const boom = targets.find((nb) => game.mine[nb]);
  if (boom !== undefined) return explode(game, boom, now);
  let opened = [];
  for (const t of targets) {
    if (!game.open[t]) opened = opened.concat(flood(game, t));
  }
  checkWin(game, now);
  return { ok: true, opened };
}

/**
 * 화면이 그릴 때 쓰는 한 칸의 모습.
 * 게임이 끝나기 전에는 지뢰 위치가 절대 새어 나가지 않는다.
 */
export function cellView(game, i) {
  const lost = game.phase === Phase.LOST;
  const mark = game.mark[i];
  return {
    open: game.open[i],
    count: game.open[i] ? game.count[i] : 0,
    mark,
    mine: lost && game.mine[i] && mark !== Mark.FLAG,        // 진 뒤에 드러난 지뢰
    exploded: game.exploded === i,
    wrongFlag: lost && mark === Mark.FLAG && !game.mine[i],  // 잘못 꽂은 깃발
  };
}

/* ───────── 전송용 직렬화 ─────────
 * 1:1 대전에서 서버가 판을 브라우저로 보낼 때 쓴다.
 * 칸 하나가 글자 하나: '.' 닫힘 · F 깃발 · ? 물음표 · 0~8 열림 · * 드러난 지뢰 · X 터진 지뢰 · ! 잘못 꽂은 깃발
 */

/** 판 전체를 문자열로. cellView 와 같은 정보만 담으므로 상대에게 보내도 지뢰가 새지 않는다. */
export function encodeBoard(game) {
  let out = '';
  for (let i = 0; i < game.rows * game.cols; i++) {
    const v = cellView(game, i);
    if (v.exploded) out += 'X';
    else if (v.mine) out += '*';
    else if (v.wrongFlag) out += '!';
    else if (v.open) out += String(v.count);
    else if (v.mark === Mark.FLAG) out += 'F';
    else if (v.mark === Mark.QUESTION) out += '?';
    else out += '.';
  }
  return out;
}

/** 지뢰 배치를 문자열로 ('*' 지뢰). 내 판을 브라우저가 미리 계산할 수 있게 본인에게만 보낸다. */
export function encodeLayout(game) {
  let out = '';
  for (let i = 0; i < game.mine.length; i++) out += game.mine[i] ? '*' : '.';
  return out;
}

/**
 * 전송된 스냅샷에서 게임 객체를 되살린다.
 * layout 이 있으면 reveal / toggleMark / chord 를 그대로 쓸 수 있는 완전한 게임이 되고,
 * 없으면(상대 판) cellView 로 그리기만 할 수 있다.
 */
export function fromSnapshot(snap) {
  const game = createGame(snap);
  game.phase = Object.values(Phase).includes(snap.phase) ? snap.phase : Phase.PLAYING;
  game.startedAt = snap.startedAt ?? null;
  game.endedAt = snap.endedAt ?? null;
  const size = game.rows * game.cols;
  const board = String(snap.board ?? '').padEnd(size, '.');

  if (typeof snap.layout === 'string' && snap.layout.length === size) {
    for (let i = 0; i < size; i++) game.mine[i] = snap.layout[i] === '*';
    for (let i = 0; i < size; i++) {
      if (game.mine[i]) continue;
      let n = 0;
      for (const nb of neighbors(game, i)) if (game.mine[nb]) n++;
      game.count[i] = n;
    }
  }

  for (let i = 0; i < size; i++) {
    const ch = board[i];
    if (ch >= '0' && ch <= '8') {
      game.open[i] = true;
      game.opened++;
      game.count[i] = Number(ch);
    } else if (ch === 'F' || ch === '!') {
      game.mark[i] = Mark.FLAG;
      game.flags++;
      // 진 판에서 'F' 는 맞게 꽂은 깃발이다 — layout 이 없어도 잘못 꽂은 것으로 그리지 않게
      if (ch === 'F' && game.phase === Phase.LOST) game.mine[i] = true;
    } else if (ch === '?') {
      game.mark[i] = Mark.QUESTION;
    } else if (ch === '*' || ch === 'X') {
      game.mine[i] = true;
      if (ch === 'X') game.exploded = i;
    }
  }
  if (game.phase === Phase.WON) game.flags = game.mines;
  return game;
}
