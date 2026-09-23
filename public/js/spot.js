/**
 * 틀린그림찾기 화면 — 혼자 하기와 1:1 대전.
 * 그림은 /shared/spot.js 가 seed 로 만들고 SVG 로 그린다. 대전의 판정은 서버(/shared/spotversus.js)가 한다.
 */
import * as S from '/shared/spot.js';
import { createOnlineEngine, loadToken } from '/js/net.js';
import { createVersusChrome, bindVersusChrome } from '/js/vsui.js';

const $ = (id) => document.getElementById(id);
const SETTINGS_KEY = 'spot:settings';
const BEST_KEY = 'spot:best';
const NAME_KEY = 'baseball:nickname';   // 다른 게임과 닉네임을 같이 쓴다
const GAME = 'spot';
const MISS_PENALTY = 5;    // 초
const HINT_PENALTY = 20;   // 초
const DIFFICULTY_LABEL = { easy: '쉬움', normal: '보통', hard: '어려움' };
const coarse = matchMedia('(pointer: coarse)').matches;

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

function span(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

function formatTime(ms) {
  const sec = ms / 1000;
  if (sec < 60) return `${sec.toFixed(1)}초`;
  const min = Math.floor(sec / 60);
  return `${min}분 ${(sec - min * 60).toFixed(1)}초`;
}

function pad3(n) {
  return String(Math.min(999, Math.max(0, n))).padStart(3, '0');
}

function mmss(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label}을(를) 복사했어요`);
  } catch {
    toast(`복사하지 못했어요 — ${text}`);
  }
}

/* ───────── 저장 ───────── */

function loadSettings() {
  const def = { mode: 'solo', difficulty: 'normal', theme: 'auto' };
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    const out = { ...def, ...saved };
    if (!S.PRESETS[out.difficulty]) out.difficulty = def.difficulty;
    if (out.theme !== 'auto' && !S.THEMES.includes(out.theme)) out.theme = 'auto';
    if (out.mode !== 'versus') out.mode = 'solo';
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
    for (const name of Object.keys(S.PRESETS)) if (Number.isFinite(saved[name]) && saved[name] > 0) out[name] = saved[name];
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
  } catch { /* 무시 */ }
  return value;
}

const themeOption = () => (settings.theme === 'auto' ? undefined : settings.theme);

/* ───────── 그림 짝 ─────────
 * 왼쪽·오른쪽 그림과 그 위의 표시(찾은 곳 동그라미, 오답 X)를 다룬다.
 * 클릭 좌표는 장면 좌표(480×360)로 바꿔 넘긴다 — 두 그림 어느 쪽을 눌러도 같다.
 */
function createPair(root, { onClick } = {}) {
  const pics = [...root.querySelectorAll('.pic')];
  let seed = null;

  const toScene = (pic, ev) => {
    const rect = pic.getBoundingClientRect();
    return {
      x: ((ev.clientX - rect.left) / rect.width) * S.WIDTH,
      y: ((ev.clientY - rect.top) / rect.height) * S.HEIGHT,
    };
  };

  if (onClick) {
    for (const pic of pics) {
      pic.addEventListener('click', (ev) => {
        if (pic.classList.contains('readonly') || pic.classList.contains('locked') || pic.classList.contains('waiting')) return;
        const { x, y } = toScene(pic, ev);
        onClick(Math.round(x * 10) / 10, Math.round(y * 10) / 10);
      });
    }
  }

  const marksOf = (pic) => pic.querySelector('.marks');

  return {
    get seed() {
      return seed;
    },
    show(puzzle) {
      seed = puzzle.seed;
      for (const pic of pics) pic.querySelector('.scene').innerHTML = S.renderScene(puzzle, pic.dataset.side);
      this.setMarks([]);
    },
    clear() {
      seed = null;
      for (const pic of pics) {
        pic.querySelector('.scene').innerHTML = '';
        marksOf(pic).replaceChildren();
      }
    },
    /** 찾은 곳 표시. list: [{cx, cy, r, cls, label?}] */
    setMarks(list) {
      for (const pic of pics) {
        const svg = marksOf(pic);
        svg.querySelectorAll('.mark, .halo, text').forEach((n) => n.remove());
        for (const m of list) {
          const halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          halo.setAttribute('class', 'halo');
          halo.setAttribute('cx', m.cx);
          halo.setAttribute('cy', m.cy);
          halo.setAttribute('r', m.r);
          const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
          c.setAttribute('class', `mark ${m.cls}`);
          c.setAttribute('cx', m.cx);
          c.setAttribute('cy', m.cy);
          c.setAttribute('r', m.r);
          svg.append(halo, c);
          if (m.label) {
            const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            t.setAttribute('x', m.cx);
            t.setAttribute('y', m.cy - m.r - 6);
            t.textContent = m.label;
            svg.append(t);
          }
        }
      }
    },
    /** 오답 X — 잠깐 보였다 사라진다 */
    flashMiss(x, y) {
      for (const pic of pics) {
        const svg = marksOf(pic);
        const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const d = 14;
        for (const [x1, y1, x2, y2] of [[x - d, y - d, x + d, y + d], [x - d, y + d, x + d, y - d]]) {
          const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
          l.setAttribute('class', 'miss');
          l.setAttribute('x1', x1);
          l.setAttribute('y1', y1);
          l.setAttribute('x2', x2);
          l.setAttribute('y2', y2);
          g.append(l);
        }
        svg.append(g);
        setTimeout(() => g.remove(), 750);
      }
    },
    setState({ locked = false, readonly = false, waiting = false } = {}) {
      for (const pic of pics) {
        pic.classList.toggle('locked', locked);
        pic.classList.toggle('readonly', readonly);
        pic.classList.toggle('waiting', waiting);
      }
    },
  };
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
  renderBest();
}

/* ═══════════════════ 혼자 ═══════════════════ */

let puzzle = null;
let found = new Map();     // 차이 번호 → 'found' | 'hint'
let misses = 0;
let startedAt = null;
let endedAt = null;
let clockTimer = null;
const soloPair = createPair($('solo-pair'), { onClick: soloClick });

function penaltyMs() {
  let hints = 0;
  for (const v of found.values()) if (v === 'hint') hints++;
  return (misses * MISS_PENALTY + hints * HINT_PENALTY) * 1000;
}

function soloElapsed() {
  if (startedAt === null) return 0;
  return (endedAt ?? Date.now()) - startedAt + penaltyMs();
}

function newGame(seed = null) {
  puzzle = S.generatePuzzle({ seed: seed ?? S.randomSeed(), difficulty: settings.difficulty, theme: themeOption() });
  found = new Map();
  misses = 0;
  startedAt = Date.now();
  endedAt = null;
  soloPair.show(puzzle);
  soloPair.setState({});
  $('result').hidden = true;
  $('btn-hint').disabled = false;
  $('seed-chip').textContent = `#${puzzle.seed}`;
  const url = new URL(location.href);
  url.searchParams.set('seed', puzzle.seed);
  url.searchParams.set('d', settings.difficulty);
  history.replaceState(null, '', url);
  clearInterval(clockTimer);
  clockTimer = setInterval(renderSoloClock, 250);
  renderSolo();
}

