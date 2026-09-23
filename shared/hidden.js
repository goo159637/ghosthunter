/**
 * 숨은그림찾기 — 규칙. DOM 없음, 서버·브라우저·테스트 공용.
 *
 * 퍼즐은 그림 파일 하나 + 정답 위치 JSON(`public/hidden/puzzles.json`)이다.
 *   { id, difficulty, title, image, width, height,
 *     scene: [x0, y0, x1, y1],          // 찍을 수 있는 영역(그림 좌표). 바깥은 오답으로 치지 않는다
 *     list?: { x, y0, y1 } | { x, ys } | { pts: [{x, y}] },
 *                                       // 그림 안 '찾을 물건 목록' 아이콘 위치 — 찾으면 체크 표시
 *     items: [{ name, targets: [{ x, y, r }] }] }   // 한 물건이 여러 곳에 있어도 됨(아무 곳이나 하나 찾으면 됨)
 */

export const DIFFICULTIES = [
  { id: 'easy', label: '쉬움' },
  { id: 'normal', label: '보통' },
  { id: 'hard', label: '어려움' },
  { id: 'veryhard', label: '매우 어려움' },
  { id: 'extreme', label: '극한' },
];
export const DIFF_LABEL = Object.fromEntries(DIFFICULTIES.map((d) => [d.id, d.label]));

export const MISS_PENALTY_MS = 5_000;
export const HINT_PENALTY_MS = 20_000;
export const HINT_SHOW_MS = 3_000;

/* ───────── 퍼즐 데이터 검사 ───────── */

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/** 퍼즐 하나의 문제점 목록. 비어 있으면 정상. */
export function validatePuzzle(p) {
  const bad = [];
  if (!p || typeof p !== 'object') return ['퍼즐이 객체가 아님'];
  if (typeof p.id !== 'string' || !p.id) bad.push('id 없음');
  if (!DIFF_LABEL[p.difficulty]) bad.push(`난이도 이상: ${p.difficulty}`);
  if (typeof p.title !== 'string' || !p.title) bad.push('title 없음');
  if (typeof p.image !== 'string' || !p.image.startsWith('/')) bad.push('image 경로 이상');
  if (!num(p.width) || !num(p.height) || p.width <= 0 || p.height <= 0) bad.push('width/height 이상');
  const scene = sceneOf(p);
  if (!(scene[0] < scene[2] && scene[1] < scene[3])) bad.push('scene 이상');
  if (!Array.isArray(p.items) || p.items.length === 0) bad.push('items 없음');
  else {
    const names = new Set();
    p.items.forEach((it, i) => {
      if (!it || typeof it.name !== 'string' || !it.name) bad.push(`items[${i}] name 없음`);
      else if (names.has(it.name)) bad.push(`물건 이름 중복: ${it.name}`);
      names.add(it?.name);
      if (!Array.isArray(it?.targets) || it.targets.length === 0) { bad.push(`items[${i}] targets 없음`); return; }
      it.targets.forEach((t, j) => {
        if (!num(t?.x) || !num(t?.y) || !num(t?.r) || t.r <= 0) { bad.push(`items[${i}].targets[${j}] 좌표 이상`); return; }
        if (t.x < scene[0] || t.x > scene[2] || t.y < scene[1] || t.y > scene[3]) bad.push(`${it.name} 위치가 장면 밖: ${t.x},${t.y}`);
      });
    });
  }
  if (p.list != null) {
    const l = p.list;
    const n = p.items?.length ?? 0;
    if (Array.isArray(l.pts)) { if (l.pts.length !== n || !l.pts.every((q) => num(q?.x) && num(q?.y))) bad.push('list.pts 길이/값 이상'); }
    else if (!num(l.x)) bad.push('list.x 이상');
    else if (Array.isArray(l.ys)) { if (l.ys.length !== n || !l.ys.every(num)) bad.push('list.ys 길이/값 이상'); }
    else if (!num(l.y0) || !num(l.y1)) bad.push('list.y0/y1 이상');
  }
  return bad;
}

/** 퍼즐 묶음(puzzles.json 전체)의 문제점 목록. */
export function validatePack(pack) {
  const bad = [];
  if (!pack || !Array.isArray(pack.puzzles)) return ['puzzles 배열 없음'];
  const ids = new Set();
  for (const p of pack.puzzles) {
    for (const b of validatePuzzle(p)) bad.push(`${p?.id ?? '?'}: ${b}`);
    if (ids.has(p?.id)) bad.push(`id 중복: ${p.id}`);
    ids.add(p?.id);
  }
  return bad;
}

