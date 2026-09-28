/**
 * 틀린그림찾기 화면. 규칙은 /shared/spotdiff.js, 정답 데이터는 /diff/puzzles.json.
 * `?p=<id>` 로 특정 그림을 바로 열고, `?edit=1` 이면 정답 편집기가 켜진다.
 *
 * 그림 파일 하나에 왼쪽·오른쪽이 나란히 들어 있다. 두 칸(pane)이 같은 파일을 서로 다른 위치로 잘라 보여 주고,
 * 어느 쪽을 눌러도 왼쪽 그림 좌표로 바꿔 판정한다. 찾은 곳은 양쪽에 같이 표시한다.
 */
import * as D from '/shared/spotdiff.js';

const $ = (id) => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const params = new URLSearchParams(location.search);
const EDIT = params.get('edit') === '1';

let pack = null;
let puzzle = null;
let game = null;
let ticker = null;
let hintBusyUntil = 0;
let zoomed = false;
let currentDifficulty = 'easy';
let layout = { s: 1, stack: false };

/* ───────── 저장 ───────── */

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 비공개 창 등 — 기록 없이 진행 */ }
  },
};
const bestOf = (id) => store.get('diff:best', {})[id] ?? null;
function saveBest(id, ms) {
  const all = store.get('diff:best', {});
  const better = all[id] == null || ms < all[id];
  if (better) { all[id] = ms; store.set('diff:best', all); }
  return better;
}

/* ───────── 작은 도우미 ───────── */

let toastTimer = null;
function toast(message) {
  const box = $('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { box.hidden = true; }, 2200);
}

function el(name, attrs = {}, text) {
  const e = document.createElementNS(SVG, name);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (text != null) e.textContent = text;
  return e;
}

const puzzlesOf = (difficulty) => pack.puzzles.filter((p) => p.difficulty === difficulty);
const byId = (id) => pack.puzzles.find((p) => p.id === id) ?? null;

/** 두 칸 */
const panes = [...document.querySelectorAll('.sd-pane')].map((pane) => ({
  side: pane.dataset.side,
  pane,
  wrap: pane.querySelector('.sd-wrap'),
  pic: pane.querySelector('.sd-pic'),
  img: pane.querySelector('.sd-img'),
  svg: pane.querySelector('.marks'),
}));

/** 칸 안 화면 좌표 → 왼쪽 그림 좌표 */
function toImage(pane, e) {
  const rect = pane.pic.getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * puzzle.half.w,
    y: ((e.clientY - rect.top) / rect.height) * puzzle.half.h,
  };
}

/* ───────── 고르기 ───────── */

function renderDifficultyTabs() {
  const box = $('difficulty');
  box.innerHTML = '';
  for (const d of D.DIFFICULTIES) {
    const n = puzzlesOf(d.id).length;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.d = d.id;
    b.textContent = n ? `${d.label} ${n}` : d.label;
    b.disabled = n === 0;
    b.title = n ? `${d.label} ${n}장` : `${d.label} · 준비 중`;
    b.setAttribute('aria-selected', String(d.id === currentDifficulty));
    b.addEventListener('click', () => selectDifficulty(d.id));
    box.appendChild(b);
  }
}

function selectDifficulty(id) {
  currentDifficulty = id;
  store.set('diff:difficulty', id);
  $('difficulty').querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.d === id)));
  renderGallery();
}

function renderGallery() {
  const box = $('gallery');
  box.innerHTML = '';
  const list = puzzlesOf(currentDifficulty);
  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'sd-empty';
    empty.textContent = '이 난이도 그림은 준비 중이에요.';
    box.appendChild(empty);
  }
  list.forEach((p, i) => {
    const best = bestOf(p.id);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `sd-card${best != null ? ' done' : ''}`;
    card.dataset.id = p.id;
    const img = document.createElement('img');
    img.src = p.thumb ?? p.image;
    img.alt = '';
    img.loading = 'lazy';
    img.decoding = 'async';
    const t = document.createElement('span');
    t.className = 't';
    t.textContent = `${i + 1}. ${p.title}`;
    const m = document.createElement('span');
    m.className = 'm';
    m.textContent = best != null ? `완료 · 최고 ${D.formatMs(best)} · 다른 곳 ${p.diffs.length}` : `다른 곳 ${p.diffs.length}개`;
    card.append(img, t, m);
    card.addEventListener('click', () => start(p));
    box.appendChild(card);
  });
  renderProgressChip(currentDifficulty);
}

