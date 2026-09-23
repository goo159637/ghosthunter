/**
 * 틀린그림찾기 · 숨은 고양이 찾기 — 퍼즐 만들기, 판정, 그리기.
 *
 * 장면은 shared/scene.js 가 seed 로 만든다 (손그림 카툰 장면, 물체 50~70개).
 *   mode 'diff' : 같은 장면 두 장에서 N 개 물체가 다르다 (색·크기·위치·좌우반전·회전·개수·삭제).
 *   mode 'cats' : 장면 한 장에 고양이 N 마리가 숨어 있다 (창턱·상자·지붕·소파·나무 위…).
 * 정답(targets)은 diffs 라는 이름으로 들고, 브라우저엔 publicPuzzle() 로 정답을 빼고 보낸다.
 * 의존성 없는 순수 모듈 — 서버와 브라우저가 같이 쓴다.
 */
import * as SC from './scene.js';

export const WIDTH = SC.WIDTH;
export const HEIGHT = SC.HEIGHT;
export const THEMES = SC.THEMES;
export const THEME_LABEL = SC.THEME_LABEL;
export const MODES = ['diff', 'cats'];
export const MODE_LABEL = { diff: '틀린그림찾기', cats: '숨은 고양이 찾기' };

export const PRESETS = {
  diff: { easy: { targets: 5, objects: 45 }, normal: { targets: 7, objects: 55 }, hard: { targets: 10, objects: 65 } },
  cats: { easy: { targets: 6, objects: 45 }, normal: { targets: 10, objects: 55 }, hard: { targets: 15, objects: 65 } },
};
export const MAX_TARGETS = 20;
export const { makeRng } = SC;

export function randomSeed(rand = Math.random) {
  return 1 + Math.floor(rand() * 2147483646);
}

const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const intBetween = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const r1 = (n) => Math.round(n * 10) / 10;

export function normalizeOptions(opts = {}) {
  const mode = MODES.includes(opts.mode) ? opts.mode : 'diff';
  const preset = PRESETS[mode][opts.difficulty] ? opts.difficulty : null;
  const raw = Number(opts.targets ?? opts.diffs);
  const targets = preset ? PRESETS[mode][preset].targets : Number.isFinite(raw) ? Math.min(MAX_TARGETS, Math.max(1, Math.trunc(raw))) : PRESETS[mode].normal.targets;
  const objects = preset ? PRESETS[mode][preset].objects : PRESETS[mode].normal.objects;
  const theme = THEMES.includes(opts.theme) ? opts.theme : null;   // null 이면 seed 로 고른다
  return { mode, difficulty: preset ?? 'custom', targets, diffs: targets, objects, theme };
}

/* ───────── 차이 만들기 ───────── */

const CAT_KINDS = ['color', 'size', 'move', 'flip', 'remove'];

function kindsOf(o) {
  return o.type === 'cat' ? CAT_KINDS : SC.PROPS[o.type].kinds;
}

/** 물체 하나에 차이를 하나 만든다. 못 만들면 null. */
function mutate(rng, o, kind) {
  const m = { ...o };
  switch (kind) {
    case 'color': {
      const list = o.type === 'cat' ? SC.PALETTE.cat : o.type === 'cloud' ? ['#fffdf7', '#ffe3d8', '#fff2b2', '#d8e2dc'] : SC.PALETTE.any;
      m.color = SC.otherColor(rng, list, o.color);
      return m;
    }
    case 'size':
      m.size = r1(o.size * (rng() < 0.5 ? 0.72 : 1.32));
      return m;
    case 'move': {
      const d = Math.max(20, SC.objectRadius(o) * 0.9);
      const a = rng() * Math.PI * 2;
      m.x = r1(Math.min(WIDTH - 20, Math.max(20, o.x + Math.cos(a) * d)));
      m.y = r1(Math.min(HEIGHT - 10, Math.max(30, o.y + Math.sin(a) * d * 0.5)));
      if (Math.hypot(m.x - o.x, m.y - o.y) < d * 0.5) return null;
      return m;
    }
    case 'flip':
      m.flip = !o.flip;
      return m;
    case 'rotate':
      m.rot = (o.rot ?? 0) + (rng() < 0.5 ? -1 : 1) * intBetween(rng, 30, 60);
      return m;
    case 'count': {
      const c = SC.PROPS[o.type].count;
      if (!c) return null;
      const options = [];
      for (let v = c.min; v <= c.max; v += c.step) if (v !== o[c.key]) options.push(v);
      if (!options.length) return null;
      m[c.key] = pick(rng, options);
      return m;
    }
    case 'remove':
      m.hidden = true;
      return m;
    default:
      return null;
  }
}