/* ───────── 좌표 ───────── */

export function sceneOf(p) {
  return Array.isArray(p.scene) && p.scene.length === 4 && p.scene.every(num) ? p.scene : [0, 0, p.width, p.height];
}

export function inScene(p, x, y) {
  const [x0, y0, x1, y1] = sceneOf(p);
  return x >= x0 && x <= x1 && y >= y0 && y <= y1;
}

/** 그림 안 목록 아이콘 위치(물건 순서대로). list 가 없으면 null. */
export function listPositions(p) {
  if (!p.list) return null;
  const n = p.items.length;
  if (Array.isArray(p.list.pts)) return p.list.pts.map((q) => ({ x: q.x, y: q.y }));
  if (Array.isArray(p.list.ys)) return p.list.ys.map((y) => ({ x: p.list.x, y }));
  const { x, y0, y1 } = p.list;
  return p.items.map((_, i) => ({ x, y: n > 1 ? y0 + ((y1 - y0) * i) / (n - 1) : y0 }));
}

/**
 * 찍은 곳이 어느 물건인가. 원 안에 든 후보 중 중심에 가장 가까운(반지름 대비) 것.
 * 아직 못 찾은 물건을 먼저 보고, 없으면 이미 찾은 물건이라도 돌려준다(found=true).
 */
export function hitTest(p, x, y, foundSet = null) {
  let best = null;
  p.items.forEach((it, index) => {
    const found = Boolean(foundSet?.has(index));
    for (const t of it.targets) {
      const d = Math.hypot(x - t.x, y - t.y) / t.r;
      if (d > 1) continue;
      // 못 찾은 것 우선, 그다음 가까운 것
      if (!best || (best.found && !found) || (best.found === found && d < best.d)) best = { index, target: t, d, found };
    }
  });
  return best;
}

/* ───────── 한 판 ───────── */

export function createGame(puzzle, now = Date.now()) {
  return {
    puzzle,
    found: puzzle.items.map(() => null), // { x, y, r, at }
    misses: 0,
    hints: 0,
    startedAt: now,
    endedAt: null,
  };
}

export const isOver = (g) => g.endedAt !== null;
export const foundCount = (g) => g.found.filter(Boolean).length;
export const remaining = (g) => g.found.length - foundCount(g);
export const penaltyMs = (g) => g.misses * MISS_PENALTY_MS + g.hints * HINT_PENALTY_MS;

/** 기록 = 실제 걸린 시간 + 오답·힌트 벌점. */
export function elapsedMs(g, now = Date.now()) {
  return Math.max(0, (g.endedAt ?? now) - g.startedAt) + penaltyMs(g);
}

/**
 * 찍기. → { kind: 'found'|'again'|'miss'|'outside'|'over', index?, target?, done }
 *   found  : 새로 찾음
 *   again  : 이미 찾은 물건을 또 찍음(벌점 없음)
 *   miss   : 장면 안인데 아무것도 아님(벌점)
 *   outside: 장면 밖(무시)
 */
export function click(g, x, y, now = Date.now()) {
  if (isOver(g)) return { kind: 'over', done: true };
  if (!inScene(g.puzzle, x, y)) return { kind: 'outside', done: false };
  const foundSet = new Set(g.found.map((f, i) => (f ? i : -1)).filter((i) => i >= 0));
  const hit = hitTest(g.puzzle, x, y, foundSet);
  if (!hit) { g.misses += 1; return { kind: 'miss', done: false }; }
  if (hit.found) return { kind: 'again', index: hit.index, target: hit.target, done: false };
  g.found[hit.index] = { x: hit.target.x, y: hit.target.y, r: hit.target.r, at: now };
  const done = remaining(g) === 0;
  if (done) g.endedAt = now;
  return { kind: 'found', index: hit.index, target: hit.target, done };
}

/** 힌트: 아직 못 찾은 물건 하나(무작위)와 그 위치. 벌점이 붙는다. 없으면 null. */
export function hint(g, rand = Math.random) {
  if (isOver(g)) return null;
  const left = g.found.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
  if (left.length === 0) return null;
  const index = left[Math.floor(rand() * left.length)];
  const targets = g.puzzle.items[index].targets;
  const target = targets[Math.floor(rand() * targets.length)];
  g.hints += 1;
  return { index, target };
}

/** 기권/포기 없이 그냥 끝내기(다른 그림으로 갈 때). */
export function abandon(g, now = Date.now()) {
  if (!isOver(g)) g.endedAt = now;
  return g;
}

export function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