function renderProgressChip(difficulty) {
  const list = puzzlesOf(difficulty);
  const done = list.filter((p) => bestOf(p.id) != null).length;
  const chip = $('progress-chip');
  chip.hidden = list.length === 0;
  chip.textContent = `${D.DIFF_LABEL[difficulty]} ${done}/${list.length} 완료`;
}

/* ───────── 한 판 ───────── */

async function start(p) {
  puzzle = p;
  game = null;
  stopTicker();
  history.replaceState(null, '', `/diff?p=${encodeURIComponent(p.id)}${EDIT ? '&edit=1' : ''}`);

  $('controls').hidden = true;
  $('stage').hidden = false;
  $('result').hidden = true;
  $('found-count').textContent = '0';
  $('total-count').textContent = String(p.diffs.length);
  $('timer').textContent = '0:00';
  $('miss-count').textContent = '오답 0';
  for (const pane of panes) {
    pane.img.alt = `${p.title} — ${pane.side === 'left' ? '왼쪽' : '오른쪽'} 그림`;
    pane.svg.setAttribute('viewBox', `0 0 ${p.half.w} ${p.half.h}`);
    pane.svg.innerHTML = '';
    if (pane.img.getAttribute('src') !== p.image) pane.img.src = p.image;
  }
  try { await Promise.all(panes.map((pane) => pane.img.decode())); } catch { /* 표시만 늦어질 뿐 */ }
  if (puzzle !== p) return; // 그새 다른 그림으로 넘어감
  fit();

  if (EDIT) { editor.load(p); return; }

  game = D.createGame(p, Date.now());
  renderStatus();
  renderMarks();
  startTicker();
}

function startTicker() {
  stopTicker();
  ticker = setInterval(renderStatus, 250);
}
function stopTicker() {
  if (ticker) clearInterval(ticker);
  ticker = null;
}

function renderStatus() {
  if (!game) return;
  $('found-count').textContent = String(D.foundCount(game));
  $('miss-count').textContent = `오답 ${game.misses}${game.hints ? ` · 힌트 ${game.hints}` : ''}`;
  $('timer').textContent = D.formatMs(D.elapsedMs(game, Date.now()));
  $('btn-hint').disabled = D.isOver(game) || Date.now() < hintBusyUntil;
}

function renderMarks() {
  for (const pane of panes) {
    pane.svg.querySelectorAll('.found').forEach((n) => n.remove());
    game.found.forEach((f, i) => {
      if (!f) return;
      const t = puzzle.diffs[i];
      pane.svg.appendChild(el('circle', { class: 'found', cx: t.x, cy: t.y, r: t.r, 'data-i': i }));
    });
  }
}

function popFound(index) {
  for (const pane of panes) {
    const node = pane.svg.querySelector(`.found[data-i="${index}"]`);
    if (node) { node.classList.add('pop'); setTimeout(() => node.classList.remove('pop'), 500); }
  }
}

function flashMiss(pane, x, y) {
  const s = Math.round(puzzle.half.w / 60);
  const g = el('path', { class: 'miss', d: `M${x - s} ${y - s} L${x + s} ${y + s} M${x + s} ${y - s} L${x - s} ${y + s}` });
  pane.svg.appendChild(g);
  setTimeout(() => g.remove(), 700);
}

