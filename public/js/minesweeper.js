/**
 * 지뢰찾기 화면 — 혼자 하기와 1:1 대전.
 * 규칙은 /shared/minesweeper.js (판) 와 /shared/msversus.js (대전, 서버가 돌린다) 에만 있다.
 * 판을 그리고 입력을 받는 건 /js/msboard.js 가 하고, 여기서는 둘을 잇기만 한다.
 */
import * as M from '/shared/minesweeper.js';
import { createBoard } from '/js/msboard.js';
import { createOnlineEngine, loadToken } from '/js/net.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'minesweeper:settings';
const BEST_KEY = 'minesweeper:best';
const NAME_KEY = 'baseball:nickname';   // 숫자야구와 닉네임을 같이 쓴다
const GAME = 'minesweeper';

const coarse = matchMedia('(pointer: coarse)').matches;   // 터치 기기
const CELL_MIN = coarse ? 18 : 12;
const CELL_MAX = 36;
const DIFFICULTY_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };
const APP_PAD = 16;      // #app 좌우 여백
const PANEL_PAD = 16;

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

function span(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label}을(를) 복사했어요`);
  } catch {
    toast(`복사하지 못했어요 — ${text}`);
  }
}

/** 문서 기준 y 좌표 */
const docTop = (el) => el.getBoundingClientRect().top + window.scrollY;
const docBottom = (el) => el.getBoundingClientRect().bottom + window.scrollY;

/* ───────── 저장 ───────── */

function loadSettings() {
  const def = { mode: 'solo', difficulty: 'normal', rows: 12, cols: 12, mines: 20, question: false, flagMode: false };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const out = { ...def, ...saved };
    if (!M.PRESETS[out.difficulty] && out.difficulty !== 'custom') out.difficulty = def.difficulty;
    if (out.mode !== 'versus') out.mode = 'solo';
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

function nickname() {
  const value = $('nickname').value.trim();
  try {
    localStorage.setItem(NAME_KEY, value);
  } catch { /* 저장 못 해도 진행 */ }
  return value;
}

function currentOptions() {
  if (settings.difficulty !== 'custom') return M.PRESETS[settings.difficulty];
  return M.normalizeOptions({ rows: settings.rows, cols: settings.cols, mines: settings.mines });
}

/* ───────── 화면 전환 ───────── */

function setMode(mode, { save = true } = {}) {
  settings.mode = mode;
  if (save) saveSettings();
  for (const b of $('mode').querySelectorAll('button')) b.setAttribute('aria-selected', String(b.dataset.mode === mode));
  showScreen(mode === 'solo' ? 'solo' : engine ? 'vs-play' : 'vs-home');
}

function showScreen(which) {
  $('solo').hidden = which !== 'solo';
  $('vs-home').hidden = which !== 'vs-home';
  $('vs-play').hidden = which !== 'vs-play';
  $('controls').hidden = which === 'vs-play';
  $('btn-new').hidden = which !== 'solo';
  $('best').hidden = which !== 'solo' || !bestMs();
  if (which === 'solo') fitSolo();
  if (which === 'vs-play') fitVersus();
}

/* ═══════════════════ 혼자 ═══════════════════ */

let game = null;
let clockTimer = null;
const soloBoard = createBoard($('board'), {
  onPrimary: (i) => soloPrimary(i),
  onSecondary: (i) => soloSecondary(i),
  onChord: (i) => game && game.open[i] && soloAfter(M.chord(game, i)),
  onPress: (pressing) => game && renderFace(pressing),
});

function newGame() {
  stopClock();
  game = M.createGame(currentOptions());
  soloBoard.setGame(game);
  $('result').hidden = true;
  fitSolo();
  renderSolo();
}

/**
 * 판이 화면에 들어가도록 칸 크기를 정한다 — 너비와 높이 둘 다 본다.
 * 칸이 너무 작아지면 주변 여백을 줄이고(compact), 그래도 안 되면 그때만 스크롤.
 */
function fitSolo() {
  if (!game || $('solo').hidden) return;
  const app = document.querySelector('.ms');
  const fs = Boolean(document.fullscreenElement);
  const measure = () => {
    const wrap = $('board-wrap');
    const sidePad = fs ? 8 + 10 : APP_PAD + PANEL_PAD;
    const width = document.documentElement.clientWidth - sidePad * 2 - 4;
    const below = docBottom(app) - docBottom(wrap);   // 판 아래에 있는 모든 것 (도구, 규칙, 여백)
    const height = window.innerHeight - docTop(wrap) - below;
    return { width, height };
  };
  let cell = soloBoard.fit({ ...measure(), minCell: CELL_MIN, maxCell: CELL_MAX });
  const wantCompact = !fs && cell < 22;
  if (app.classList.contains('compact') !== wantCompact) {
    app.classList.toggle('compact', wantCompact);
    cell = soloBoard.fit({ ...measure(), minCell: CELL_MIN, maxCell: CELL_MAX });
  }
  return ensureNoScroll(soloBoard, $('board-wrap'), measure().height);
}

/**
 * 마지막 안전장치 — 계산과 실제 배치가 어긋나 판이 자기 상자에서 넘치면
 * 상자의 실제 폭에 맞춰 한 번 더 줄인다. (가로 스크롤은 절대 안 생기게)
 */
function ensureNoScroll(board, wrap, height = Infinity) {
  if (wrap.scrollWidth <= wrap.clientWidth) return board.cellSize;
  return board.fit({ width: wrap.clientWidth - 4, height, minCell: 8, maxCell: CELL_MAX });
}

function renderSolo() {
  soloBoard.render();
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

function bestMs() {
  return settings.difficulty === 'custom' ? null : best[settings.difficulty];
}

function renderBest() {
  const chip = $('best');
  const ms = bestMs();
  chip.hidden = !ms || settings.mode !== 'solo';
  if (ms) chip.textContent = `🏆 ${DIFFICULTY_LABEL[settings.difficulty]} 최고 ${formatTime(ms)}`;
}

function startClock() {
  stopClock();
  clockTimer = setInterval(renderClock, 250);
}

function stopClock() {
  clearInterval(clockTimer);
  clockTimer = null;
}

function soloAfter(out) {
  if (!out.ok) return;   // 이미 연 칸을 또 누르는 식의 헛손질은 조용히 넘긴다
  if (game.phase === M.Phase.PLAYING && !clockTimer) startClock();
  renderSolo();
  if (M.isOver(game)) finishSolo();
}

function soloPrimary(i) {
  if (game.open[i]) return soloAfter(M.chord(game, i));
  if (settings.flagMode) return soloMark(i);
  soloAfter(M.reveal(game, i));
}

function soloSecondary(i) {
  if (game.open[i]) return soloAfter(M.chord(game, i));
  soloMark(i);
}

function soloMark(i) {
  const out = M.toggleMark(game, i, { question: settings.question });
  if (out.ok) vibrate(15);
  soloAfter(out);
}

function finishSolo() {
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

/* ═══════════════════ 1:1 대전 ═══════════════════ */

let engine = null;
let unsubscribe = null;
let vs = null;          // 서버가 보낸 마지막 payload
let replica = null;     // 내 판의 복제본 — 클릭 즉시 여기에 적용해 그리고, 서버 확정 상태로 맞춘다
let replicaGameNo = 0;
let actionNo = 0;       // 내가 보낸 조작 번호. 서버 ack 가 여기에 닿기 전엔 내 판을 서버 상태로 덮지 않는다
let skew = 0;           // 서버 시계 - 내 시계
let vsTimer = null;
let lastPhase = null;

const serverNow = () => Date.now() + skew;

const myBoard = createBoard($('vs-my-board'), {
  onPrimary: (i) => vsPrimary(i),
  onSecondary: (i) => vsSecondary(i),
  onChord: (i) => replica && replica.open[i] && vsAct('chord', i),
});
const oppBoard = createBoard($('vs-opp-board'));

function startVersus(intent) {
  stopVersus();
  actionNo = 0;
  replica = null;
  engine = createOnlineEngine({ ...intent, game: GAME });
  engine.onError((err) => {
    toast(err.message || '문제가 생겼어요.');
    const fatal = ['room_not_found', 'bad_token', 'room_full', 'wrong_game', 'server_full'].includes(err.code);
    if (fatal && !vs?.view) {
      stopVersus();
      showScreen('vs-home');
    }
  });
  unsubscribe = engine.subscribe((payload) => {
    vs = payload;
    if (payload.view) {
      skew = payload.view.now - Date.now();
      syncBoards(payload);
    }
    renderVersus();
  });
  clearInterval(vsTimer);
  vsTimer = setInterval(renderVersusLive, 200);
  showScreen('vs-play');
}

function stopVersus({ keepUrl = false } = {}) {
  if (unsubscribe) unsubscribe();
  if (engine) engine.leave();
  clearInterval(vsTimer);
  vsTimer = null;
  unsubscribe = null;
  engine = null;
  vs = null;
  replica = null;
  lastPhase = null;
  if (!keepUrl && location.search) history.replaceState(null, '', location.pathname);
}

/** 서버 상태로 두 판을 맞춘다. 내 판은 서버가 내 마지막 조작까지 반영했을 때만 덮어쓴다. */
function syncBoards(payload) {
  const view = payload.view;
  const dims = { rows: view.rows, cols: view.cols, mines: view.mines };
  if (view.me.board) {
    const caughtUp = payload.ack >= actionNo;
    if (caughtUp || !replica || replicaGameNo !== view.gameNo) {
      replica = M.fromSnapshot({ ...dims, ...view.me, phase: view.me.boardPhase });
      replicaGameNo = view.gameNo;
      myBoard.setGame(replica);
      if (!caughtUp) actionNo = payload.ack;   // 새 판이면 번호도 서버에 맞춘다
    }
  } else {
    replica = null;
  }
  if (view.opponent.board) {
    oppBoard.setGame(M.fromSnapshot({ ...dims, ...view.opponent, phase: view.opponent.boardPhase }));
  }
  if (view.phase !== lastPhase) {
    lastPhase = view.phase;
    fitVersus();
    if (view.phase === 'countdown') vibrate(20);
  }
}

function canAct() {
  const view = vs?.view;
  if (!view || !replica || M.isOver(replica)) return false;
  if (view.phase === 'playing') return true;
  return view.phase === 'countdown' && serverNow() >= view.startAt;   // 출발 직후 서버 확정이 오기 전에도 둘 수 있게
}

function vsAct(a, i) {
  if (!canAct()) return;
  const out = a === 'reveal' ? M.reveal(replica, i)
    : a === 'mark' ? M.toggleMark(replica, i, { question: settings.question })
      : M.chord(replica, i);
  if (!out.ok) return;
  actionNo++;
  engine.action({ t: 'ms', a, i, n: actionNo, q: settings.question });
  if (a === 'mark') vibrate(15);
  myBoard.render();
  renderVersusLive();
  if (M.isOver(replica)) renderVersus();   // 서버 확정 전에 결과를 미리 보여 주진 않지만 판은 굳힌다
}

function vsPrimary(i) {
  if (!replica) return;
  if (replica.open[i]) return vsAct('chord', i);
  if (settings.flagMode) return vsAct('mark', i);
  vsAct('reveal', i);
}

function vsSecondary(i) {
  if (!replica) return;
  if (replica.open[i]) return vsAct('chord', i);
  vsAct('mark', i);
}

/** 두 판을 나란히(넓은 화면) 또는 위아래로(좁은 화면) 화면에 맞춘다. */
function fitVersus() {
  if ($('vs-play').hidden || !myBoard.game) return;
  const wide = window.innerWidth >= 720;
  const sidePad = 12;
  const total = document.documentElement.clientWidth - APP_PAD * 2;
  const width = (wide ? (total - 14) / 2 : total) - sidePad * 2 - 4;
  const wrap = $('vs-my-board').parentElement;
  const height = wide ? window.innerHeight - docTop(wrap) - 80 : window.innerHeight * 0.6;
  myBoard.fit({ width, height, minCell: CELL_MIN, maxCell: CELL_MAX });
  ensureNoScroll(myBoard, wrap, height);
  if (oppBoard.game) {
    const oppHeight = wide ? height : Infinity;
    oppBoard.fit({ width, height: oppHeight, minCell: 8, maxCell: wide ? CELL_MAX : 22 });
    ensureNoScroll(oppBoard, $('vs-opp-board').parentElement, oppHeight);
  }
}

function connectionChip() {
  const chip = $('conn');
  chip.className = 'chip';
  const status = vs?.status ?? 'connecting';
  if (status === 'online') {
    chip.textContent = '온라인';
    chip.classList.add('on');
  } else if (status === 'reconnecting') {
    chip.textContent = '재연결 중…';
    chip.classList.add('off');
  } else {
    chip.textContent = '연결 중…';
  }
}

function renderChat(chat, you) {
  const log = $('chat-log');
  log.replaceChildren();
  for (const line of chat) {
    const li = document.createElement('li');
    if (line.player === you) li.className = 'me';
    li.append(span('who', line.name), span('text', line.text));
    log.append(li);
  }
  log.scrollTop = log.scrollHeight;
}

function vsResultTexts(view) {
  const name = view.opponent.name;
  if (view.winner === 'you') {
    const detail = {
      clear: '먼저 다 열었어요!',
      mine: `${name}이(가) 지뢰를 밟았어요.`,
      forfeit: `${name}이(가) 나가서 승리했습니다.`,
    };
    return ['승리 🎉', 'win', detail[view.overReason] ?? '승리했습니다.'];
  }
  const detail = {
    clear: `${name}이(가) 먼저 다 열었어요.`,
    mine: '지뢰를 밟았어요.',
    forfeit: '기권했습니다.',
  };
  return [view.overReason === 'mine' ? '펑!' : '패배', 'lose', detail[view.overReason] ?? '아쉽네요.'];
}

/** 시계·카운트다운·진행률처럼 매 순간 바뀌는 것만 (200ms 마다) */
function renderVersusLive() {
  const view = vs?.view;
  if (!view) return;
  const count = $('vs-count');
  if (view.phase === 'countdown') {
    const left = view.startAt - serverNow();
    count.hidden = false;
    count.textContent = left > 0 ? String(Math.ceil(left / 1000)) : 'GO!';
    $('vs-my-board').classList.toggle('waiting', left > 0);
  } else {
    count.hidden = true;
    $('vs-my-board').classList.remove('waiting');
  }
  const stat = (p, g) => {
    if (!g) return '';
    const secs = Math.floor(M.elapsedMs(g, serverNow()) / 1000);
    return `${g.opened}/${view.total}칸 · 🚩 ${p.flags ?? g.flags}/${view.mines} · ${pad3(secs)}`;
  };
  $('vs-my-stats').textContent = stat(view.me, replica);
  $('vs-opp-stats').textContent = stat(view.opponent, oppBoard.game);
  $('vs-my-progress').style.width = replica ? `${(replica.opened / view.total) * 100}%` : '0';
  $('vs-opp-progress').style.width = oppBoard.game ? `${(oppBoard.game.opened / view.total) * 100}%` : '0';
}

function renderVersus() {
  connectionChip();
  const view = vs?.view;
  const code = vs?.code;

  $('room-code').hidden = !code;
  if (code) {
    $('room-code').textContent = `방 ${code}`;
    if (new URLSearchParams(location.search).get('room') !== code) history.replaceState(null, '', `?room=${code}`);
  }

  const title = $('vs-title');
  const sub = $('vs-sub');
  if (!view) {
    title.textContent = vs?.status === 'reconnecting' ? '다시 연결하는 중…' : '연결 중…';
    sub.textContent = '';
    $('vs-lobby').hidden = true;
    $('vs-arena').hidden = true;
    $('vs-result').hidden = true;
    $('vs-chat').hidden = true;
    return;
  }

  const me = view.me;
  const opp = view.opponent;
  $('vs-lobby').hidden = view.phase !== 'lobby';
  $('vs-arena').hidden = view.phase === 'lobby';
  $('vs-result').hidden = view.phase !== 'over';
  $('vs-chat').hidden = false;
  $('lobby-code').textContent = code ?? '';
  $('vs-my-name').textContent = `${me.name} (나)`;
  $('vs-opp-name').textContent = opp.joined ? opp.name : '상대';
  $('vs-hint').textContent = coarse ? '탭 열기 · 길게 눌러 깃발' : '좌클릭 열기 · 우클릭 깃발';

  const oppSide = document.querySelector('.vs-side.opp');
  oppSide.classList.toggle('away', opp.joined && !opp.present);
  oppSide.classList.toggle('finished', opp.boardPhase === 'lost' || opp.boardPhase === 'won');
  document.querySelector('.vs-side.me').classList.toggle('finished', me.boardPhase === 'lost' || me.boardPhase === 'won');
  let note = '';
  if (opp.joined && !opp.present) {
    const left = vs.grace ? Math.max(0, Math.ceil((vs.grace - serverNow()) / 1000)) : null;
    note = left === null ? '상대가 나갔어요' : `상대 연결이 끊겼어요 — ${left}초 안에 돌아오지 않으면 기권 처리`;
  } else if (opp.boardPhase === 'lost') note = '💥 상대가 지뢰를 밟았어요';
  else if (opp.boardPhase === 'won') note = '😎 상대가 다 열었어요';
  $('vs-opp-note').textContent = note;

  if (view.phase === 'lobby') {
    title.textContent = '상대를 기다리는 중…';
    sub.textContent = '코드나 초대 링크를 보내면 바로 시작돼요.';
  } else if (view.phase === 'countdown') {
    title.textContent = `${view.gameNo}번째 판 — 준비!`;
    sub.textContent = `${view.rows}×${view.cols} · 지뢰 ${view.mines}개 · 출발 지점은 열려 있어요`;
  } else if (view.phase === 'playing') {
    title.textContent = '진행 중';
    sub.textContent = '먼저 다 여는 쪽이 승리 · 지뢰를 밟으면 그 자리에서 패배';
  } else {
    const [badge, cls, detail] = vsResultTexts(view);
    title.textContent = view.winner === 'you' ? '승리!' : '패배';
    sub.textContent = detail;
    $('vs-result-badge').textContent = badge;
    $('vs-result-badge').className = `result ${cls}`;
    $('vs-result-detail').textContent = detail;
    const mine = replica ? `${replica.opened}/${view.total}칸` : '';
    const theirs = oppBoard.game ? `${oppBoard.game.opened}/${view.total}칸` : '';
    $('vs-result-sub').textContent = replica ? `나 ${mine} · ${opp.name} ${theirs} · ${formatTime(M.elapsedMs(replica, serverNow()))}` : '';
    $('btn-rematch').disabled = me.rematch || !opp.joined;
    $('rematch-state').textContent = me.rematch
      ? '상대의 재대결 수락을 기다리는 중…'
      : opp.rematch ? `${opp.name}이(가) 재대결을 원해요!` : '';
  }

  renderChat(vs.chat ?? [], view.you);
  renderVersusLive();
}

/* ───────── 입력 묶기 ───────── */

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
    if (settings.mode === 'solo') newGame();
    renderBest();
  });

  for (const [key, input] of Object.entries(inputs)) {
    input.addEventListener('change', () => {
      const next = M.normalizeOptions({ ...settings, [key]: input.value });
      Object.assign(settings, next);
      syncCustomInputs();
      saveSettings();
    });
  }

  for (const b of $('mode').querySelectorAll('button')) {
    b.addEventListener('click', () => setMode(b.dataset.mode));
  }

  $('btn-new').addEventListener('click', newGame);
  $('face').addEventListener('click', newGame);
  $('btn-again').addEventListener('click', () => {
    newGame();
    $('board-wrap').scrollIntoView({ block: 'nearest' });
  });

  // 깃발 모드 / 물음표 — 혼자·대전 화면에 하나씩 있는 버튼을 같은 설정에 묶는다
  const flagButtons = document.querySelectorAll('.flag-toggle');
  const syncFlagMode = () => flagButtons.forEach((b) => b.setAttribute('aria-pressed', String(settings.flagMode)));
  syncFlagMode();
  flagButtons.forEach((b) => b.addEventListener('click', () => {
    settings.flagMode = !settings.flagMode;
    syncFlagMode();
    saveSettings();
    toast(settings.flagMode ? '깃발 모드 — 탭하면 깃발을 꽂아요' : '깃발 모드 해제');
  }));
  const questionBoxes = document.querySelectorAll('.question-opt');
  questionBoxes.forEach((box) => {
    box.checked = settings.question;
    box.addEventListener('change', () => {
      settings.question = box.checked;
      questionBoxes.forEach((o) => { o.checked = box.checked; });
      saveSettings();
    });
  });

  $('hint').textContent = coarse
    ? '탭 열기 · 길게 눌러 깃발 · 열린 숫자를 탭하면 주변을 한꺼번에 열어요'
    : '왼쪽 클릭 열기 · 오른쪽 클릭 깃발 · 열린 숫자를 클릭하면 주변을 한꺼번에 열어요';

  // 전체 화면 — 판만 크게. 지원하지 않는 브라우저(iOS 사파리)에선 버튼을 감춘다
  const fsBtn = $('btn-fs');
  if (!document.documentElement.requestFullscreen) fsBtn.hidden = true;
  fsBtn.addEventListener('click', () => {
    if (document.fullscreenElement) document.exitFullscreen();
    else document.documentElement.requestFullscreen().catch(() => toast('전체 화면으로 바꾸지 못했어요'));
  });
  document.addEventListener('fullscreenchange', () => {
    document.querySelector('.ms').classList.toggle('fs', Boolean(document.fullscreenElement));
    fsBtn.textContent = document.fullscreenElement ? '✕' : '⛶';
    requestAnimationFrame(fitSolo);
  });

  // 입력창 밖에서 N 을 누르면 새 게임 (혼자 모드)
  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'n' && ev.key !== 'N') return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
    if (settings.mode !== 'solo') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    ev.preventDefault();
    newGame();
  });

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      fitSolo();
      fitVersus();
    });
  });
}

function bindVersus() {
  try {
    $('nickname').value = localStorage.getItem(NAME_KEY) ?? '';
  } catch { /* 무시 */ }

  $('btn-create').addEventListener('click', () => {
    startVersus({ type: 'create', name: nickname(), options: currentOptions() });
  });

  $('btn-join').addEventListener('click', () => {
    const code = $('join-code').value.trim().toUpperCase();
    if (code.length !== 4) {
      toast('방 코드는 4글자예요');
      return;
    }
    startVersus({ type: 'join', name: nickname(), code });
  });
  $('join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-join').click();
  });

  const leave = () => {
    const phase = vs?.view?.phase;
    const live = phase === 'countdown' || phase === 'playing';
    if (live && !confirm('지금 나가면 기권 처리됩니다. 나갈까요?')) return;
    if (live && engine) engine.surrender();
    stopVersus();
    showScreen('vs-home');
  };
  $('btn-leave').addEventListener('click', leave);
  $('btn-vs-home').addEventListener('click', leave);

  $('btn-rematch').addEventListener('click', () => engine?.rematch());
  $('room-code').addEventListener('click', () => vs?.code && copy(vs.code, '방 코드'));
  $('btn-copy-code').addEventListener('click', () => vs?.code && copy(vs.code, '방 코드'));
  $('btn-copy-link').addEventListener('click', () => {
    if (!vs?.code) return;
    copy(`${location.origin}${location.pathname}?room=${vs.code}`, '초대 링크');
  });

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (!text || !engine) return;
    engine.chat(text);
    $('chat-input').value = '';
  });
}

/* ───────── 시작 ───────── */

bindControls();
bindVersus();
newGame();

const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  const code = roomParam.toUpperCase().slice(0, 4);
  $('join-code').value = code;
  setMode('versus', { save: false });
  if (loadToken(code, GAME)) {
    // 새로고침 전에 있던 방 — 토큰이 있으면 그대로 복귀
    startVersus({ type: 'join', name: nickname(), code });
  } else {
    toast(`방 ${code} — 닉네임을 넣고 참가하기를 누르세요`);
    $('nickname').focus();
  }
} else {
  setMode(settings.mode, { save: false });
}
