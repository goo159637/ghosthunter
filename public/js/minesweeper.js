/**
 * 지뢰찾기 화면.
 * 규칙은 /shared/minesweeper.js 한 곳에만 있다.
 * 여기서는 입력을 받아 그 함수를 부르고, 돌아온 상태를 그리기만 한다.
 */
import * as M from '/shared/minesweeper.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'minesweeper:settings';
const BEST_KEY = 'minesweeper:best';
const LONG_PRESS_MS = 350;   // 모바일에서 이만큼 누르고 있으면 깃발
const CELL_MIN = 24;
const CELL_MAX = 36;
const GAP = 2;

const coarse = matchMedia('(pointer: coarse)').matches;   // 터치 기기
const DIFFICULTY_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };

let game = null;
let cells = [];      // 칸 버튼들 (판 순서대로)
let painted = [];    // 마지막으로 그린 모습 — 바뀐 칸만 다시 칠하려고
let clockTimer = null;
let focusIndex = 0;

let settings = loadSettings();
let best = loadBest();

/* ───────── 공통 유틸 ───────── */

let toastTimer = null;
function toast(message) {
  const box = $('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.hidden = true;
  }, 3000);
}

function vibrate(pattern) {
  try {
    if (coarse && navigator.vibrate) navigator.vibrate(pattern);
  } catch { /* 지원 안 하면 조용히 */ }
}

/** 3자리 카운터 표기. 음수는 "-05" 처럼. */
function pad3(n) {
  if (n < 0) return '-' + String(Math.min(99, -n)).padStart(2, '0');
  return String(Math.min(999, n)).padStart(3, '0');
}