function showHint(t) {
  for (const pane of panes) {
    const c = el('circle', { class: 'hint', cx: t.x, cy: t.y, r: t.r + 8 });
    pane.svg.appendChild(c);
    setTimeout(() => c.remove(), D.HINT_SHOW_MS);
  }
}

function onPaneClick(pane, e) {
  if (drag.consumeMoved()) return; // 끌어서 옮긴 뒤 놓은 것은 찍은 게 아니다
  if (EDIT) { editor.click(pane, e); return; }
  if (!game || D.isOver(game)) return;
  const { x, y } = toImage(pane, e);
  const out = D.click(game, x, y, Date.now(), pane.side);
  if (out.kind === 'miss') flashMiss(pane, x, y);
  else if (out.kind === 'again') toast('이미 찾은 곳이에요');
  else if (out.kind === 'found') {
    renderMarks();
    popFound(out.index);
    if (out.done) finish();
  }
  renderStatus();
}

function finish() {
  stopTicker();
  renderStatus();
  const ms = D.elapsedMs(game);
  const better = saveBest(puzzle.id, ms);
  const parts = [`기록 ${D.formatMs(ms)}`];
  if (game.misses) parts.push(`오답 ${game.misses} (+${(game.misses * D.MISS_PENALTY_MS) / 1000}초)`);
  if (game.hints) parts.push(`힌트 ${game.hints} (+${(game.hints * D.HINT_PENALTY_MS) / 1000}초)`);
  $('result-text').textContent = parts.join(' · ');
  $('result-best').textContent = better ? '🏆 이 그림 최고 기록!' : `최고 기록 ${D.formatMs(bestOf(puzzle.id))}`;
  $('result').hidden = false;
  $('result').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function nextPuzzle() {
  const list = puzzlesOf(puzzle.difficulty);
  const i = list.findIndex((p) => p.id === puzzle.id);
  return list[(i + 1) % list.length];
}

function backToPick() {
  if (game && !D.isOver(game)) D.abandon(game);
  stopTicker();
  game = null;
  $('stage').hidden = true;
  $('controls').hidden = false;
  history.replaceState(null, '', `/diff${EDIT ? '?edit=1' : ''}`);
  if (puzzle) currentDifficulty = puzzle.difficulty;
  renderDifficultyTabs();
  renderGallery();
}

/* ───────── 크기 맞추기 ───────── */

/**
 * 두 그림이 한 화면에 들어오게. 나란히(가로) 와 위아래(세로) 중 그림이 더 크게 보이는 쪽을 고른다.
 * 확대 모드면 각 칸의 창 크기는 그대로 두고 안쪽 그림만 2배 → 스크롤(양쪽이 같이 움직임).
 */
function fit() {
  if (!puzzle) return;
  const pair = $('pair');
  const { w, h } = puzzle.half;
  const top = Math.max(0, pair.getBoundingClientRect().top);
  const availW = pair.clientWidth || pair.getBoundingClientRect().width;
  const availH = Math.max(260, window.innerHeight - top - 12);
  const GAP = 10, TAG = 22;
  const side = Math.min((availW - GAP) / 2 / w, (availH - TAG) / h);
  // 위아래 배치는 페이지를 스크롤해서 보므로 폭에만 맞춘다(한 장이 화면 높이의 85% 는 넘지 않게)
  const stackS = Math.min(availW / w, (window.innerHeight * 0.85) / h);
  const stack = stackS > side * 1.08;
  const s = Math.max(0.05, stack ? stackS : side);
  layout = { s, stack };
  pair.classList.toggle('stack', stack);
  pair.classList.toggle('zoomed', zoomed);
  const z = zoomed ? s * 2 : s;
  for (const pane of panes) {
    pane.wrap.style.width = `${Math.floor(w * s)}px`;
    pane.wrap.style.height = `${Math.floor(h * s)}px`;
    pane.pic.style.width = `${Math.floor(w * z)}px`;
    pane.pic.style.height = `${Math.floor(h * z)}px`;
    pane.img.style.width = `${Math.round(puzzle.width * z)}px`;
    pane.img.style.height = `${Math.round(puzzle.height * z)}px`;
    const ox = pane.side === 'left' ? 0 : puzzle.right.x;
    const oy = pane.side === 'left' ? 0 : puzzle.right.y;
    pane.img.style.left = `${-Math.round(ox * z)}px`;
    pane.img.style.top = `${-Math.round(oy * z)}px`;
  }
}

function toggleZoom() {
  zoomed = !zoomed;
  $('btn-zoom').setAttribute('aria-pressed', String(zoomed));
  const wrap = panes[0].wrap;
  const cx = wrap.scrollLeft + wrap.clientWidth / 2;
  const cy = wrap.scrollTop + wrap.clientHeight / 2;
  const before = panes[0].pic.clientWidth;
  fit();
  const k = panes[0].pic.clientWidth / before;
  for (const pane of panes) {
    pane.wrap.scrollLeft = cx * k - wrap.clientWidth / 2;
    pane.wrap.scrollTop = cy * k - wrap.clientHeight / 2;
  }
}

/** 한쪽을 스크롤하면 다른 쪽도 같은 자리로 */
let syncing = false;
function bindScrollSync() {
  for (const pane of panes) {
    pane.wrap.addEventListener('scroll', () => {
      if (syncing) return;
      syncing = true;
      for (const other of panes) {
        if (other === pane) continue;
        if (other.wrap.scrollLeft !== pane.wrap.scrollLeft) other.wrap.scrollLeft = pane.wrap.scrollLeft;
        if (other.wrap.scrollTop !== pane.wrap.scrollTop) other.wrap.scrollTop = pane.wrap.scrollTop;
      }
      syncing = false;
    }, { passive: true });
  }
}

/* ───────── 끌어서 옮기기 (마우스·펜) ─────────
 * 터치는 브라우저가 알아서 스크롤한다(touch-action). 마우스는 직접: 누른 채 움직이면 스크롤,
 * 몇 px 이상 움직였으면 놓을 때의 click 은 무시한다. */
const drag = {
  active: false, moved: false, id: null, x0: 0, y0: 0, sl: 0, st: 0, wrap: null,
  THRESHOLD: 6,
  bind(wrap) {
    wrap.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      this.active = true; this.moved = false; this.id = e.pointerId; this.wrap = wrap;
      this.x0 = e.clientX; this.y0 = e.clientY; this.sl = wrap.scrollLeft; this.st = wrap.scrollTop;
    });
    wrap.addEventListener('pointermove', (e) => {
      if (!this.active || e.pointerId !== this.id || this.wrap !== wrap) return;
      const dx = e.clientX - this.x0;
      const dy = e.clientY - this.y0;
      if (!this.moved && Math.hypot(dx, dy) < this.THRESHOLD) return;
      if (!this.moved) { this.moved = true; wrap.classList.add('dragging'); try { wrap.setPointerCapture(this.id); } catch { /* 지원 안 하면 그냥 */ } }
      wrap.scrollLeft = this.sl - dx;
      wrap.scrollTop = this.st - dy;
      e.preventDefault();
    });
    const end = (e) => {
      if (!this.active || e.pointerId !== this.id || this.wrap !== wrap) return;
      this.active = false;
      wrap.classList.remove('dragging');
      try { wrap.releasePointerCapture(this.id); } catch { /* 이미 풀렸음 */ }
    };
    wrap.addEventListener('pointerup', end);
    wrap.addEventListener('pointercancel', end);
    wrap.addEventListener('lostpointercapture', end);
  },
  consumeMoved() { const m = this.moved; this.moved = false; return m; },
};