function soloMarks() {
  const list = [];
  for (const [i, how] of found) {
    const d = puzzle.diffs[i];
    list.push({ cx: d.cx, cy: d.cy, r: d.r, cls: how === 'hint' ? 'hint' : 'found' });
  }
  return list;
}

function renderSolo() {
  $('found').textContent = `${found.size}/${puzzle.diffs.length}`;
  $('misses').textContent = `✗ ${misses}`;
  soloPair.setMarks(soloMarks());
  renderSoloClock();
  renderBest();
}

function renderSoloClock() {
  $('clock').textContent = pad3(Math.floor(soloElapsed() / 1000));
}

function bestMs() {
  return best[settings.difficulty] ?? null;
}

function renderBest() {
  const chip = $('best');
  const ms = bestMs();
  chip.hidden = !ms || settings.mode !== 'solo';
  if (ms) chip.textContent = `🏆 ${DIFFICULTY_LABEL[settings.difficulty]} 최고 ${formatTime(ms)}`;
}

function soloClick(x, y) {
  if (!puzzle || endedAt !== null) return;
  const i = S.hitTest(puzzle, x, y);
  if (i >= 0 && !found.has(i)) {
    found.set(i, 'found');
    vibrate(20);
    renderSolo();
    if (found.size === puzzle.diffs.length) finishSolo();
    return;
  }
  misses++;
  soloPair.flashMiss(x, y);
  vibrate(60);
  renderSolo();
}