function formatTime(ms) {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}초`;
  const min = Math.floor(sec / 60);
  return `${min}분 ${(sec - min * 60).toFixed(1)}초`;
}

/* ───────── 저장 ───────── */

function loadSettings() {
  const def = { difficulty: 'normal', rows: 12, cols: 12, mines: 20, question: false, flagMode: false };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const out = { ...def, ...saved };
    if (!M.PRESETS[out.difficulty] && out.difficulty !== 'custom') out.difficulty = def.difficulty;
    Object.assign(out, M.normalizeOptions({ rows: out.rows, cols: out.cols, mines: out.mines }));
    out.question = Boolean(out.question);
    out.flagMode = Boolean(out.flagMode);
    return out;
  } catch {
    return def;
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* 저장 못 해도 진행 */ }
}

function loadBest() {
  try {
    const saved = JSON.parse(localStorage.getItem(BEST_KEY) || '{}');
    const out = {};
    for (const name of Object.keys(M.PRESETS)) {
      if (Number.isFinite(saved[name]) && saved[name] > 0) out[name] = saved[name];
    }
    return out;
  } catch {
    return {};
  }
}

function saveBest() {
  try {
    localStorage.setItem(BEST_KEY, JSON.stringify(best));
  } catch { /* 저장 못 해도 진행 */ }
}

function currentOptions() {
  if (settings.difficulty !== 'custom') return M.PRESETS[settings.difficulty];
  return M.normalizeOptions({ rows: settings.rows, cols: settings.cols, mines: settings.mines });
}

/* ───────── 판 만들기 ───────── */

function newGame() {
  stopClock();
  game = M.createGame(currentOptions());
  buildBoard();
  focusIndex = 0;
  $('result').hidden = true;
  render();
}

function buildBoard() {
  const board = $('board');
  board.replaceChildren();
  board.style.setProperty('--cols', game.cols);
  cells = [];
  painted = [];
  const frag = document.createDocumentFragment();
  for (let i = 0; i < game.rows * game.cols; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'cell';
    b.dataset.i = i;
    b.tabIndex = i === 0 ? 0 : -1;   // roving tabindex — Tab 은 한 번만 멈춘다
    b.setAttribute('role', 'gridcell');
    frag.appendChild(b);
    cells.push(b);
    painted.push('');
  }
  board.appendChild(frag);
  fitCells();
}

/** 화면 폭에 맞춰 칸 크기를 정한다. 너무 작아지면 가로 스크롤로 넘긴다. */
function fitCells() {
  if (!game) return;
  const avail = $('board-wrap').clientWidth - 4;
  const ideal = Math.floor((avail - (game.cols - 1) * GAP) / game.cols);
  const size = Math.max(CELL_MIN, Math.min(CELL_MAX, ideal));
  $('board').style.setProperty('--cell', `${size}px`);
}

/* ───────── 그리기 ───────── */

function paint(el, v, i) {
  const r = Math.floor(i / game.cols) + 1;
  const c = (i % game.cols) + 1;
  let cls = 'cell';
  let text = '';
  let label;
  if (v.exploded) {
    cls += ' mine boom';
    text = '💥';
    label = '터진 지뢰';
  } else if (v.mine) {
    cls += ' mine';
    text = '💣';
    label = '지뢰';
  } else if (v.wrongFlag) {
    cls += ' wrong';
    text = '🚩';
    label = '잘못 꽂은 깃발';
  } else if (v.open) {
    cls += ' open';
    if (v.count) {
      cls += ` n n${v.count}`;
      text = String(v.count);
      label = `주변 지뢰 ${v.count}개`;
    } else {
      label = '빈 칸';
    }
  } else if (v.mark === M.Mark.FLAG) {
    cls += ' flag';
    text = '🚩';
    label = '깃발';
  } else if (v.mark === M.Mark.QUESTION) {
    cls += ' q';
    text = '?';
    label = '물음표';
  } else {
    label = '닫힘';
  }
  el.className = cls;
  el.textContent = text;
  el.setAttribute('aria-label', `${r}행 ${c}열 ${label}`);
}

function render() {
  const over = M.isOver(game);
  $('board').classList.toggle('over', over);
  for (let i = 0; i < cells.length; i++) {
    const v = M.cellView(game, i);
    const key = `${v.open ? 1 : 0}${v.count}${v.mark}${v.mine ? 1 : 0}${v.exploded ? 1 : 0}${v.wrongFlag ? 1 : 0}`;
    if (key === painted[i]) continue;
    painted[i] = key;
    paint(cells[i], v, i);
  }
  $('mines-left').textContent = pad3(M.remainingMines(game));
  renderFace();
  renderClock();
  renderBest();
}

function renderFace(pressing = false) {
  const face = $('face');
  if (game.phase === M.Phase.WON) face.textContent = '😎';
  else if (game.phase === M.Phase.LOST) face.textContent = '😵';
  else face.textContent = pressing ? '😮' : '🙂';
}

function renderClock() {
  $('clock').textContent = pad3(Math.floor(M.elapsedMs(game) / 1000));
}

function renderBest() {
  const chip = $('best');
  const preset = settings.difficulty === 'custom' ? null : settings.difficulty;
  const ms = preset ? best[preset] : null;
  chip.hidden = !ms;
  if (ms) chip.textContent = `🏆 ${DIFFICULTY_LABEL[preset]} 최고 ${formatTime(ms)}`;
}

function startClock() {
  stopClock();
  clockTimer = setInterval(renderClock, 250);
}

function stopClock() {
  clearInterval(clockTimer);
  clockTimer = null;
}

/* ───────── 조작 → 규칙 → 그리기 ───────── */

function afterAction(out) {
  if (!out.ok) return;   // 이미 연 칸을 또 누르는 식의 헛손질은 조용히 넘긴다
  if (game.phase === M.Phase.PLAYING && !clockTimer) startClock();
  render();
  if (M.isOver(game)) finish();
}

/** 주 조작 — 닫힌 칸은 열고(깃발 모드면 깃발), 열린 숫자는 주변을 한꺼번에 연다. */
function primary(i) {
  if (game.open[i]) return afterAction(M.chord(game, i));
  if (settings.flagMode) return mark(i);
  afterAction(M.reveal(game, i));
}

/** 보조 조작 — 깃발. 열린 숫자면 역시 주변 열기. */
function secondary(i) {
  if (game.open[i]) return afterAction(M.chord(game, i));
  mark(i);
}

function mark(i) {
  const out = M.toggleMark(game, i, { question: settings.question });
  if (out.ok) vibrate(15);
  afterAction(out);
}

function finish() {
  stopClock();
  const ms = M.elapsedMs(game);
  const badge = $('result-badge');
  let detail;
  let sub;
  if (game.phase === M.Phase.WON) {
    badge.textContent = '성공!';
    badge.className = 'result win';
    detail = `${formatTime(ms)} 만에 지뢰 ${game.mines}개를 모두 찾았어요.`;
    const preset = M.presetFor(game);
    if (!preset) {
      sub = '커스텀 판은 기록을 저장하지 않아요.';
    } else if (!best[preset] || ms < best[preset]) {
      sub = best[preset] ? `🏆 새 기록! (이전 ${formatTime(best[preset])})` : '🏆 첫 기록이에요.';
      best[preset] = ms;
      saveBest();
    } else {
      sub = `${DIFFICULTY_LABEL[preset]} 최고 기록은 ${formatTime(best[preset])}`;
    }
    vibrate([30, 40, 30]);
  } else {
    badge.textContent = '펑!';
    badge.className = 'result lose';
    detail = '지뢰를 밟았어요.';
    const total = game.rows * game.cols - game.mines;
    sub = `${formatTime(ms)} 동안 ${total}칸 중 ${game.opened}칸을 열었어요.`;
    vibrate(120);
  }
  $('result-detail').textContent = detail;
  $('result-sub').textContent = sub;
  $('result').hidden = false;
  renderBest();
}

/* ───────── 입력 ───────── */

function cellIndexOf(ev) {
  const el = ev.target.closest?.('.cell');
  return el ? Number(el.dataset.i) : -1;
}

function moveFocus(i) {
  if (!M.inBoard(game, i)) return;
  cells[focusIndex].tabIndex = -1;
  focusIndex = i;
  cells[i].tabIndex = 0;
  cells[i].focus({ preventScroll: false });
}

function bindBoard() {
  const board = $('board');
  let pressTimer = null;
  let pressStart = null;
  let longPressed = false;      // 이번 터치에서 길게 눌러 깃발을 꽂았나
  let suppressUntil = 0;        // 그 뒤 따라오는 click 을 이 시각까지 무시
  let lastPointerType = 'mouse';

  const cancelPress = () => {
    clearTimeout(pressTimer);
    pressTimer = null;
    pressStart = null;
  };

  // 손을 뗀 뒤에만 짧게 막는다. 브라우저가 click 을 아예 안 보내는 경우(안드로이드 크롬)에도
  // 다음 탭이 삼켜지지 않도록 플래그 대신 시간창을 쓴다.
  const releasePress = () => {
    cancelPress();
    if (longPressed) {
      longPressed = false;
      suppressUntil = performance.now() + 400;
    }
  };

  board.addEventListener('pointerdown', (ev) => {
    lastPointerType = ev.pointerType;
    const i = cellIndexOf(ev);
    if (i < 0 || M.isOver(game)) return;
    if (ev.button === 0 && !game.open[i]) renderFace(true);
    if (ev.pointerType !== 'touch') return;
    cancelPress();
    longPressed = false;
    pressStart = { x: ev.clientX, y: ev.clientY };
    pressTimer = setTimeout(() => {
      pressTimer = null;
      longPressed = true;
      secondary(i);
    }, LONG_PRESS_MS);
  });

  board.addEventListener('pointermove', (ev) => {
    if (!pressStart) return;
    if (Math.hypot(ev.clientX - pressStart.x, ev.clientY - pressStart.y) > 10) cancelPress();
  });

  for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
    board.addEventListener(type, releasePress);
  }
  window.addEventListener('pointerup', () => {
    if (game) renderFace(false);
  });

  board.addEventListener('click', (ev) => {
    const i = cellIndexOf(ev);
    if (i < 0) return;
    if (performance.now() < suppressUntil) {
      suppressUntil = 0;
      return;
    }
    moveFocus(i);
    primary(i);
  });

  board.addEventListener('contextmenu', (ev) => {
    ev.preventDefault();
    const i = cellIndexOf(ev);
    if (i < 0 || lastPointerType === 'touch') return;   // 터치는 길게 누르기로 처리했다
    moveFocus(i);
    secondary(i);
  });

  board.addEventListener('auxclick', (ev) => {
    if (ev.button !== 1) return;   // 가운데 버튼 = 주변 열기
    ev.preventDefault();
    const i = cellIndexOf(ev);
    if (i >= 0 && game.open[i]) afterAction(M.chord(game, i));
  });

  board.addEventListener('focusin', (ev) => {
    const i = cellIndexOf(ev);
    if (i >= 0 && i !== focusIndex) {
      cells[focusIndex].tabIndex = -1;
      focusIndex = i;
      cells[i].tabIndex = 0;
    }
  });

  board.addEventListener('keydown', (ev) => {
    const { cols, rows } = game;
    const r = Math.floor(focusIndex / cols);
    const c = focusIndex % cols;
    let next = null;
    switch (ev.key) {
      case 'ArrowLeft': next = c > 0 ? focusIndex - 1 : null; break;
      case 'ArrowRight': next = c < cols - 1 ? focusIndex + 1 : null; break;
      case 'ArrowUp': next = r > 0 ? focusIndex - cols : null; break;
      case 'ArrowDown': next = r < rows - 1 ? focusIndex + cols : null; break;
      case 'Home': next = focusIndex - c; break;
      case 'End': next = focusIndex - c + cols - 1; break;
      case 'f': case 'F':
        ev.preventDefault();
        secondary(focusIndex);
        return;
      default: return;
    }
    ev.preventDefault();
    if (next !== null) moveFocus(next);
  });
}

function bindControls() {
  const difficulty = $('difficulty');
  const custom = $('custom');
  const inputs = { rows: $('c-rows'), cols: $('c-cols'), mines: $('c-mines') };

  const syncCustomInputs = () => {
    inputs.rows.value = settings.rows;
    inputs.cols.value = settings.cols;
    inputs.mines.value = settings.mines;
    inputs.mines.max = settings.rows * settings.cols - M.SAFE_ZONE;
  };

  difficulty.value = settings.difficulty;
  custom.hidden = settings.difficulty !== 'custom';
  syncCustomInputs();

  difficulty.addEventListener('change', () => {
    settings.difficulty = difficulty.value;
    custom.hidden = settings.difficulty !== 'custom';
    saveSettings();
    newGame();
  });

  for (const [key, input] of Object.entries(inputs)) {
    input.addEventListener('change', () => {
      const next = M.normalizeOptions({ ...settings, [key]: input.value });
      Object.assign(settings, next);
      syncCustomInputs();
      saveSettings();
    });
  }

  $('btn-new').addEventListener('click', newGame);
  $('face').addEventListener('click', newGame);
  $('btn-again').addEventListener('click', () => {
    newGame();
    $('board-wrap').scrollIntoView({ block: 'nearest' });
  });

  const flagBtn = $('btn-flagmode');
  const syncFlagMode = () => flagBtn.setAttribute('aria-pressed', String(settings.flagMode));
  syncFlagMode();
  flagBtn.addEventListener('click', () => {
    settings.flagMode = !settings.flagMode;
    syncFlagMode();
    saveSettings();
    toast(settings.flagMode ? '깃발 모드 — 탭하면 깃발을 꽂아요' : '깃발 모드 해제');
  });

  const question = $('opt-question');
  question.checked = settings.question;
  question.addEventListener('change', () => {
    settings.question = question.checked;
    saveSettings();
  });

  $('hint').textContent = coarse
    ? '탭 열기 · 길게 눌러 깃발 · 열린 숫자를 탭하면 주변을 한꺼번에 열어요'
    : '왼쪽 클릭 열기 · 오른쪽 클릭 깃발 · 열린 숫자를 클릭하면 주변을 한꺼번에 열어요';

  // 입력창 밖에서 N 을 누르면 새 게임
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'n' && ev.key !== 'N') return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    ev.preventDefault();
    newGame();
  });

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(fitCells);
  });
}

/* ───────── 시작 ───────── */

bindBoard();
bindControls();
newGame();
