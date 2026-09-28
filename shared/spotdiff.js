/**
 * 틀린그림찾기 — 규칙. DOM 없음, 브라우저·테스트 공용.
 *
 * 퍼즐 하나 = 왼쪽 그림 파일 + 오른쪽 그림 파일(같은 크기) + 정답 위치(`public/diff/puzzles.json`).
 *   { id, title, left, right, thumb, width, height,   // width·height 는 그림 한 장 크기
 *     diffs: [{ x, y, r, name? }] }                   // 그림 좌표. 어느 쪽을 눌러도 같은 좌표로 판정
 */

export const MISS_PENALTY_MS = 5_000;
export const HINT_PENALTY_MS = 20_000;
export const HINT_SHOW_MS = 3_000;
export const MIN_R = 14;
export const MAX_R = 160;

const num = (v) => typeof v === 'number' && Number.isFinite(v);

/* ───────── 퍼즐 데이터 검사 ───────── */

/** 퍼즐 하나의 문제점 목록. 비어 있으면 정상. */
export function validatePuzzle(p) {
  const bad = [];
  if (!p || typeof p !== 'object') return ['퍼즐이 객체가 아님'];
  if (typeof p.id !== 'string' || !p.id) bad.push('id 없음');
  if (typeof p.title !== 'string' || !p.title) bad.push('title 없음');
  for (const k of ['left', 'right']) if (typeof p[k] !== 'string' || !p[k].startsWith('/')) bad.push(`${k} 경로 이상`);
  if (!num(p.width) || !num(p.height) || p.width <= 0 || p.height <= 0) bad.push('width/height 이상');
  if (!Array.isArray(p.diffs) || p.diffs.length === 0) bad.push('diffs 없음');
  else {
    p.diffs.forEach((t, i) => {
      if (!num(t?.x) || !num(t?.y) || !num(t?.r)) { bad.push(`diffs[${i}] 좌표 이상`); return; }
      if (t.r < MIN_R || t.r > MAX_R) bad.push(`diffs[${i}] 반지름 이상: ${t.r}`);
      if (num(p.width) && (t.x < 0 || t.y < 0 || t.x > p.width || t.y > p.height)) bad.push(`diffs[${i}] 그림 밖: ${t.x},${t.y}`);
      for (let j = 0; j < i; j++) {
        const u = p.diffs[j];
        if (num(u?.x) && Math.hypot(t.x - u.x, t.y - u.y) < Math.min(t.r, u.r)) bad.push(`diffs[${j}]·[${i}] 가 겹침`);
      }
    });
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

/* ───────── 판정 ───────── */

export function inImage(p, x, y) {
  return x >= 0 && y >= 0 && x <= p.width && y <= p.height;
}

/** 찍은 곳이 어느 차이인가. 원 안에 든 것 중 중심에 (반지름 대비) 가장 가까운 것. 없으면 null. */
export function hitTest(p, x, y) {
  let best = null;
  p.diffs.forEach((t, index) => {
    const d = Math.hypot(x - t.x, y - t.y) / t.r;
    if (d <= 1 && (!best || d < best.d)) best = { index, target: t, d };
  });
  return best;
}

/* ───────── 한 판 ───────── */

export function createGame(puzzle, now = Date.now()) {
  return {
    puzzle,
    found: puzzle.diffs.map(() => null), // { at, side }
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
 * 찍기. (x, y) 는 그림 좌표(왼쪽·오른쪽 어느 쪽이든 같은 좌표계).
 * → { kind: 'found'|'again'|'miss'|'outside'|'over', index?, target?, done }
 */
export function click(g, x, y, now = Date.now(), side = 'left') {
  if (isOver(g)) return { kind: 'over', done: true };
  if (!inImage(g.puzzle, x, y)) return { kind: 'outside', done: false };
  const hit = hitTest(g.puzzle, x, y);
  if (!hit) { g.misses += 1; return { kind: 'miss', done: false }; }
  if (g.found[hit.index]) return { kind: 'again', index: hit.index, target: hit.target, done: false };
  g.found[hit.index] = { at: now, side };
  const done = remaining(g) === 0;
  if (done) g.endedAt = now;
  return { kind: 'found', index: hit.index, target: hit.target, done };
}

/** 힌트: 아직 못 찾은 차이 하나(무작위). 벌점이 붙는다. 없으면 null. */
export function hint(g, rand = Math.random) {
  if (isOver(g)) return null;
  const left = g.found.map((f, i) => (f ? -1 : i)).filter((i) => i >= 0);
  if (left.length === 0) return null;
  const index = left[Math.floor(rand() * left.length)];
  g.hints += 1;
  return { index, target: g.puzzle.diffs[index] };
}

export function abandon(g, now = Date.now()) {
  if (!isOver(g)) g.endedAt = now;
  return g;
}

export function formatMs(ms) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