function soloHint() {
  if (!puzzle || endedAt !== null) return;
  const left = puzzle.diffs.map((_, i) => i).filter((i) => !found.has(i));
  if (!left.length) return;
  const i = left[Math.floor(Math.random() * left.length)];
  found.set(i, 'hint');
  toast(`힌트 — 표시된 곳이 달라요 (+${HINT_PENALTY}초)`);
  renderSolo();
  if (found.size === puzzle.diffs.length) finishSolo();
}

function finishSolo() {
  endedAt = Date.now();
  clearInterval(clockTimer);
  const ms = soloElapsed();
  let hints = 0;
  for (const v of found.values()) if (v === 'hint') hints++;
  $('result-badge').textContent = '다 찾았어요!';
  $('result-badge').className = 'result win';
  $('result-detail').textContent = `${formatTime(ms)} · ${S.THEME_LABEL[puzzle.theme]} #${puzzle.seed}`;
  const parts = [];
  if (misses) parts.push(`오답 ${misses}번 (+${misses * MISS_PENALTY}초)`);
  if (hints) parts.push(`힌트 ${hints}번 (+${hints * HINT_PENALTY}초)`);
  let sub = parts.length ? parts.join(' · ') : '오답도 힌트도 없이!';
  const key = settings.difficulty;
  if (hints === 0) {
    if (!best[key] || ms < best[key]) {
      sub += best[key] ? ` · 🏆 새 기록! (이전 ${formatTime(best[key])})` : ' · 🏆 첫 기록이에요.';
      best[key] = ms;
      saveBest();
    } else {
      sub += ` · ${DIFFICULTY_LABEL[key]} 최고 기록은 ${formatTime(best[key])}`;
    }
  } else {
    sub += ' · 힌트를 쓰면 기록은 남지 않아요.';
  }
  $('result-sub').textContent = sub;
  $('result').hidden = false;
  $('btn-hint').disabled = true;
  vibrate([30, 40, 30]);
  renderBest();
}

/* ═══════════════════ 1:1 대전 ═══════════════════ */

let engine = null;
let unsubscribe = null;
let vs = null;
let skew = 0;
let vsTimer = null;
let lastRole = null;
let lastSeed = null;
let lockedUntil = 0;

const serverNow = () => Date.now() + skew;
const isPlayer = () => vs?.role === 'player' && vs?.you !== null;
const leftIndex = () => (isPlayer() ? vs.you : 0);
const seatL = (view = vs?.view) => view?.seats[leftIndex()];
const seatR = (view = vs?.view) => view?.seats[1 - leftIndex()];

const vsPair = createPair($('vs-pair'), { onClick: vsClick });
const chrome = createVersusChrome({ $, span, engine: () => engine, state: () => vs, isPlayer, seatL, seatR });