/* ───────── 편집기 ───────── */

const editor = {
  p: null,
  undo: [],
  load(p) {
    this.p = JSON.parse(JSON.stringify(p));
    this.undo = [];
    this.render();
    $('editor').hidden = false;
  },
  snapshot() { this.undo.push(JSON.stringify(this.p)); if (this.undo.length > 50) this.undo.shift(); },
  render() {
    for (const pane of panes) {
      pane.svg.innerHTML = '';
      this.p.diffs.forEach((t, i) => {
        pane.svg.appendChild(el('circle', { class: 'edit', cx: t.x, cy: t.y, r: t.r }));
        pane.svg.appendChild(el('text', { class: 'edit-no', x: t.x + t.r - 4, y: t.y - t.r + 6 }, String(i + 1)));
      });
    }
    $('ed-out').value = this.json();
    $('total-count').textContent = String(this.p.diffs.length);
    $('found-count').textContent = '–';
  },
  json() {
    const p = this.p;
    const head = ['id', 'difficulty', 'title', 'image', 'thumb', 'width', 'height', 'half', 'right', 'note']
      .filter((k) => p[k] !== undefined)
      .map((k) => `  "${k}": ${JSON.stringify(p[k])}`);
    const diffs = p.diffs.map((t) => `    ${JSON.stringify(t)}`).join(',\n');
    return `{\n${head.join(',\n')},\n  "diffs": [\n${diffs}\n  ]\n}`;
  },
  click(pane, e) {
    if (!this.p) return;
    const { x, y } = toImage(pane, e);
    const hit = D.hitTest(this.p, x, y);
    this.snapshot();
    if (hit) {
      this.p.diffs.splice(hit.index, 1);
      toast(`${hit.index + 1}번 정답 지움`);
    } else {
      const r = Math.min(D.MAX_R, Math.max(D.MIN_R, Number($('ed-r').value) || 40));
      this.p.diffs.push({ x: Math.round(x), y: Math.round(y), r });
    }
    this.render();
  },
  undoLast() {
    const s = this.undo.pop();
    if (!s) return;
    this.p = JSON.parse(s);
    this.render();
  },
  async copy() {
    const text = this.json();
    try { await navigator.clipboard.writeText(text); toast('JSON 을 복사했어요'); } catch { $('ed-out').select(); toast('아래 칸에서 직접 복사하세요'); }
  },
};

