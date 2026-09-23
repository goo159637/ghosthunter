/**
 * 숨은그림찾기 화면. 규칙은 /shared/hidden.js, 정답 데이터는 /hidden/puzzles.json.
 * `?p=<id>` 로 특정 그림을 바로 열고, `?edit=1` 이면 정답 편집기가 켜진다.
 */
import * as H from '/shared/hidden.js';

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

/* ───────── 저장 ───────── */

const store = {
  get(key, fallback) {
    try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* 비공개 창 등 — 기록 없이 진행 */ }
  },
};
const bestOf = (id) => store.get('hidden:best', {})[id] ?? null;
function saveBest(id, ms) {
  const all = store.get('hidden:best', {});
  const better = all[id] == null || ms < all[id];
  if (better) { all[id] = ms; store.set('hidden:best', all); }
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

/** 화면 좌표 → 그림 좌표 */
function toImage(e) {
  const rect = $('img').getBoundingClientRect();
  return {
    x: ((e.clientX - rect.left) / rect.width) * puzzle.width,
    y: ((e.clientY - rect.top) / rect.height) * puzzle.height,
  };
}

/* ───────── 고르기 ───────── */

let currentDifficulty = 'easy';

function renderDifficultyTabs() {
  const box = $('difficulty');
  box.innerHTML = '';
  for (const d of H.DIFFICULTIES) {
    const n = puzzlesOf(d.id).length;
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'tab');
    b.dataset.d = d.id;
    b.textContent = n ? `${d.label} ${n}` : `${d.label}`;
    b.disabled = n === 0;
    b.title = n ? `${d.label} ${n}장` : `${d.label} · 준비 중`;
    b.setAttribute('aria-selected', String(d.id === currentDifficulty));
    b.addEventListener('click', () => selectDifficulty(d.id));
    box.appendChild(b);
  }
}

function selectDifficulty(id) {
  currentDifficulty = id;
  store.set('hidden:difficulty', id);
  $('difficulty').querySelectorAll('button').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.d === id)));
  renderGallery();
}