/** 하늘 층 물체가 건물 뒤에 완전히 가려졌는지 (거리 테마). */
function hiddenBehindBuilding(objects, o) {
  if (o.type === 'cat' || SC.PROPS[o.type].layer !== 0) return false;
  const c = SC.objectCenter(o);
  return objects.some((b) => b.type === 'building' && Math.abs(b.x - c.x) < b.size * 0.5 && c.y > b.y - b.size / b.aspect - 10);
}

/** 고양이가 뒤에 그려지는 큰 소품에 거의 가려지는지 */
function catOccluded(objects, cat) {
  const order = SC.drawOrder(objects);
  const at = order.indexOf(cat);
  const c = SC.objectCenter(cat);
  for (let i = at + 1; i < order.length; i++) {
    const o = order[i];
    if (o.type === 'cat' || o.hidden) continue;
    const r = SC.objectRadius(o);
    if (r < cat.size * 0.8) continue;
    const oc = SC.objectCenter(o);
    if (Math.hypot(oc.x - c.x, oc.y - c.y) < r * 0.75) return true;
  }
  return false;
}

/* ───────── 퍼즐 ───────── */

/**
 * 퍼즐 하나. seed 가 같으면 언제 어디서 만들어도 똑같다.
 * @returns {{ seed, mode, theme, width, height, background, left, right, diffs: {index, kind, cx, cy, r}[] }}
 *   diffs 는 정답 목록 (cats 모드에서는 고양이 하나가 항목 하나, kind 'cat'). right 는 cats 모드에선 left 와 같다.
 */