function startVersus(intent) {
  stopVersus();
  engine = createOnlineEngine({ ...intent, game: GAME });
  engine.onError((err) => {
    toast(err.message || '문제가 생겼어요.');
    const fatal = ['room_not_found', 'bad_token', 'room_full', 'wrong_game', 'server_full', 'no_spectate', 'spectators_full'].includes(err.code);
    if (fatal && !vs?.view) {
      stopVersus();
      showScreen('vs-home');
    }
  });
  engine.onMessage((msg) => {
    if (msg.t !== 'spot_result') return;
    if (msg.hit) {
      vibrate(20);
    } else if (!msg.locked) {
      vsPair.flashMiss(msg.x, msg.y);
      lockedUntil = msg.lockedUntil ?? 0;
      vibrate(60);
    }
    renderVersusLive();
  });
  unsubscribe = engine.subscribe((payload) => {
    vs = payload;
    if (payload.role !== lastRole) {
      lastRole = payload.role;
      lockedUntil = 0;
    }
    if (payload.view) {
      skew = payload.view.now - Date.now();
      syncFromView(payload.view);
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
  lastRole = null;
  lastSeed = null;
  lockedUntil = 0;
  vsPair.clear();
  if (!keepUrl && location.search) history.replaceState(null, '', location.pathname);
}

function syncFromView(view) {
  if (view.puzzle) {
    if (view.puzzle.seed !== lastSeed) {
      vsPair.show(view.puzzle);
      lastSeed = view.puzzle.seed;
    }
    const l = leftIndex();
    vsPair.setMarks(view.found.map((f) => ({ cx: f.cx, cy: f.cy, r: f.r, cls: f.by === l ? 'me' : 'opp' })));
  } else {
    vsPair.clear();
    lastSeed = null;
  }
  const me = seatL(view);
  if (isPlayer() && me && me.lockedUntil > lockedUntil) lockedUntil = me.lockedUntil;
}

function canAct() {
  const view = vs?.view;
  if (!isPlayer() || !view) return false;
  if (serverNow() < lockedUntil) return false;
  if (view.phase === 'playing') return true;
  return view.phase === 'countdown' && serverNow() >= view.startAt;
}

function vsClick(x, y) {
  if (!canAct()) return;
  engine.action({ t: 'spot', x, y });
}

/** 시계·카운트다운·잠김처럼 매 순간 바뀌는 것만 (200ms 마다) */
function renderVersusLive() {
  const view = vs?.view;
  if (!view) return;
  const now = serverNow();
  const count = $('vs-count');
  if (view.phase === 'countdown') {
    const left = view.startAt - now;
    count.hidden = false;
    count.textContent = left > 0 ? String(Math.ceil(left / 1000)) : 'GO!';
  } else {
    count.hidden = true;
  }
  const playing = view.phase === 'playing' || (view.phase === 'countdown' && now >= view.startAt);
  $('vs-timer').textContent = view.endsAt && (playing || view.phase === 'countdown') ? mmss(view.endsAt - Math.max(now, view.startAt)) : view.phase === 'over' ? '끝' : '--';
  const locked = isPlayer() && now < lockedUntil && playing;
  vsPair.setState({
    locked,
    readonly: !isPlayer() || view.phase === 'over',
    waiting: view.phase === 'countdown' && now < view.startAt,
  });
}

const REASON_LABEL = { found: '다 찾음', time: '시간 종료', forfeit: '기권' };

function renderHistory(view) {
  const list = $('vs-history');
  list.replaceChildren();
  list.hidden = view.history.length === 0;
  const l = leftIndex();
  for (const h of [...view.history].reverse().slice(0, 8)) {
    const li = document.createElement('li');
    li.className = h.winner === 'draw' ? '' : h.winner === l ? 'win' : 'lose';
    const who = h.winner === 'draw' ? '무승부' : `${h.names[h.winner]} 승`;
    li.append(
      span('no', `${h.gameNo}판`),
      span('who', who),
      span('why', `${h.found[l]} : ${h.found[1 - l]} / ${h.total} · ${REASON_LABEL[h.reason] ?? h.reason} · ${S.THEME_LABEL[h.theme] ?? ''} · ${formatTime(h.ms)}`),
    );
    list.append(li);
  }
}

function vsResultTexts(view) {
  const L = seatL(view);
  const R = seatR(view);
  const l = leftIndex();
  const me = isPlayer();
  const counts = `${L.found} : ${R.found} (${view.puzzle?.diffCount ?? view.diffs}곳 중)`;
  if (view.winner === 'draw') return ['무승부', 'draw', `똑같이 찾았어요 — ${counts}`];
  const winnerName = view.seats[view.winner]?.name;
  const iWon = view.winner === l;
  if (view.overReason === 'forfeit') {
    const loser = view.seats[1 - view.winner]?.name;
    if (!me) return [`${winnerName} 승리`, 'win', `${loser}이(가) 기권했어요.`];
    return iWon ? ['승리 🎉', 'win', `${R.name}이(가) 나가서 승리했습니다.`] : ['패배', 'lose', '기권했습니다.'];
  }
  const detail = `${counts} · ${REASON_LABEL[view.overReason] ?? ''}`;
  if (!me) return [`${winnerName} 승리`, 'win', detail];
  return iWon ? ['승리 🎉', 'win', detail] : ['패배', 'lose', detail];
}

function renderVersus() {
  chrome.connectionChip();
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
    for (const id of ['vs-lobby', 'vs-arena', 'vs-result', 'vs-chat', 'vs-score', 'vs-spec', 'vs-swaps', 'vs-people']) $(id).hidden = true;
    return;
  }

  const me = isPlayer();
  const L = seatL(view);
  const R = seatR(view);
  const bothSeated = L?.joined && R?.joined;

  $('vs-lobby').hidden = !(view.phase === 'lobby' && me);
  $('vs-arena').hidden = !view.puzzle;
  $('vs-result').hidden = view.phase !== 'over';
  $('vs-chat').hidden = false;
  chrome.toggleRoleUi(me);
  $('lobby-code').textContent = code ?? '';
  chrome.renderScore(view);
  chrome.renderPeople();
  chrome.renderSpectatorBar(view);
  chrome.renderSwapRequests(view);

  const tag = (el, seat, mine) => {
    el.replaceChildren();
    if (!seat?.joined) {
      el.textContent = '빈 자리';
      return;
    }
    el.append(document.createTextNode(mine ? `${seat.name} (나)` : seat.name));
    const b = document.createElement('b');
    b.textContent = String(seat.found ?? 0);
    el.append(b);
    if (seat.joined && !seat.present) el.append(span('muted', ' · 끊김'));
  };
  tag($('vs-my-tag'), L, me);
  tag($('vs-opp-tag'), R, false);

  if (view.phase === 'lobby') {
    title.textContent = me ? '상대를 기다리는 중…' : '플레이어를 기다리는 중…';
    sub.textContent = me ? '코드나 초대 링크를 보내면 바로 시작돼요.' : (vs.freeSeat !== null ? '빈 자리가 있어요 — 앉으면 바로 시작!' : '');
    $('vs-note').textContent = '';
  } else if (view.phase === 'countdown') {
    title.textContent = `${view.gameNo}번째 그림 — 준비!`;
    sub.textContent = `${S.THEME_LABEL[view.puzzle.theme]} · 다른 곳 ${view.puzzle.diffCount}곳 · 먼저 찍는 사람이 가져가요 · 제한 ${Math.round(view.timeLimitSeconds / 60)}분`;
    $('vs-note').textContent = '';
  } else if (view.phase === 'playing') {
    title.textContent = '찾는 중!';
    sub.textContent = `${view.found.length}/${view.puzzle.diffCount} 찾음 · 틀리면 1.5초 잠김`;
    $('vs-note').textContent = me ? (coarse ? '다른 곳을 탭하세요' : '다른 곳을 클릭하세요 — 어느 쪽 그림이든 괜찮아요') : '👀 관전 중 — 초록은 왼쪽 사람, 노랑은 오른쪽 사람이 찾은 곳';
  } else {
    const [badge, cls, detail] = vsResultTexts(view);
    title.textContent = view.winner === 'draw' ? '무승부' : me ? (view.winner === leftIndex() ? '승리!' : '패배') : `${view.seats[view.winner]?.name} 승리`;
    sub.textContent = detail;
    $('vs-result-badge').textContent = `${badge} · ${L.found} : ${R.found}`;
    $('vs-result-badge').className = `result ${cls}`;
    $('vs-result-detail').textContent = detail;
    $('vs-result-sub').textContent = `오답 — ${L.name} ${L.misses}번 · ${R.name} ${R.misses}번`;
    $('vs-note').textContent = view.found.length < (view.puzzle?.diffCount ?? 0) ? '못 찾은 곳은 표시하지 않아요 — 다음 그림에서 다시!' : '';
    $('btn-rematch').disabled = !me || L.rematch || !bothSeated;
    $('rematch-state').textContent = !me ? ''
      : L.rematch ? '상대의 재대결 수락을 기다리는 중…'
        : R?.rematch ? `${R.name}이(가) 재대결을 원해요!` : '';
    renderHistory(view);
  }

  chrome.renderChat(vs.chat ?? []);
  renderVersusLive();
}

/* ───────── 입력 묶기 ───────── */

function bindControls() {
  const difficulty = $('difficulty');
  const theme = $('theme');
  difficulty.value = settings.difficulty;
  theme.value = settings.theme;
  difficulty.addEventListener('change', () => {
    settings.difficulty = difficulty.value;
    saveSettings();
    if (settings.mode === 'solo') newGame();
    renderBest();
  });
  theme.addEventListener('change', () => {
    settings.theme = theme.value;
    saveSettings();
    if (settings.mode === 'solo') newGame();
  });

  for (const b of $('mode').querySelectorAll('button')) b.addEventListener('click', () => setMode(b.dataset.mode));

  $('btn-new').addEventListener('click', () => newGame());
  $('btn-again').addEventListener('click', () => newGame());
  $('btn-again-same').addEventListener('click', () => newGame(puzzle?.seed));
  $('btn-replay').addEventListener('click', () => newGame(puzzle?.seed));
  $('btn-hint').addEventListener('click', soloHint);
  $('seed-chip').addEventListener('click', () => {
    if (!puzzle) return;
    copy(`${location.origin}${location.pathname}?seed=${puzzle.seed}&d=${settings.difficulty}`, '그림 링크');
  });

  document.addEventListener('keydown', (ev) => {
    if (ev.key !== 'n' && ev.key !== 'N') return;
    if (ev.metaKey || ev.ctrlKey || ev.altKey || settings.mode !== 'solo') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
    ev.preventDefault();
    newGame();
  });
}

function bindVersus() {
  try {
    $('nickname').value = localStorage.getItem(NAME_KEY) ?? '';
  } catch { /* 무시 */ }

  $('btn-create').addEventListener('click', () => {
    startVersus({ type: 'create', name: nickname(), options: { difficulty: settings.difficulty, theme: themeOption() } });
  });
  const codeFromInput = () => {
    const code = $('join-code').value.trim().toUpperCase();
    if (code.length !== 4) {
      toast('방 코드는 4글자예요');
      return null;
    }
    return code;
  };
  $('btn-join').addEventListener('click', () => {
    const code = codeFromInput();
    if (code) startVersus({ type: 'join', name: nickname(), code });
  });
  $('btn-watch').addEventListener('click', () => {
    const code = codeFromInput();
    if (code) startVersus({ type: 'watch', name: nickname(), code });
  });
  $('join-code').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') $('btn-join').click();
  });

  bindVersusChrome({
    $,
    engine: () => engine,
    state: () => vs,
    isPlayer,
    isLive: () => isPlayer() && (vs?.view?.phase === 'countdown' || vs?.view?.phase === 'playing'),
    onLeave: () => {
      stopVersus();
      showScreen('vs-home');
    },
    copy,
    toast,
  });
}

/* ───────── 시작 ───────── */

bindControls();
bindVersus();

const params = new URLSearchParams(location.search);
const roomParam = params.get('room');
const seedParam = Number(params.get('seed'));
if (roomParam) {
  const code = roomParam.toUpperCase().slice(0, 4);
  $('join-code').value = code;
  setMode('versus', { save: false });
  if (loadToken(code, GAME)) {
    startVersus({ type: 'join', name: nickname(), code });   // 원래 역할(자리/관전)로 복귀
  } else {
    toast(`방 ${code} — 닉네임을 넣고 참가하기를 누르세요`);
    $('nickname').focus();
  }
  newGame();
} else {
  if (S.PRESETS[params.get('d')]) {
    settings.difficulty = params.get('d');
    $('difficulty').value = settings.difficulty;
  }
  newGame(seedParam > 0 ? Math.trunc(seedParam) : null);
  setMode(settings.mode, { save: false });
}