function renderGallery() {
  const box = $('gallery');
  box.innerHTML = '';
  const list = puzzlesOf(currentDifficulty);
  if (list.length === 0) {
    const empty = document.createElement('p');
    empty.className = 'hp-empty';
    empty.textContent = '이 난이도 그림은 준비 중이에요.';
    box.appendChild(empty);
  }
  list.forEach((p, i) => {
    const best = bestOf(p.id);
    const card = document.createElement('button');
    card.type = 'button';
    card.className = `hp-card${best != null ? ' done' : ''}`;
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
    m.textContent = best != null ? `최고 ${H.formatMs(best)} · 물건 ${p.items.length}` : `물건 ${p.items.length}개`;
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
  chip.textContent = `${H.DIFF_LABEL[difficulty]} ${done}/${list.length} 완료`;
}

/* ───────── 한 판 ───────── */

async function start(p) {
  puzzle = p;
  game = null;
  stopTicker();
  history.replaceState(null, '', `/hidden?p=${encodeURIComponent(p.id)}${EDIT ? '&edit=1' : ''}`);

  $('controls').hidden = true;
  $('stage').hidden = false;
  $('result').hidden = true;
  $('found-count').textContent = '0';
  $('total-count').textContent = String(p.items.length);
  $('timer').textContent = '0:00';
  $('miss-count').textContent = '오답 0';
  $('items').innerHTML = '';
  const img = $('img');
  img.alt = p.title;
  if (img.getAttribute('src') !== p.image) {
    img.src = p.image;
    try { await img.decode(); } catch { /* 표시만 늦어질 뿐 */ }
  }
  const svg = $('marks');
  svg.setAttribute('viewBox', `0 0 ${p.width} ${p.height}`);
  svg.innerHTML = '';
  fit();

  if (EDIT) { editor.load(p); return; }

  game = H.createGame(p, Date.now());
  $('total-count').textContent = String(p.items.length);
  renderItems();
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
  $('found-count').textContent = String(H.foundCount(game));
  $('miss-count').textContent = `오답 ${game.misses}${game.hints ? ` · 힌트 ${game.hints}` : ''}`;
  $('timer').textContent = H.formatMs(H.elapsedMs(game, Date.now()));
  $('btn-hint').disabled = H.isOver(game) || Date.now() < hintBusyUntil;
}

function renderItems() {
  const box = $('items');
  box.innerHTML = '';
  puzzle.items.forEach((it, i) => {
    const chip = document.createElement('span');
    chip.className = `chip${game?.found[i] ? ' done' : ''}`;
    chip.textContent = it.name;
    chip.dataset.index = String(i);
    box.appendChild(chip);
  });
}

function renderMarks() {
  const svg = $('marks');
  svg.querySelectorAll('.found, .listcheck').forEach((n) => n.remove());
  const pts = H.listPositions(puzzle);
  game.found.forEach((f, i) => {
    if (!f) return;
    const g = el('g', { class: 'found' });
    g.appendChild(el('circle', { cx: f.x, cy: f.y, r: f.r }));
    svg.appendChild(g);
    if (pts?.[i]) {
      const c = el('g', { class: 'listcheck' });
      c.appendChild(el('circle', { cx: pts[i].x, cy: pts[i].y, r: 20 }));
      c.appendChild(el('path', { d: `M${pts[i].x - 9} ${pts[i].y + 1} l7 7 l12 -14` }));
      svg.appendChild(c);
    }
  });
}

function popFound(index) {
  // 방금 찾은 원만 잠깐 튀게
  const nodes = $('marks').querySelectorAll('.found');
  const order = game.found.map((f, i) => (f ? i : -1)).filter((i) => i >= 0);
  const node = nodes[order.indexOf(index)];
  if (node) { node.classList.add('pop'); setTimeout(() => node.classList.remove('pop'), 500); }
}

function flashMiss(x, y) {
  const g = el('g', { class: 'miss' });
  const s = Math.round(puzzle.width / 70);
  g.appendChild(el('path', { d: `M${x - s} ${y - s} L${x + s} ${y + s} M${x + s} ${y - s} L${x - s} ${y + s}` }));
  $('marks').appendChild(g);
  setTimeout(() => g.remove(), 700);
}

function showHint(t) {
  const c = el('circle', { class: 'hint', cx: t.x, cy: t.y, r: t.r + 8 });
  $('marks').appendChild(c);
  setTimeout(() => c.remove(), H.HINT_SHOW_MS);
}

function onPictureClick(e) {
  if (EDIT) { editor.click(e); return; }
  if (!game || H.isOver(game)) return;
  const { x, y } = toImage(e);
  const out = H.click(game, x, y, Date.now());
  if (out.kind === 'miss') flashMiss(x, y);
  else if (out.kind === 'again') toast(`${puzzle.items[out.index].name}은(는) 이미 찾았어요`);
  else if (out.kind === 'found') {
    renderMarks();
    popFound(out.index);
    renderItems();
    if (out.done) finish();
  }
  renderStatus();
}

function finish() {
  stopTicker();
  renderStatus();
  const ms = H.elapsedMs(game);
  const better = saveBest(puzzle.id, ms);
  const parts = [`기록 ${H.formatMs(ms)}`];
  if (game.misses) parts.push(`오답 ${game.misses} (+${(game.misses * H.MISS_PENALTY_MS) / 1000}초)`);
  if (game.hints) parts.push(`힌트 ${game.hints} (+${(game.hints * H.HINT_PENALTY_MS) / 1000}초)`);
  $('result-text').textContent = parts.join(' · ');
  $('result-best').textContent = better ? '🏆 이 그림 최고 기록!' : `최고 기록 ${H.formatMs(bestOf(puzzle.id))}`;
  $('result').hidden = false;
  $('result').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function nextPuzzle() {
  const list = puzzlesOf(puzzle.difficulty);
  const i = list.findIndex((p) => p.id === puzzle.id);
  return list[(i + 1) % list.length];
}

function backToPick() {
  if (game && !H.isOver(game)) H.abandon(game);
  stopTicker();
  game = null;
  $('stage').hidden = true;
  $('controls').hidden = false;
  history.replaceState(null, '', `/hidden${EDIT ? '?edit=1' : ''}`);
  if (puzzle) currentDifficulty = puzzle.difficulty;
  renderDifficultyTabs();
  renderGallery();
}

/* ───────── 크기 맞추기 ───────── */

/** 그림 전체가 한 화면에 들어오게. 확대 모드면 2배로 키우고 스크롤. */
function fit() {
  if (!puzzle) return;
  const wrap = $('pic-wrap');
  const pic = $('pic');
  const top = wrap.getBoundingClientRect().top;
  const availH = Math.max(240, window.innerHeight - Math.max(0, top) - 12);
  const availW = wrap.clientWidth || wrap.getBoundingClientRect().width;
  const w = Math.min(availW, (availH * puzzle.width) / puzzle.height);
  wrap.style.maxHeight = `${availH}px`;
  pic.style.width = `${Math.floor(zoomed ? Math.max(w * 2, availW) : w)}px`;
}

function toggleZoom() {
  zoomed = !zoomed;
  $('btn-zoom').setAttribute('aria-pressed', String(zoomed));
  const wrap = $('pic-wrap');
  const cx = wrap.scrollLeft + wrap.clientWidth / 2;
  const cy = wrap.scrollTop + wrap.clientHeight / 2;
  const before = $('pic').clientWidth;
  fit();
  const k = $('pic').clientWidth / before;
  wrap.scrollLeft = cx * k - wrap.clientWidth / 2;
  wrap.scrollTop = cy * k - wrap.clientHeight / 2;
}

/* ───────── 편집기 ───────── */

const editor = {
  p: null,
  undo: [],
  load(p) {
    this.p = JSON.parse(JSON.stringify(p));
    this.undo = [];
    this.fillItems();
    this.render();
    $('items').innerHTML = '';
    $('editor').hidden = false;
  },
  fillItems(keep) {
    const sel = $('ed-item');
    const prev = keep ?? sel.value;
    sel.innerHTML = '';
    this.p.items.forEach((it, i) => {
      const opt = document.createElement('option');
      opt.value = String(i);
      opt.textContent = `${i + 1}. ${it.name} (${it.targets.length})`;
      sel.appendChild(opt);
    });
    if (prev !== '' && Number(prev) < this.p.items.length) sel.value = prev;
  },
  snapshot() { this.undo.push(JSON.stringify(this.p)); if (this.undo.length > 50) this.undo.shift(); },
  render() {
    const svg = $('marks');
    svg.innerHTML = '';
    const sel = Number($('ed-item').value);
    const [x0, y0, x1, y1] = H.sceneOf(this.p);
    svg.appendChild(el('rect', { class: 'scene', x: x0, y: y0, width: x1 - x0, height: y1 - y0 }));
    (H.listPositions(this.p) ?? []).forEach((q) => {
      const g = el('g', { class: 'listdot' });
      g.appendChild(el('circle', { cx: q.x, cy: q.y, r: 16 }));
      svg.appendChild(g);
    });
    this.p.items.forEach((it, i) => {
      for (const t of it.targets) {
        const g = el('g', { class: `edit${i === sel ? ' sel' : ''}` });
        g.appendChild(el('circle', { cx: t.x, cy: t.y, r: t.r }));
        g.appendChild(el('text', { x: t.x + t.r - 4, y: t.y - t.r + 6 }, String(i + 1)));
        svg.appendChild(g);
      }
    });
    $('ed-out').value = this.json();
  },
  json() {
    const p = this.p;
    const head = ['id', 'difficulty', 'title', 'image', 'width', 'height', 'scene', 'list', 'note']
      .filter((k) => p[k] !== undefined)
      .map((k) => `  "${k}": ${JSON.stringify(p[k])}`);
    const items = p.items.map((it) => `    ${JSON.stringify(it)}`).join(',\n');
    return `{\n${head.join(',\n')},\n  "items": [\n${items}\n  ]\n}`;
  },
  click(e) {
    if (!this.p) return;
    const { x, y } = toImage(e);
    const hit = H.hitTest(this.p, x, y);
    this.snapshot();
    if (hit) {
      const list = this.p.items[hit.index].targets;
      list.splice(list.indexOf(hit.target), 1);
      toast(`${this.p.items[hit.index].name} 정답 하나 지움`);
    } else {
      const i = Number($('ed-item').value);
      if (!Number.isInteger(i) || !this.p.items[i]) { this.undo.pop(); toast('먼저 물건을 고르세요'); return; }
      const r = Math.max(8, Number($('ed-r').value) || 35);
      this.p.items[i].targets.push({ x: Math.round(x), y: Math.round(y), r });
    }
    this.fillItems();
    this.render();
  },
  addItem() {
    const name = $('ed-new').value.trim();
    if (!name) return;
    if (this.p.items.some((it) => it.name === name)) { toast('이미 있는 이름이에요'); return; }
    this.snapshot();
    this.p.items.push({ name, targets: [] });
    $('ed-new').value = '';
    this.fillItems(String(this.p.items.length - 1));
    this.render();
  },
  delItem() {
    const i = Number($('ed-item').value);
    if (!this.p.items[i]) return;
    this.snapshot();
    this.p.items.splice(i, 1);
    if (Array.isArray(this.p.list?.pts)) this.p.list.pts.splice(i, 1);
    else if (Array.isArray(this.p.list?.ys)) this.p.list.ys.splice(i, 1);
    this.fillItems('0');
    this.render();
  },
  undoLast() {
    const s = this.undo.pop();
    if (!s) return;
    this.p = JSON.parse(s);
    this.fillItems();
    this.render();
  },
  async copy() {
    const text = this.json();
    try { await navigator.clipboard.writeText(text); toast('JSON 을 복사했어요'); } catch { $('ed-out').select(); toast('아래 칸에서 직접 복사하세요'); }
  },
};

/* ───────── 연결 ───────── */

async function main() {
  const res = await fetch('/hidden/puzzles.json', { cache: 'no-cache' });
  pack = await res.json();
  const problems = H.validatePack(pack);
  if (problems.length) console.warn('puzzles.json 문제:', problems);

  const wanted = byId(params.get('p'));
  const remembered = store.get('hidden:difficulty', null);
  const firstAvailable = H.DIFFICULTIES.find((d) => puzzlesOf(d.id).length > 0)?.id ?? 'easy';
  currentDifficulty = wanted?.difficulty ?? (remembered && puzzlesOf(remembered).length ? remembered : firstAvailable);
  renderDifficultyTabs();
  renderGallery();

  $('btn-pick').addEventListener('click', backToPick);
  $('btn-again').addEventListener('click', () => start(puzzle));
  $('btn-next').addEventListener('click', () => start(nextPuzzle()));
  $('btn-zoom').addEventListener('click', toggleZoom);
  $('btn-hint').addEventListener('click', () => {
    if (!game || H.isOver(game) || Date.now() < hintBusyUntil) return;
    const h = H.hint(game);
    if (!h) return;
    hintBusyUntil = Date.now() + H.HINT_SHOW_MS;
    showHint(h.target);
    toast(`${puzzle.items[h.index].name}은(는) 여기!`);
    renderStatus();
  });
  $('pic').addEventListener('click', onPictureClick);
  window.addEventListener('resize', fit);

  if (EDIT) {
    $('ed-item').addEventListener('change', () => editor.render());
    $('ed-add').addEventListener('click', () => editor.addItem());
    $('ed-del').addEventListener('click', () => editor.delItem());
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