export function generatePuzzle(opts = {}) {
  const seed = Number(opts.seed) > 0 ? Math.trunc(Number(opts.seed)) : randomSeed();
  const o = normalizeOptions(opts);
  const scene = SC.buildScene(seed, { theme: o.theme, objects: o.objects });
  const rng = scene.rng;
  const objects = scene.objects;
  const base = { seed, mode: o.mode, theme: scene.theme, width: WIDTH, height: HEIGHT, background: scene.background };

  if (o.mode === 'cats') {
    const spots = SC.catSpots(objects).sort(() => rng() - 0.5);
    const usedHosts = new Map();
    const targets = [];
    for (const s of spots) {
      if (targets.length >= o.targets) break;
      if ((usedHosts.get(s.hostIndex) ?? 0) >= 2) continue;   // 한 소품에 두 마리까지
      const cat = SC.makeCat(rng, s, s.hostIndex);
      objects.push(cat);
      const c = SC.objectCenter(cat);
      if (catOccluded(objects, cat) || targets.some((t) => Math.hypot(t.cx - c.x, t.cy - c.y) < 30)) {
        objects.pop();
        continue;
      }
      usedHosts.set(s.hostIndex, (usedHosts.get(s.hostIndex) ?? 0) + 1);
      targets.push({ index: objects.length - 1, kind: 'cat', cx: r1(c.x), cy: r1(c.y), r: Math.max(18, r1(cat.size * 0.62)) });
    }
    // 자리가 모자라면 바닥을 걷는 고양이로 채운다
    let guard = 0;
    while (targets.length < o.targets && guard++ < 200) {
      const zone = pick(rng, SC.GROUND[scene.theme]);
      const cat = {
        type: 'cat', x: r1(zone[0] + rng() * (zone[1] - zone[0])), y: r1(zone[2] + rng() * (zone[3] - zone[2])), size: r1(22 + rng() * 10),
        pose: pick(rng, ['walk', 'sit', 'loaf']), color: pick(rng, SC.PALETTE.cat), pattern: pick(rng, SC.CAT_PATTERNS), flip: rng() < 0.5, host: null,
      };
      objects.push(cat);
      const c = SC.objectCenter(cat);
      if (targets.some((t) => Math.hypot(t.cx - c.x, t.cy - c.y) < 34)) {
        objects.pop();
        continue;
      }
      targets.push({ index: objects.length - 1, kind: 'cat', cx: r1(c.x), cy: r1(c.y), r: Math.max(18, r1(cat.size * 0.62)) });
    }
    return { ...base, left: objects, right: objects, diffs: targets };
  }

  // 틀린그림: 재미로 고양이 몇 마리를 장면에 넣고 (이 고양이도 차이 대상이 될 수 있다)
  const spots = SC.catSpots(objects).sort(() => rng() - 0.5);
  const wantCats = intBetween(rng, 2, 4);
  let cats = 0;
  for (const s of spots) {
    if (cats >= wantCats) break;
    const cat = SC.makeCat(rng, s, s.hostIndex);
    objects.push(cat);
    if (catOccluded(objects, cat)) objects.pop();
    else cats++;
  }
  const left = objects;
  const right = objects.map((x) => ({ ...x }));
  const order = left.map((_, i) => i).sort(() => rng() - 0.5);
  const diffs = [];
  const excluded = new Set();
  for (const index of order) {
    if (diffs.length >= o.targets) break;
    if (excluded.has(index)) continue;
    const obj = left[index];
    if (obj.hidden || hiddenBehindBuilding(left, obj)) continue;
    const oc = SC.objectCenter(obj);
    if (oc.x < 24 || oc.x > WIDTH - 24 || oc.y < 16 || oc.y > HEIGHT - 12) continue;   // 화면 가장자리 밖은 대상에서 뺀다
    const kinds = [...kindsOf(obj)].sort(() => rng() - 0.5);
    let done = false;
    for (const kind of kinds) {
      if (kind === 'remove' && obj.type !== 'cat' && left.some((c) => c.type === 'cat' && c.host === index)) continue;   // 고양이가 앉아 있는 건 없애지 않는다
      const m = mutate(rng, obj, kind);
      if (!m) continue;
      const changedSide = rng() < 0.5 ? 'left' : 'right';   // 바뀐 쪽을 무작위로
      if (changedSide === 'right') right[index] = m;
      else left[index] = m;
      const a = SC.objectCenter(left[index]);
      const b = SC.objectCenter(right[index]);
      const spread = Math.hypot(a.x - b.x, a.y - b.y) / 2;
      const r = Math.max(SC.objectRadius(left[index]), SC.objectRadius(right[index])) + spread + 10;
      diffs.push({ index, kind, cx: r1((a.x + b.x) / 2), cy: r1((a.y + b.y) / 2), r: Math.min(90, Math.max(24, r1(r))) });
      // 같은 자리의 고양이/주인은 다른 차이로 겹치지 않게
      if (obj.type === 'cat' && obj.host !== null && obj.host !== undefined) excluded.add(obj.host);
      left.forEach((c, i) => { if (c.type === 'cat' && c.host === index) excluded.add(i); });
      done = true;
      break;
    }
    if (!done) excluded.add(index);
  }
  return { ...base, left, right, diffs };
}

/** (x, y) 가 어느 정답 안인지. 여러 개에 겹치면 가장 가까운 것. 없으면 -1. */
export function hitTest(puzzle, x, y) {
  let best = -1;
  let bestDist = Infinity;
  puzzle.diffs.forEach((d, i) => {
    const dist = Math.hypot(d.cx - x, d.cy - y);
    if (dist <= d.r && dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  });
  return best;
}

/** 장면 하나(왼쪽 또는 오른쪽)를 SVG 문자열로. */
export function renderScene(puzzle, side, { id = '' } = {}) {
  const objects = side === 'right' ? puzzle.right : puzzle.left;
  const label = puzzle.mode === 'cats' ? '숨은 고양이 그림' : `틀린그림 ${side === 'left' ? '왼쪽' : '오른쪽'}`;
  return SC.renderScene({ theme: puzzle.theme, background: puzzle.background, objects, seed: puzzle.seed, id, label });
}

/** 브라우저에 보낼 수 있는, 정답이 빠진 퍼즐. */
export function publicPuzzle(puzzle) {
  const { diffs, ...rest } = puzzle;
  return { ...rest, diffCount: diffs.length };
}