/* ───────── 연결 ───────── */

async function main() {
  const res = await fetch('/diff/puzzles.json', { cache: 'no-cache' });
  pack = await res.json();
  const problems = D.validatePack(pack);
  if (problems.length) console.warn('puzzles.json 문제:', problems);

  const wanted = byId(params.get('p'));
  const remembered = store.get('diff:difficulty', null);
  const firstAvailable = D.DIFFICULTIES.find((d) => puzzlesOf(d.id).length > 0)?.id ?? 'easy';
  currentDifficulty = wanted?.difficulty ?? (remembered && puzzlesOf(remembered).length ? remembered : firstAvailable);
  renderDifficultyTabs();
  renderGallery();

  $('btn-pick').addEventListener('click', backToPick);
  $('btn-again').addEventListener('click', () => start(puzzle));
  $('btn-next').addEventListener('click', () => start(nextPuzzle()));
  $('btn-zoom').addEventListener('click', toggleZoom);
  $('btn-hint').addEventListener('click', () => {
    if (!game || D.isOver(game) || Date.now() < hintBusyUntil) return;
    const h = D.hint(game);
    if (!h) return;
    hintBusyUntil = Date.now() + D.HINT_SHOW_MS;
    showHint(h.target);
    renderStatus();
  });
  for (const pane of panes) {
    pane.pic.addEventListener('click', (e) => onPaneClick(pane, e));
    drag.bind(pane.wrap);
  }
  bindScrollSync();
  window.addEventListener('resize', fit);

  if (EDIT) {
    $('ed-undo').addEventListener('click', () => editor.undoLast());
    $('ed-copy').addEventListener('click', () => editor.copy());
    $('btn-hint').hidden = true;
  }

  if (wanted) start(wanted);
}

main().catch((err) => {
  console.error(err);
  toast('그림 목록을 불러오지 못했어요');
});
