/**
 * 장면 그리기 엔진 — 손그림 느낌의 빽빽한 카툰 장면을 SVG 문자열로 만든다.
 *
 * 스타일: 잉크 외곽선(굵기 고정) + 살짝 떨리는 선(displacement 필터) + 종이 질감 + 따뜻한 팔레트.
 * 구성: 테마마다 배경 층과 소품(prop) 배치 규칙이 있고, 소품은 단위 좌표(대략 -0.5~0.5)로 그려
 *       translate/scale 로 자리에 놓는다. 소품은 고양이가 숨을 수 있는 자리(spots)를 내놓는다.
 * 의존성 없는 순수 모듈 — DOM 을 모른다. 서버와 브라우저가 같이 쓴다.
 */

export const WIDTH = 640;
export const HEIGHT = 480;
export const THEMES = ['town', 'room', 'harbor', 'garden'];
export const THEME_LABEL = { town: '거리', room: '방', harbor: '항구', garden: '정원' };

export const INK = '#2a2118';
const PAPER = '#f6efe3';

/* ───────── 난수 ───────── */

export function makeRng(seed) {
  let a = (Number(seed) >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const between = (rng, lo, hi) => lo + rng() * (hi - lo);
const intBetween = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const chance = (rng, p) => rng() < p;
const r1 = (n) => Math.round(n * 100) / 100;

/* ───────── 팔레트 ───────── */

export const PALETTE = {
  warm: ['#e07a5f', '#f2a65a', '#e9c46a', '#d4a373', '#c9184a', '#f4978e'],
  cool: ['#6d9dc5', '#81b29a', '#8ecae6', '#457b9d', '#9d8fd6', '#5fa8a3'],
  soft: ['#f7d6a5', '#ffe3d8', '#d9ead3', '#cfe2f3', '#e6d5f5', '#fff2b2'],
  wall: ['#f3d9b1', '#e8c4a0', '#f2e8cf', '#d8e2dc', '#f9dcc4', '#e3d5ca', '#dbe7e4', '#f5cac3'],
  roof: ['#9a3b3b', '#5c4a3f', '#3d5a6c', '#7b4b2a', '#405d3a', '#6b4c7a'],
  cat: ['#e8933a', '#9a9aa5', '#35302f', '#f4f1ea', '#8a5a3c', '#efd9b0', '#c9c1b6'],
  cloth: ['#e07a5f', '#3d405b', '#81b29a', '#f2cc8f', '#6d9dc5', '#c9184a', '#9d8fd6', '#f4978e'],
  any: ['#e07a5f', '#f2a65a', '#e9c46a', '#81b29a', '#6d9dc5', '#9d8fd6', '#c9184a', '#457b9d', '#5fa8a3', '#d4a373'],
};
export function otherColor(rng, list, current) {
  const options = list.filter((c) => c !== current);
  return pick(rng, options.length ? options : list);
}

/* ───────── 도형 도우미 (단위 좌표) ───────── */

const A = (obj) => Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== '').map(([k, v]) => `${k}="${v}"`).join(' ');
const rect = (x, y, w, h, fill, extra = {}) => `<rect ${A({ x: r1(x), y: r1(y), width: r1(w), height: r1(h), fill, ...extra })}/>`;
const circ = (cx, cy, r, fill, extra = {}) => `<circle ${A({ cx: r1(cx), cy: r1(cy), r: r1(r), fill, ...extra })}/>`;
const ell = (cx, cy, rx, ry, fill, extra = {}) => `<ellipse ${A({ cx: r1(cx), cy: r1(cy), rx: r1(rx), ry: r1(ry), fill, ...extra })}/>`;
const path = (d, fill, extra = {}) => `<path ${A({ d, fill, ...extra })}/>`;
const poly = (pts, fill, extra = {}) => `<polygon ${A({ points: pts.map(([x, y]) => `${r1(x)},${r1(y)}`).join(' '), fill, ...extra })}/>`;
const line = (x1, y1, x2, y2, extra = {}) => `<line ${A({ x1: r1(x1), y1: r1(y1), x2: r1(x2), y2: r1(y2), fill: 'none', ...extra })}/>`;
const NOINK = { class: 'noink' };
const THIN = { class: 'thin' };
const shade = (d) => path(d, 'rgba(42,33,24,.14)', NOINK);
const darker = (hex, f = 0.78) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
};
const lighter = (hex, f = 0.35) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v + (255 - v) * f))).toString(16).padStart(2, '0');
  return `#${c(n >> 16)}${c((n >> 8) & 255)}${c(n & 255)}`;
};

/* ───────── 고양이 ─────────
 * 포즈: sit(앉기) · loaf(식빵) · sleep(잠) · peek(고개 내밀기 — 턱선 y=0 위로 머리만) · walk(옆모습)
 * 무늬: solid · tabby(줄무늬) · tuxedo(흰 가슴) · patch(얼룩)
 * 원점은 발밑 가운데, 오른쪽을 본다. 높이 대략 1.
 */
function catFace(cx, cy, s, color) {
  const eye = color === '#35302f' ? '#f2e94e' : '#2a2118';
  return circ(cx - 0.09 * s, cy - 0.02 * s, 0.035 * s, eye, NOINK)
    + circ(cx + 0.09 * s, cy - 0.02 * s, 0.035 * s, eye, NOINK)
    + path(`M${r1(cx - 0.03 * s)},${r1(cy + 0.06 * s)} L${r1(cx + 0.03 * s)},${r1(cy + 0.06 * s)} L${r1(cx)},${r1(cy + 0.1 * s)} Z`, '#e5989b', NOINK)
    + line(cx - 0.12 * s, cy + 0.07 * s, cx - 0.3 * s, cy + 0.03 * s, THIN)
    + line(cx - 0.12 * s, cy + 0.1 * s, cx - 0.3 * s, cy + 0.12 * s, THIN)
    + line(cx + 0.12 * s, cy + 0.07 * s, cx + 0.3 * s, cy + 0.03 * s, THIN)
    + line(cx + 0.12 * s, cy + 0.1 * s, cx + 0.3 * s, cy + 0.12 * s, THIN);
}
function catHead(cx, cy, s, color, pattern) {
  let out = poly([[cx - 0.2 * s, cy - 0.1 * s], [cx - 0.26 * s, cy - 0.38 * s], [cx - 0.05 * s, cy - 0.22 * s]], color)
    + poly([[cx + 0.2 * s, cy - 0.1 * s], [cx + 0.26 * s, cy - 0.38 * s], [cx + 0.05 * s, cy - 0.22 * s]], color)
    + circ(cx, cy, 0.25 * s, color);
  if (pattern === 'tabby') out += path(`M${r1(cx - 0.1 * s)},${r1(cy - 0.24 * s)} l0.05,${r1(-0.12 * s)} M${r1(cx)},${r1(cy - 0.25 * s)} l0,${r1(-0.12 * s)} M${r1(cx + 0.1 * s)},${r1(cy - 0.24 * s)} l-0.05,${r1(-0.12 * s)}`, 'none', { class: 'thin', stroke: darker(color, 0.6) });
  if (pattern === 'patch') out += circ(cx + 0.12 * s, cy - 0.12 * s, 0.09 * s, darker(color, 0.65), NOINK);
  return out + catFace(cx, cy, s, color);
}
function catPattern(pattern, color, bodyPath) {
  if (pattern === 'tabby') return path(bodyPath, 'none', { class: 'thin', stroke: darker(color, 0.6) });
  return '';
}
export function renderCat(o) {
  const c = o.color;
  const p = o.pattern;
  const white = '#f4f1ea';
  let out = '';
  switch (o.pose) {
    case 'loaf':
      out += path('M-0.45,0 Q-0.5,-0.42 0,-0.44 Q0.5,-0.42 0.45,0 Z', c)
        + catPattern(p, c, 'M-0.3,-0.3 q0.05,0.15 0,0.25 M-0.12,-0.36 q0.05,0.18 0,0.3 M0.06,-0.36 q0.05,0.18 0,0.3')
        + (p === 'tuxedo' ? ell(0.1, -0.12, 0.16, 0.1, white, NOINK) : '')
        + path('M-0.42,-0.1 q-0.25,0.08 -0.2,0.1 q0.1,0.02 0.22,-0.06', c)
        + catHead(0.22, -0.55, 1, c, p);
      break;
    case 'sleep':
      out += ell(0, -0.22, 0.48, 0.24, c)
        + catPattern(p, c, 'M-0.25,-0.4 q0.04,0.12 0,0.2 M-0.05,-0.44 q0.04,0.14 0,0.24 M0.15,-0.42 q0.04,0.12 0,0.2')
        + path('M0.4,-0.1 q0.25,-0.05 0.2,-0.28 q-0.05,-0.12 -0.2,-0.05', c)
        + circ(-0.2, -0.36, 0.2, c)
        + poly([[-0.36, -0.44], [-0.42, -0.66], [-0.22, -0.54]], c) + poly([[-0.04, -0.44], [0.02, -0.66], [-0.18, -0.54]], c)
        + path('M-0.3,-0.36 q0.05,0.04 0.1,0 M-0.16,-0.36 q0.05,0.04 0.1,0', 'none', THIN);
      break;
    case 'peek':
      // y=0 이 가장자리(창턱·상자 위). 발 두 개가 가장자리를 잡고 머리가 위로.
      out += circ(-0.16, -0.02, 0.09, c) + circ(0.16, -0.02, 0.09, c)
        + catHead(0, -0.3, 1.1, c, p);
      break;
    case 'walk':
      out += ell(0, -0.32, 0.42, 0.2, c)
        + catPattern(p, c, 'M-0.2,-0.48 q0.04,0.14 0,0.24 M0,-0.5 q0.04,0.14 0,0.26 M0.2,-0.48 q0.04,0.14 0,0.24')
        + (p === 'tuxedo' ? ell(0.2, -0.24, 0.16, 0.1, white, NOINK) : '')
        + rect(-0.32, -0.2, 0.1, 0.2, c) + rect(-0.12, -0.2, 0.1, 0.2, c) + rect(0.08, -0.2, 0.1, 0.2, c) + rect(0.26, -0.2, 0.1, 0.2, c)
        + path('M-0.4,-0.36 q-0.3,-0.1 -0.22,-0.5 q0.06,-0.14 0.12,-0.05', c)
        + catHead(0.42, -0.58, 0.9, c, p);
      break;
    default: // sit
      out += path('M-0.3,0 Q-0.36,-0.5 0,-0.62 Q0.36,-0.5 0.3,0 Z', c)
        + catPattern(p, c, 'M-0.2,-0.42 q0.05,0.15 0,0.25 M-0.02,-0.5 q0.05,0.18 0,0.3 M0.16,-0.42 q0.05,0.15 0,0.25')
        + (p === 'tuxedo' ? ell(0.02, -0.28, 0.14, 0.18, white, NOINK) : '')
        + path('M0.26,-0.06 q0.3,0.02 0.3,-0.3 q0,-0.12 -0.1,-0.1', c)
        + ell(-0.15, -0.02, 0.1, 0.05, c) + ell(0.15, -0.02, 0.1, 0.05, c)
        + catHead(0.04, -0.78, 1, c, p);
  }
  return out;
}
export const CAT_POSES = ['sit', 'loaf', 'sleep', 'peek', 'walk'];
export const CAT_PATTERNS = ['solid', 'tabby', 'tuxedo', 'patch'];

/* ───────── 작은 부품 ───────── */

function windowUnit(x, y, w, h, kind, rng, palette) {
  // 창문: 틀 + 내용물 (커튼 / 화분 / 램프 / 어둠 / 고양이 자리는 spot 으로 따로)
  const glass = kind === 'dark' ? '#3c4b5e' : '#cfe7f5';
  let out = rect(x, y, w, h, glass);
  if (kind === 'curtain') out += path(`M${r1(x)},${r1(y)} q${r1(w * 0.18)},${r1(h * 0.5)} 0,${r1(h)} Z`, palette.curtain, NOINK) + path(`M${r1(x + w)},${r1(y)} q${r1(-w * 0.18)},${r1(h * 0.5)} 0,${r1(h)} Z`, palette.curtain, NOINK);
  if (kind === 'plant') out += rect(x + w * 0.35, y + h * 0.65, w * 0.3, h * 0.3, '#c5713f') + circ(x + w * 0.5, y + h * 0.5, w * 0.22, '#5f9a5c');
  if (kind === 'lamp') out += circ(x + w * 0.5, y + h * 0.45, w * 0.18, '#ffd166') + rect(x + w * 0.44, y + h * 0.62, w * 0.12, h * 0.3, '#8a5a3c');
  if (kind === 'blind') for (let i = 1; i < 5; i++) out += line(x, y + (h * i) / 5, x + w, y + (h * i) / 5, THIN);
  out += line(x + w / 2, y, x + w / 2, y + h, THIN) + line(x, y + h / 2, x + w, y + h / 2, THIN);
  out += rect(x - w * 0.08, y + h, w * 1.16, h * 0.08, '#f2e8cf');
  return out;
}

function person(o) {
  const skin = o.skin;
  const s = o.shirt;
  const legs = o.pants;
  let out = rect(-0.12, -0.42, 0.1, 0.42, legs) + rect(0.02, -0.42, 0.1, 0.42, legs)
    + path('M-0.18,-0.42 L-0.14,-0.82 Q0,-0.9 0.14,-0.82 L0.18,-0.42 Z', s)
    + circ(0, -0.95, 0.13, skin);
  if (o.hair === 'long') out += path('M-0.14,-0.95 q0,-0.2 0.14,-0.2 q0.14,0 0.14,0.2 l0,0.12 q-0.14,-0.06 -0.28,0 Z', o.hairColor, NOINK);
  else out += path('M-0.13,-0.98 q0.13,-0.16 0.26,0 Z', o.hairColor, NOINK);
  if (o.hat === 'cap') out += path('M-0.15,-1.02 q0.15,-0.14 0.3,0 l0.08,0.02 l-0.38,0 Z', o.hatColor);
  if (o.hat === 'beanie') out += path('M-0.14,-1 q0.14,-0.2 0.28,0 Z', o.hatColor) + circ(0, -1.14, 0.03, o.hatColor);
  if (o.prop === 'bag') out += rect(0.14, -0.6, 0.14, 0.18, o.hatColor) ;
  if (o.prop === 'umbrella') out += line(0.22, -0.3, 0.22, -1.1, {}) + path('M-0.08,-1.1 q0.3,-0.24 0.6,0 Z', o.hatColor);
  if (o.prop === 'balloon') out += line(0.2, -0.6, 0.3, -1.2, THIN) + ell(0.3, -1.32, 0.12, 0.15, o.hatColor);
  if (o.prop === 'coffee') out += rect(0.14, -0.62, 0.08, 0.12, '#f4f1ea');
  return out;
}

/* ───────── 소품 정의 ─────────
 * place(rng) → 파라미터 · render(o) → SVG · r → 판정 반지름 계수 · layer → 그리는 순서
 * kinds → 틀린그림 차이로 쓸 수 있는 종류 · count → 개수 차이 파라미터 · spots(o) → 고양이 자리(단위 좌표)
 */
export const PROPS = {
  /* ── 하늘 ── */
  sun: {
    layer: 0, r: 0.8, kinds: ['color', 'size', 'move'],
    place: (rng) => ({ color: pick(rng, ['#f9c74f', '#f8961e', '#ffd166']) }),
    render: (o) => circ(0, 0, 0.42, o.color) + Array.from({ length: 10 }, (_, i) => { const a = (i / 10) * Math.PI * 2; return line(Math.cos(a) * 0.55, Math.sin(a) * 0.55, Math.cos(a) * 0.75, Math.sin(a) * 0.75, { stroke: o.color, 'stroke-width': 3, 'stroke-linecap': 'round', class: 'noink' }); }).join(''),
  },
  cloud: {
    layer: 0, r: 0.75, kinds: ['size', 'move', 'count', 'remove', 'flip'], count: { key: 'bumps', min: 3, max: 5, step: 1 },
    place: (rng) => ({ color: '#fffdf7', bumps: intBetween(rng, 3, 5), flip: chance(rng, 0.5) }),
    render: (o) => {
      let d = 'M-0.65,0.12 ';
      for (let i = 0; i < o.bumps; i++) {
        const x0 = -0.65 + (1.3 * i) / o.bumps;
        const x1 = -0.65 + (1.3 * (i + 1)) / o.bumps;
        const h = i % 2 === 0 ? 0.32 : 0.42;
        d += `Q${r1((x0 + x1) / 2)},${r1(-h)} ${r1(x1)},0.12 `;
      }
      return path(d + 'Z', o.color);
    },
  },
  bird: {
    layer: 2, r: 0.5, kinds: ['size', 'move', 'flip', 'remove'],
    place: (rng) => ({ flip: chance(rng, 0.5) }),
    render: () => path('M-0.5,0 Q-0.25,-0.4 0,0 Q0.25,-0.4 0.5,0', 'none', { 'stroke-width': 2.2 }),
  },
  gull: {
    layer: 2, r: 0.55, kinds: ['size', 'move', 'flip', 'remove'],
    place: (rng) => ({ flip: chance(rng, 0.5) }),
    render: () => path('M-0.5,-0.05 Q-0.25,-0.35 0,-0.05 Q0.25,-0.35 0.5,-0.05', 'none', { 'stroke-width': 2.2 }) + circ(0, -0.02, 0.07, '#fffdf7') + poly([[0.07, -0.02], [0.18, 0], [0.07, 0.03]], '#f8961e', NOINK),
  },
  balloon: {
    layer: 2, r: 0.55, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, PALETTE.any) }),
    render: (o) => ell(0, -0.3, 0.26, 0.34, o.color) + poly([[-0.05, 0.02], [0.05, 0.02], [0, 0.08]], o.color) + path('M0,0.08 q0.1,0.3 0,0.6', 'none', THIN) + circ(-0.08, -0.42, 0.05, '#fff', { class: 'noink', opacity: 0.6 }),
  },
  kite: {
    layer: 2, r: 0.6, kinds: ['color', 'size', 'move', 'rotate', 'remove'],
    place: (rng) => ({ color: pick(rng, PALETTE.any), rot: intBetween(rng, -25, 25) }),
    render: (o) => poly([[0, -0.5], [0.3, -0.1], [0, 0.4], [-0.3, -0.1]], o.color) + line(-0.3, -0.1, 0.3, -0.1, THIN) + line(0, -0.5, 0, 0.4, THIN) + path('M0,0.4 q0.15,0.2 0,0.4 q-0.15,0.2 0.05,0.4', 'none', THIN),
  },
  smoke: {
    layer: 0, r: 0.4, kinds: ['size', 'remove'],
    place: () => ({}),
    render: () => circ(0, 0, 0.16, '#e6e2da', NOINK) + circ(0.12, -0.22, 0.13, '#e6e2da', NOINK) + circ(0.28, -0.42, 0.1, '#e6e2da', NOINK),
  },

  /* ── 거리 ── */
  building: {
    layer: 1, r: 0.55, kinds: ['color', 'count'], count: { key: 'rows', min: 2, max: 4, step: 1 },
    place: (rng) => {
      const kinds = ['curtain', 'plant', 'lamp', 'dark', 'blind', 'plain'];
      return {
        color: pick(rng, PALETTE.wall), roof: pick(rng, PALETTE.roof), roofKind: pick(rng, ['flat', 'gable', 'mansard']),
        cols: intBetween(rng, 2, 3), rows: intBetween(rng, 2, 4), aspect: between(rng, 0.45, 0.75),
        wins: Array.from({ length: 12 }, () => pick(rng, kinds)), curtain: pick(rng, PALETTE.warm),
        shop: chance(rng, 0.75), awning: pick(rng, PALETTE.any), sign: pick(rng, ['cup', 'bread', 'book', 'fish', 'flower', 'hat']), signColor: pick(rng, PALETTE.soft),
        chimney: chance(rng, 0.6), antenna: chance(rng, 0.4),
      };
    },
    // 단위: 폭 1 (x -0.5~0.5), 높이 = 1/aspect, 바닥 y=0
    render: (o) => {
      const H = 1 / o.aspect;
      const w = 1;
      let out = rect(-0.5, -H, w, H, o.color);
      // 지붕
      if (o.roofKind === 'gable') out += poly([[-0.56, -H], [0, -H - 0.28], [0.56, -H]], o.roof);
      else if (o.roofKind === 'mansard') out += path(`M-0.56,${r1(-H)} L-0.46,${r1(-H - 0.18)} L0.46,${r1(-H - 0.18)} L0.56,${r1(-H)} Z`, o.roof);
      else out += rect(-0.54, -H - 0.06, 1.08, 0.08, o.roof);
      if (o.chimney) out += rect(0.28, -H - 0.3, 0.12, 0.3, darker(o.color));
      if (o.antenna) out += line(-0.3, -H - 0.08, -0.3, -H - 0.36, {}) + line(-0.4, -H - 0.3, -0.2, -H - 0.3, THIN);
      // 창문
      const shopH = o.shop ? 0.42 : 0;
      const top = -H + 0.16;
      const bottom = -shopH - 0.1;
      const rowH = (bottom - top) / o.rows;
      const colW = w / o.cols;
      let k = 0;
      for (let r = 0; r < o.rows; r++) {
        for (let c = 0; c < o.cols; c++) {
          const x = -0.5 + colW * c + colW * 0.25;
          const y = top + rowH * r + rowH * 0.15;
          out += windowUnit(x, y, colW * 0.5, rowH * 0.6, o.wins[k++ % o.wins.length], null, { curtain: o.curtain });
        }
      }
      // 1층 상점
      if (o.shop) {
        out += rect(-0.5, -0.42, 1, 0.42, darker(o.color, 0.9));
        out += rect(-0.42, -0.34, 0.5, 0.3, '#cfe7f5');        // 진열창
        out += rect(0.16, -0.36, 0.22, 0.36, '#7b4b2a') + circ(0.34, -0.18, 0.02, '#f2cc8f', NOINK); // 문
        // 차양
        let awn = '';
        for (let i = 0; i < 6; i++) awn += rect(-0.55 + i * (1.1 / 6), -0.5, 1.1 / 6, 0.1, i % 2 ? '#fffdf7' : o.awning, NOINK);
        out += awn + path('M-0.55,-0.4 q0.09,0.06 0.18,0 q0.09,0.06 0.18,0 q0.09,0.06 0.18,0 q0.09,0.06 0.18,0 q0.09,0.06 0.18,0 q0.09,0.06 0.18,0', 'none', {}) + line(-0.55, -0.5, 0.55, -0.5, {});
        // 간판
        out += rect(-0.3, -0.62, 0.6, 0.11, o.signColor) + signIcon(o.sign, 0, -0.565, 0.08);
        // 진열창 안 물건
        out += rect(-0.38, -0.12, 0.12, 0.08, '#e07a5f', NOINK) + rect(-0.22, -0.16, 0.1, 0.12, '#81b29a', NOINK) + circ(-0.06, -0.1, 0.05, '#f2cc8f', NOINK);
      } else {
        out += rect(-0.14, -0.36, 0.28, 0.36, '#7b4b2a') + circ(0.08, -0.18, 0.02, '#f2cc8f', NOINK);
      }
      return out;
    },
    spots: (o) => {
      const H = 1 / o.aspect;
      const s = [{ x: 0.06, y: -H - (o.roofKind === 'flat' ? 0.06 : o.roofKind === 'gable' ? 0.1 : 0.18), pose: 'sit', scale: 0.26 }];
      const shopH = o.shop ? 0.42 : 0;
      const top = -H + 0.16;
      const bottom = -shopH - 0.1;
      const rowH = (bottom - top) / o.rows;
      const colW = 1 / o.cols;
      for (let r = 0; r < o.rows; r++) for (let c = 0; c < o.cols; c++) {
        const x = -0.5 + colW * c + colW * 0.5;
        const y = top + rowH * r + rowH * 0.15 + rowH * 0.6;
        s.push({ x, y, pose: 'peek', scale: Math.min(colW * 0.42, rowH * 0.5) });
      }
      if (o.shop) s.push({ x: -0.5, y: -0.5, pose: 'loaf', scale: 0.2 });   // 차양 위
      return s;
    },
  },
  lamp: {
    layer: 3, r: 0.5, kinds: ['size', 'move', 'remove'],
    place: () => ({}),
    render: () => rect(-0.03, -0.9, 0.06, 0.9, '#3d405b') + rect(-0.12, 0, 0.24, 0.06, '#3d405b') + path('M-0.12,-0.9 l0.24,0 l-0.04,-0.2 l-0.16,0 Z', '#ffd166') + circ(0, -1.1, 0.05, '#3d405b'),
  },
  tree: {
    layer: 3, r: 0.6, kinds: ['color', 'size', 'move', 'count', 'remove'], count: { key: 'fruits', min: 0, max: 5, step: 2 },
    place: (rng) => ({ color: pick(rng, ['#5f9a5c', '#7fb069', '#3f7d4e', '#9bbf65']), fruit: pick(rng, ['#e07a5f', '#f2a65a', '#c9184a']), fruits: pick(rng, [0, 3, 5]) }),
    render: (o) => rect(-0.06, -0.4, 0.12, 0.4, '#8a5a3c') + path('M-0.42,-0.4 q-0.12,-0.3 0.1,-0.45 q0.05,-0.3 0.32,-0.25 q0.3,-0.05 0.35,0.25 q0.2,0.15 0.05,0.45 Z', o.color)
      + [[-0.2, -0.6], [0.15, -0.75], [0.25, -0.5], [-0.05, -0.9], [0.05, -0.55]].slice(0, o.fruits).map(([x, y]) => circ(x, y, 0.05, o.fruit, NOINK)).join(''),
    spots: () => [{ x: 0, y: -0.86, pose: 'sleep', scale: 0.4 }, { x: 0.2, y: 0, pose: 'sit', scale: 0.32 }],
  },
  bush: {
    layer: 3, r: 0.55, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#5f9a5c', '#7fb069', '#3f7d4e']) }),
    render: (o) => path('M-0.5,0 q-0.1,-0.35 0.15,-0.32 q0.1,-0.3 0.35,-0.15 q0.3,0 0.5,0.47 Z', o.color) + circ(-0.2, -0.16, 0.04, '#f4978e', NOINK) + circ(0.15, -0.26, 0.04, '#f4978e', NOINK),
    spots: () => [{ x: 0.1, y: -0.3, pose: 'peek', scale: 0.4 }],
  },
  bench: {
    layer: 3, r: 0.55, kinds: ['color', 'size', 'move', 'remove', 'flip'],
    place: (rng) => ({ color: pick(rng, ['#a26b3d', '#6b4c7a', '#3d5a6c']), flip: chance(rng, 0.5) }),
    render: (o) => rect(-0.5, -0.32, 1, 0.08, o.color) + rect(-0.5, -0.2, 1, 0.08, o.color) + rect(-0.5, -0.5, 1, 0.06, o.color) + rect(-0.42, -0.2, 0.05, 0.2, '#3d405b') + rect(0.37, -0.2, 0.05, 0.2, '#3d405b') + rect(-0.42, -0.5, 0.05, 0.2, '#3d405b') + rect(0.37, -0.5, 0.05, 0.2, '#3d405b'),
    spots: () => [{ x: 0.1, y: -0.32, pose: 'loaf', scale: 0.4 }, { x: -0.05, y: 0, pose: 'sleep', scale: 0.36 }],
  },
  bike: {
    layer: 3, r: 0.55, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, PALETTE.any), flip: chance(rng, 0.5) }),
    render: (o) => circ(-0.3, -0.2, 0.2, 'none', {}) + circ(0.3, -0.2, 0.2, 'none', {}) + path('M-0.3,-0.2 L-0.05,-0.5 L0.3,-0.2 L0.05,-0.2 L-0.05,-0.5 M0.05,-0.2 L0.18,-0.55 L0.3,-0.2 M-0.05,-0.5 l-0.1,-0.06 M0.18,-0.55 l0.1,-0.04', 'none', { stroke: o.color, 'stroke-width': 2.4 }) + rect(-0.16, -0.58, 0.12, 0.04, INK),
  },
  car: {
    layer: 4, r: 0.55, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, PALETTE.any), flip: chance(rng, 0.5) }),
    render: (o) => path('M-0.5,-0.08 L-0.5,-0.32 L-0.3,-0.36 L-0.18,-0.58 L0.22,-0.58 L0.4,-0.36 L0.5,-0.32 L0.5,-0.08 Z', o.color) + rect(-0.14, -0.54, 0.16, 0.16, '#cfe7f5') + rect(0.06, -0.54, 0.14, 0.16, '#cfe7f5') + circ(-0.28, -0.06, 0.12, '#3d405b') + circ(0.28, -0.06, 0.12, '#3d405b') + circ(-0.28, -0.06, 0.05, '#c9c1b6', NOINK) + circ(0.28, -0.06, 0.05, '#c9c1b6', NOINK) + rect(0.44, -0.26, 0.06, 0.06, '#ffd166', NOINK),
    spots: () => [{ x: 0.02, y: -0.58, pose: 'loaf', scale: 0.3 }],
  },
  box: {
    layer: 3, r: 0.55, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#d4a373', '#c9a27e', '#e0b98a']), open: chance(rng, 0.7) }),
    render: (o) => rect(-0.4, -0.5, 0.8, 0.5, o.color) + line(-0.4, -0.25, 0.4, -0.25, THIN) + (o.open ? path('M-0.4,-0.5 l-0.14,-0.2 l0.22,0 Z', darker(o.color)) + path('M0.4,-0.5 l0.14,-0.2 l-0.22,0 Z', darker(o.color)) : line(0, -0.5, 0, 0, THIN)),
    spots: (o) => [{ x: 0, y: -0.5, pose: o.open ? 'peek' : 'sit', scale: 0.5 }],
  },
  mailbox: {
    layer: 3, r: 0.5, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#c9184a', '#457b9d', '#3d405b']) }),
    render: (o) => rect(-0.05, -0.5, 0.1, 0.5, '#3d405b') + rect(-0.22, -0.82, 0.44, 0.34, o.color, { rx: 0.08 }) + rect(-0.12, -0.7, 0.24, 0.04, '#fffdf7', NOINK),
  },
  hydrant: {
    layer: 3, r: 0.45, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#e63946', '#f8961e', '#ffd166']) }),
    render: (o) => rect(-0.14, -0.5, 0.28, 0.5, o.color, { rx: 0.06 }) + rect(-0.24, -0.34, 0.48, 0.1, o.color) + circ(0, -0.54, 0.1, o.color),
  },
  trash: {
    layer: 3, r: 0.45, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#81b29a', '#6d9dc5', '#3d405b']) }),
    render: (o) => rect(-0.2, -0.6, 0.4, 0.6, o.color) + rect(-0.24, -0.66, 0.48, 0.08, darker(o.color)) + line(-0.08, -0.5, -0.08, -0.1, THIN) + line(0.08, -0.5, 0.08, -0.1, THIN),
    spots: () => [{ x: 0, y: -0.66, pose: 'peek', scale: 0.32 }],
  },
  pot: {
    layer: 3, r: 0.45, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#c5713f', '#e07a5f', '#3d405b', '#f2cc8f']), flower: pick(rng, ['#f4978e', '#c9184a', '#ffd166', '#9d8fd6']) }),
    render: (o) => path('M-0.25,-0.3 l0.5,0 l-0.06,0.3 l-0.38,0 Z', o.color) + rect(-0.02, -0.55, 0.04, 0.25, '#3f7d4e', NOINK) + circ(0, -0.6, 0.12, o.flower) + circ(0, -0.6, 0.04, '#ffd166', NOINK),
  },
  person: {
    layer: 4, r: 0.45, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({
      color: pick(rng, PALETTE.cloth), skin: pick(rng, ['#f6d3b5', '#e8b58a', '#c68a5a', '#8d5a3a']), pants: pick(rng, ['#3d405b', '#457b9d', '#6b4c7a', '#8a5a3c']),
      hair: pick(rng, ['short', 'long']), hairColor: pick(rng, ['#2a2118', '#8a5a3c', '#e9c46a', '#c9184a']), hat: pick(rng, ['none', 'none', 'cap', 'beanie']), hatColor: pick(rng, PALETTE.any),
      prop: pick(rng, ['none', 'bag', 'umbrella', 'balloon', 'coffee', 'none']), flip: chance(rng, 0.5),
    }),
    render: (o) => person({ ...o, shirt: o.color }),
  },
  dog: {
    layer: 4, r: 0.5, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#d4a373', '#8a5a3c', '#f4f1ea', '#3d405b']), flip: chance(rng, 0.5) }),
    render: (o) => ell(0, -0.28, 0.32, 0.16, o.color) + rect(-0.24, -0.16, 0.08, 0.16, o.color) + rect(0.12, -0.16, 0.08, 0.16, o.color) + circ(0.34, -0.42, 0.14, o.color) + ell(0.3, -0.5, 0.06, 0.1, darker(o.color), NOINK) + circ(0.46, -0.4, 0.03, INK, NOINK) + path('M-0.3,-0.32 q-0.15,-0.2 -0.1,-0.3', 'none', {}),
  },
  scooter: {
    layer: 4, r: 0.5, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, PALETTE.any), flip: chance(rng, 0.5) }),
    render: (o) => circ(-0.32, -0.14, 0.14, '#3d405b') + circ(0.32, -0.14, 0.14, '#3d405b') + path('M-0.3,-0.3 L-0.1,-0.3 L0.1,-0.5 L0.34,-0.5 L0.42,-0.3 L0.34,-0.14', o.color, {}) + line(0.36, -0.5, 0.42, -0.72, {}) + rect(-0.16, -0.58, 0.28, 0.1, darker(o.color)),
  },
  signpost: {
    layer: 3, r: 0.45, kinds: ['color', 'size', 'move', 'remove', 'flip'],
    place: (rng) => ({ color: pick(rng, PALETTE.any), flip: chance(rng, 0.5) }),
    render: (o) => rect(-0.03, -0.9, 0.06, 0.9, '#8a5a3c') + poly([[-0.05, -0.9], [0.3, -0.9], [0.4, -0.8], [0.3, -0.7], [-0.05, -0.7]], o.color) + poly([[0.05, -0.68], [-0.3, -0.68], [-0.4, -0.58], [-0.3, -0.48], [0.05, -0.48]], darker(o.color)),
  },

  /* ── 방 ── */
  wallwindow: {
    layer: 1, r: 0.55, kinds: ['color', 'size', 'count'], count: { key: 'panes', min: 1, max: 2, step: 1 },
    place: (rng) => ({ color: pick(rng, PALETTE.warm), panes: intBetween(rng, 1, 2), sky: pick(rng, ['#bde0fe', '#ffe3d8', '#1d3557']) }),
    render: (o) => rect(-0.5, -1, 1, 0.9, o.sky) + (o.sky === '#1d3557' ? circ(0.2, -0.75, 0.1, '#ffe8a3', NOINK) : circ(0.25, -0.8, 0.1, '#ffd166', NOINK) + path('M-0.4,-0.4 q0.12,-0.12 0.24,0 q0.1,-0.1 0.2,0 Z', '#fffdf7', NOINK))
      + (o.panes === 2 ? line(0, -1, 0, -0.1, {}) : '') + line(-0.5, -0.55, 0.5, -0.55, {}) + rect(-0.54, -1.04, 1.08, 0.06, '#8a5a3c') + rect(-0.6, -0.1, 1.2, 0.08, '#8a5a3c')
      + path('M-0.54,-1 q0.2,0.5 0,0.9 Z', o.color, NOINK) + path('M0.54,-1 q-0.2,0.5 0,0.9 Z', o.color, NOINK),
    spots: () => [{ x: 0.05, y: -0.1, pose: 'sit', scale: 0.34 }],
  },
  picture: {
    layer: 1, r: 0.5, kinds: ['color', 'size', 'move', 'remove', 'rotate'],
    place: (rng) => ({ color: pick(rng, ['#8a5a3c', '#3d405b', '#e9c46a', '#f4f1ea']), art: pick(rng, ['hills', 'cat', 'boat', 'sun', 'abstract']), rot: 0, bg: pick(rng, PALETTE.soft) }),
    render: (o) => rect(-0.5, -0.4, 1, 0.8, o.color) + rect(-0.42, -0.32, 0.84, 0.64, o.bg, NOINK) + pictureArt(o.art),
  },
  clock: {
    layer: 1, r: 0.5, kinds: ['color', 'size', 'move', 'remove', 'rotate'],
    place: (rng) => ({ color: pick(rng, ['#8a5a3c', '#3d405b', '#c9184a']), rot: intBetween(rng, 0, 300) }),
    render: (o) => circ(0, 0, 0.5, o.color) + circ(0, 0, 0.4, '#fffdf7') + line(0, 0, 0, -0.28, { 'stroke-width': 2.4 }) + line(0, 0, 0.2, 0.1, { 'stroke-width': 2.4 }) + circ(0, 0, 0.03, INK, NOINK),
  },
  shelf: {
    layer: 1, r: 0.55, kinds: ['color', 'size', 'count', 'remove'], count: { key: 'items', min: 2, max: 5, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#8a5a3c', '#d4a373', '#3d405b']), items: intBetween(rng, 2, 5), palette: Array.from({ length: 6 }, () => pick(rng, PALETTE.any)) }),
    render: (o) => {
      let out = rect(-0.5, -0.04, 1, 0.08, o.color);
      const kinds = ['book', 'jar', 'plant', 'cup', 'trophy', 'book'];
      for (let i = 0; i < o.items; i++) {
        const x = -0.42 + i * (0.84 / o.items) + 0.08;
        const k = kinds[i % kinds.length];
        const c = o.palette[i];
        if (k === 'book') out += rect(x - 0.06, -0.3, 0.05, 0.26, c) + rect(x, -0.34, 0.05, 0.3, darker(c)) + rect(x + 0.06, -0.28, 0.05, 0.24, lighter(c));
        else if (k === 'jar') out += rect(x - 0.06, -0.26, 0.14, 0.22, '#cfe7f5', { rx: 0.03 }) + rect(x - 0.05, -0.3, 0.12, 0.05, c);
        else if (k === 'plant') out += rect(x - 0.05, -0.16, 0.12, 0.12, '#c5713f') + circ(x + 0.01, -0.22, 0.09, '#5f9a5c');
        else if (k === 'cup') out += rect(x - 0.06, -0.18, 0.12, 0.14, c) + path(`M${r1(x + 0.06)},${r1(-0.15)} q0.08,0.04 0,0.08`, 'none', THIN);
        else out += rect(x - 0.04, -0.2, 0.1, 0.16, '#ffd166') + rect(x - 0.06, -0.06, 0.14, 0.03, '#8a5a3c');
      }
      return out;
    },
    spots: () => [{ x: 0.1, y: -0.04, pose: 'loaf', scale: 0.3 }],
  },
  bookshelf: {
    layer: 2, r: 0.55, kinds: ['color', 'count'], count: { key: 'rows', min: 3, max: 5, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#8a5a3c', '#3d405b', '#a26b3d']), rows: intBetween(rng, 3, 5), palette: Array.from({ length: 24 }, () => pick(rng, PALETTE.any)) }),
    render: (o) => {
      const H = 1.6;
      let out = rect(-0.5, -H, 1, H, o.color);
      const rowH = (H - 0.1) / o.rows;
      let k = 0;
      for (let r = 0; r < o.rows; r++) {
        const y = -H + 0.05 + rowH * (r + 1);
        out += rect(-0.46, y - 0.03, 0.92, 0.04, darker(o.color), NOINK);
        let x = -0.44;
        while (x < 0.36) {
          const w = 0.05 + (k % 3) * 0.02;
          const h = rowH * (0.6 + ((k * 7) % 4) * 0.08);
          out += rect(x, y - 0.03 - h, w, h, o.palette[k % o.palette.length], NOINK);
          x += w + 0.015;
          k++;
        }
      }
      return out;
    },
    spots: () => [{ x: 0.05, y: -1.6, pose: 'sleep', scale: 0.4 }, { x: -0.2, y: -0.62, pose: 'loaf', scale: 0.26 }],
  },
  sofa: {
    layer: 3, r: 0.55, kinds: ['color', 'size', 'move', 'flip', 'count'], count: { key: 'cushions', min: 0, max: 2, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#e07a5f', '#81b29a', '#6d9dc5', '#9d8fd6', '#f2cc8f']), cushions: intBetween(rng, 0, 2), cushion: pick(rng, PALETTE.soft), flip: chance(rng, 0.5) }),
    render: (o) => rect(-0.5, -0.55, 1, 0.3, o.color, { rx: 0.06 }) + rect(-0.5, -0.32, 1, 0.3, darker(o.color, 0.92), { rx: 0.06 }) + rect(-0.6, -0.4, 0.14, 0.4, o.color, { rx: 0.05 }) + rect(0.46, -0.4, 0.14, 0.4, o.color, { rx: 0.05 })
      + (o.cushions > 0 ? rect(-0.4, -0.5, 0.26, 0.24, o.cushion, { rx: 0.04 }) : '') + (o.cushions > 1 ? rect(0.14, -0.5, 0.26, 0.24, lighter(o.cushion, 0.2), { rx: 0.04 }) : ''),
    spots: () => [{ x: 0, y: -0.32, pose: 'sleep', scale: 0.42 }, { x: 0.52, y: -0.4, pose: 'sit', scale: 0.3 }],
  },
  armchair: {
    layer: 3, r: 0.55, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#e07a5f', '#81b29a', '#6d9dc5', '#9d8fd6', '#c9184a']), flip: chance(rng, 0.5) }),
    render: (o) => rect(-0.34, -0.7, 0.68, 0.4, o.color, { rx: 0.08 }) + rect(-0.4, -0.36, 0.8, 0.34, darker(o.color, 0.92), { rx: 0.06 }) + rect(-0.5, -0.46, 0.14, 0.44, o.color, { rx: 0.05 }) + rect(0.36, -0.46, 0.14, 0.44, o.color, { rx: 0.05 }),
    spots: () => [{ x: 0, y: -0.36, pose: 'loaf', scale: 0.4 }],
  },
  table: {
    layer: 3, r: 0.55, kinds: ['color', 'size', 'move', 'count'], count: { key: 'items', min: 0, max: 3, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#8a5a3c', '#d4a373', '#3d405b', '#f4f1ea']), items: intBetween(rng, 1, 3), mug: pick(rng, PALETTE.any) }),
    render: (o) => rect(-0.5, -0.4, 1, 0.08, o.color) + rect(-0.44, -0.32, 0.06, 0.32, o.color) + rect(0.38, -0.32, 0.06, 0.32, o.color)
      + (o.items > 0 ? rect(-0.3, -0.52, 0.14, 0.12, o.mug) + path('M-0.16,-0.49 q0.08,0.03 0,0.07', 'none', THIN) : '')
      + (o.items > 1 ? rect(0, -0.46, 0.26, 0.06, '#c9184a') + rect(0.02, -0.5, 0.22, 0.04, '#457b9d') : '')
      + (o.items > 2 ? rect(0.32, -0.6, 0.1, 0.2, '#cfe7f5') + circ(0.37, -0.66, 0.06, '#f4978e') : ''),
    spots: () => [{ x: -0.1, y: 0, pose: 'sleep', scale: 0.34 }],
  },
  rug: {
    layer: 2, r: 0.5, kinds: ['color', 'size', 'move', 'count'], count: { key: 'rings', min: 1, max: 3, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#c9184a', '#457b9d', '#e9c46a', '#e07a5f', '#9d8fd6']), rings: intBetween(rng, 1, 3) }),
    render: (o) => ell(0, 0, 0.5, 0.18, o.color) + (o.rings > 1 ? ell(0, 0, 0.36, 0.12, lighter(o.color, 0.3), NOINK) : '') + (o.rings > 2 ? ell(0, 0, 0.22, 0.07, o.color, NOINK) : ''),
  },
  floorlamp: {
    layer: 3, r: 0.5, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, PALETTE.soft) }),
    render: (o) => rect(-0.02, -1, 0.04, 1, '#3d405b') + ell(0, 0, 0.14, 0.04, '#3d405b') + path('M-0.22,-1 l0.44,0 l-0.08,-0.3 l-0.28,0 Z', o.color),
  },
  tv: {
    layer: 3, r: 0.55, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#3d405b', '#2a2118']), screen: pick(rng, ['#8ecae6', '#ffb4a2', '#b5e48c']) }),
    render: (o) => rect(-0.5, -0.2, 1, 0.2, '#8a5a3c') + rect(-0.42, -0.72, 0.84, 0.5, o.color, { rx: 0.03 }) + rect(-0.38, -0.68, 0.76, 0.42, o.screen, NOINK) + circ(0.2, -0.5, 0.08, '#ffd166', NOINK) + path('M-0.36,-0.32 q0.2,-0.14 0.4,0 Z', '#5f9a5c', NOINK),
    spots: () => [{ x: 0.3, y: -0.2, pose: 'loaf', scale: 0.26 }],
  },
  cattree: {
    layer: 3, r: 0.55, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#d4a373', '#c9c1b6', '#f2cc8f']) }),
    render: (o) => rect(-0.3, -0.06, 0.6, 0.06, o.color) + rect(-0.06, -0.9, 0.12, 0.84, '#c5713f') + rect(-0.34, -0.96, 0.68, 0.08, o.color) + rect(-0.24, -0.5, 0.48, 0.07, o.color) + rect(-0.2, -0.46, 0.4, 0.3, o.color, { rx: 0.05 }) + circ(0, -0.31, 0.09, darker(o.color)),
    spots: () => [{ x: 0, y: -0.96, pose: 'sit', scale: 0.34 }, { x: 0, y: -0.24, pose: 'peek', scale: 0.3 }],
  },
  basket: {
    layer: 3, r: 0.5, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#d4a373', '#a26b3d', '#e9c46a']) }),
    render: (o) => path('M-0.4,-0.36 l0.8,0 l-0.1,0.36 l-0.6,0 Z', o.color) + line(-0.3, -0.24, 0.3, -0.24, THIN) + line(-0.3, -0.12, 0.3, -0.12, THIN),
    spots: () => [{ x: 0, y: -0.36, pose: 'peek', scale: 0.4 }],
  },
  yarn: {
    layer: 4, r: 0.45, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, PALETTE.any) }),
    render: (o) => circ(0, -0.2, 0.2, o.color) + path('M-0.14,-0.28 q0.14,0.1 0.28,0 M-0.16,-0.16 q0.16,0.1 0.32,0', 'none', { class: 'thin', stroke: darker(o.color, 0.6) }) + path('M0.18,-0.12 q0.2,0.1 0.4,0.06', 'none', { class: 'thin', stroke: o.color }),
  },
  plant: {
    layer: 3, r: 0.5, kinds: ['color', 'size', 'move', 'remove', 'count'], count: { key: 'leaves', min: 3, max: 6, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#5f9a5c', '#3f7d4e', '#7fb069']), pot: pick(rng, ['#c5713f', '#f4f1ea', '#3d405b', '#e07a5f']), leaves: intBetween(rng, 3, 6) }),
    render: (o) => path('M-0.2,-0.3 l0.4,0 l-0.05,0.3 l-0.3,0 Z', o.pot) + Array.from({ length: o.leaves }, (_, i) => { const a = -90 + (i - (o.leaves - 1) / 2) * 28; return `<ellipse cx="0" cy="-0.55" rx="0.08" ry="0.28" fill="${o.color}" transform="rotate(${a} 0 -0.3)"/>`; }).join(''),
  },
  walllamp: {
    layer: 1, r: 0.45, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, PALETTE.soft) }),
    render: (o) => rect(-0.04, -0.3, 0.08, 0.3, '#3d405b') + path('M-0.25,-0.3 l0.5,0 l-0.1,-0.3 l-0.3,0 Z', o.color) + circ(0, -0.36, 0.28, '#ffd166', { class: 'noink', opacity: 0.25 }),
  },
  calendar: {
    layer: 1, r: 0.45, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, PALETTE.any) }),
    render: (o) => rect(-0.3, -0.4, 0.6, 0.8, '#fffdf7') + rect(-0.3, -0.4, 0.6, 0.2, o.color) + [0, 1, 2].map((r) => [0, 1, 2, 3].map((c) => rect(-0.22 + c * 0.13, -0.12 + r * 0.14, 0.08, 0.08, r === 1 && c === 2 ? o.color : '#e6e2da', NOINK)).join('')).join(''),
  },

  /* ── 항구 ── */
  boat: {
    layer: 3, r: 0.55, kinds: ['color', 'size', 'move', 'flip', 'count'], count: { key: 'crates', min: 0, max: 3, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#e07a5f', '#457b9d', '#e9c46a', '#3d405b', '#81b29a']), crates: intBetween(rng, 0, 3), flip: chance(rng, 0.5) }),
    render: (o) => path('M-0.6,-0.3 L0.6,-0.3 L0.45,0 L-0.5,0 Z', o.color) + rect(-0.2, -0.58, 0.32, 0.28, lighter(o.color, 0.4)) + rect(-0.16, -0.54, 0.1, 0.1, '#cfe7f5', NOINK) + rect(0.16, -0.9, 0.04, 0.6, '#8a5a3c') + line(-0.6, -0.34, 0.6, -0.34, {})
      + [0, 1, 2].slice(0, o.crates).map((i) => rect(-0.5 + i * 0.14, -0.44, 0.12, 0.14, '#d4a373')).join(''),
    spots: () => [{ x: -0.04, y: -0.58, pose: 'sit', scale: 0.3 }, { x: 0.4, y: -0.3, pose: 'loaf', scale: 0.24 }],
  },
  sailboat: {
    layer: 2, r: 0.55, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#e07a5f', '#457b9d', '#e9c46a', '#c9184a']), sail: pick(rng, ['#fffdf7', '#ffe3d8', '#fff2b2']), flip: chance(rng, 0.5) }),
    render: (o) => poly([[-0.5, -0.2], [0.5, -0.2], [0.35, 0], [-0.35, 0]], o.color) + rect(-0.02, -0.9, 0.04, 0.7, '#3d405b') + poly([[0.02, -0.88], [0.44, -0.24], [0.02, -0.24]], o.sail) + poly([[-0.02, -0.8], [-0.34, -0.24], [-0.02, -0.24]], darker(o.sail, 0.9)),
  },
  crate: {
    layer: 3, r: 0.55, kinds: ['color', 'size', 'move', 'remove', 'count'], count: { key: 'stack', min: 1, max: 3, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#d4a373', '#a26b3d', '#c9a27e']), stack: intBetween(rng, 1, 3) }),
    render: (o) => Array.from({ length: o.stack }, (_, i) => rect(-0.35 + (i % 2) * 0.05, -0.4 * (i + 1), 0.7, 0.4, i % 2 ? darker(o.color, 0.9) : o.color) + line(-0.35 + (i % 2) * 0.05, -0.4 * (i + 1), 0.35 + (i % 2) * 0.05, -0.4 * i, THIN) + line(0.35 + (i % 2) * 0.05, -0.4 * (i + 1), -0.35 + (i % 2) * 0.05, -0.4 * i, THIN)).join(''),
    spots: (o) => [{ x: 0.02, y: -0.4 * o.stack, pose: 'sit', scale: 0.38 }],
  },
  barrel: {
    layer: 3, r: 0.5, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#a26b3d', '#8a5a3c', '#3d5a6c']) }),
    render: (o) => path('M-0.26,-0.6 q0.26,-0.06 0.52,0 q0.08,0.3 0,0.6 q-0.26,0.06 -0.52,0 q-0.08,-0.3 0,-0.6 Z', o.color) + rect(-0.29, -0.46, 0.58, 0.04, '#3d405b', NOINK) + rect(-0.29, -0.18, 0.58, 0.04, '#3d405b', NOINK),
    spots: () => [{ x: 0, y: -0.6, pose: 'peek', scale: 0.4 }],
  },
  stall: {
    layer: 2, r: 0.55, kinds: ['color', 'size', 'count'], count: { key: 'fish', min: 2, max: 5, step: 1 },
    place: (rng) => ({ color: pick(rng, PALETTE.any), fish: intBetween(rng, 2, 5), fishColor: pick(rng, ['#8ecae6', '#f4978e', '#c9c1b6']) }),
    render: (o) => rect(-0.5, -0.5, 1, 0.5, '#d4a373') + rect(-0.54, -0.58, 1.08, 0.08, darker('#d4a373')) + rect(-0.5, -1.2, 0.05, 0.62, '#8a5a3c') + rect(0.45, -1.2, 0.05, 0.62, '#8a5a3c')
      + [0, 1, 2, 3, 4, 5].map((i) => rect(-0.58 + i * (1.16 / 6), -1.32, 1.16 / 6, 0.14, i % 2 ? '#fffdf7' : o.color, NOINK)).join('') + line(-0.58, -1.32, 0.58, -1.32, {}) + line(-0.58, -1.18, 0.58, -1.18, {})
      + rect(-0.44, -0.66, 0.88, 0.12, '#cfe7f5') + Array.from({ length: o.fish }, (_, i) => ell(-0.34 + i * (0.68 / Math.max(1, o.fish - 1)), -0.6, 0.08, 0.04, o.fishColor) + poly([[-0.34 + i * (0.68 / Math.max(1, o.fish - 1)) + 0.07, -0.6], [-0.34 + i * (0.68 / Math.max(1, o.fish - 1)) + 0.12, -0.64], [-0.34 + i * (0.68 / Math.max(1, o.fish - 1)) + 0.12, -0.56]], o.fishColor)).join(''),
    spots: () => [{ x: 0.2, y: -1.32, pose: 'loaf', scale: 0.26 }, { x: -0.3, y: 0, pose: 'sit', scale: 0.3 }],
  },
  net: {
    layer: 3, r: 0.5, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#e9c46a', '#5fa8a3', '#d4a373']) }),
    render: (o) => path('M-0.5,0 q0.1,-0.5 0.5,-0.45 q0.4,-0.05 0.5,0.45 Z', o.color, { opacity: 0.9 }) + path('M-0.3,-0.1 l0.1,-0.2 l0.1,0.2 l0.1,-0.2 l0.1,0.2 l0.1,-0.2 l0.1,0.2 M-0.2,-0.05 l0.1,-0.2 l0.1,0.2 l0.1,-0.2 l0.1,0.2', 'none', THIN),
    spots: () => [{ x: 0.05, y: -0.4, pose: 'loaf', scale: 0.4 }],
  },
  rope: {
    layer: 3, r: 0.45, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#e9c46a', '#d4a373', '#c9c1b6']) }),
    render: (o) => ell(0, -0.1, 0.4, 0.18, o.color) + ell(0, -0.1, 0.16, 0.07, PAPER) + ell(0, -0.14, 0.36, 0.14, 'none', THIN),
    spots: () => [{ x: 0, y: -0.14, pose: 'sleep', scale: 0.5 }],
  },
  lantern: {
    layer: 3, r: 0.45, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#3d405b', '#c9184a', '#457b9d']) }),
    render: (o) => rect(-0.03, -1.1, 0.06, 1.1, '#3d405b') + rect(-0.16, -1.3, 0.32, 0.28, o.color, { rx: 0.04 }) + rect(-0.1, -1.24, 0.2, 0.16, '#ffd166', NOINK) + poly([[-0.2, -1.3], [0.2, -1.3], [0, -1.42]], o.color),
  },
  buoy: {
    layer: 3, r: 0.45, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#e63946', '#f8961e', '#ffd166']) }),
    render: (o) => path('M-0.2,-0.1 l0.4,0 l-0.06,-0.4 l-0.28,0 Z', o.color) + rect(-0.15, -0.3, 0.3, 0.08, '#fffdf7', NOINK) + rect(-0.04, -0.62, 0.08, 0.12, '#3d405b') + ell(0, -0.1, 0.24, 0.06, o.color),
  },
  anchor: {
    layer: 3, r: 0.45, kinds: ['color', 'size', 'move', 'remove', 'rotate'],
    place: (rng) => ({ color: pick(rng, ['#3d405b', '#457b9d']), rot: intBetween(rng, -20, 20) }),
    render: (o) => circ(0, -0.62, 0.08, 'none', { stroke: o.color, 'stroke-width': 3 }) + line(0, -0.54, 0, -0.02, { stroke: o.color, 'stroke-width': 3 }) + line(-0.2, -0.44, 0.2, -0.44, { stroke: o.color, 'stroke-width': 3 }) + path('M-0.3,-0.2 q0.3,0.36 0.6,0', 'none', { stroke: o.color, 'stroke-width': 3 }),
  },
  lighthouse: {
    layer: 1, r: 0.55, kinds: ['color', 'size', 'count'], count: { key: 'stripes', min: 2, max: 4, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#e63946', '#457b9d', '#3d405b']), stripes: intBetween(rng, 2, 4) }),
    render: (o) => poly([[-0.24, 0], [0.24, 0], [0.16, -1], [-0.16, -1]], '#fffdf7') + Array.from({ length: o.stripes }, (_, i) => rect(-0.22, -0.1 - (i + 1) * (0.8 / o.stripes) + 0.1, 0.44, 0.4 / o.stripes, o.color, NOINK)).join('') + rect(-0.18, -1.14, 0.36, 0.16, '#ffd166') + poly([[-0.22, -1.14], [0.22, -1.14], [0, -1.3]], '#3d405b') + rect(-0.2, -0.9, 0.4, 0.04, '#3d405b'),
    spots: () => [{ x: 0, y: -0.9, pose: 'loaf', scale: 0.24 }],
  },
  fisherman: {
    layer: 4, r: 0.45, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#e9c46a', '#3d405b', '#457b9d']), skin: pick(rng, ['#f6d3b5', '#e8b58a', '#c68a5a']), flip: chance(rng, 0.5) }),
    render: (o) => person({ color: o.color, shirt: o.color, skin: o.skin, pants: '#3d405b', hair: 'short', hairColor: '#8a5a3c', hat: 'beanie', hatColor: '#e9c46a', prop: 'none' }) + line(0.16, -0.6, 0.7, -1.2, { 'stroke-width': 2 }) + line(0.7, -1.2, 0.72, -0.4, THIN),
  },
  hut: {
    layer: 1, r: 0.55, kinds: ['color', 'size'],
    place: (rng) => ({ color: pick(rng, PALETTE.wall), roof: pick(rng, PALETTE.roof), sign: pick(rng, ['cup', 'fish', 'bread']) }),
    render: (o) => rect(-0.5, -0.8, 1, 0.8, o.color) + poly([[-0.58, -0.8], [0, -1.1], [0.58, -0.8]], o.roof) + rect(-0.14, -0.5, 0.28, 0.5, '#7b4b2a') + rect(-0.44, -0.66, 0.24, 0.22, '#cfe7f5') + rect(0.2, -0.66, 0.24, 0.22, '#cfe7f5') + rect(-0.2, -0.98, 0.4, 0.12, '#fffdf7') + signIcon(o.sign, 0, -0.92, 0.08),
    spots: () => [{ x: 0.3, y: -0.8, pose: 'sit', scale: 0.26 }],
  },

  /* ── 정원 ── */
  greenhouse: {
    layer: 1, r: 0.55, kinds: ['color', 'size', 'count'], count: { key: 'pots', min: 1, max: 4, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#fffdf7', '#d8e2dc', '#cfe2f3']), frame: pick(rng, ['#3d405b', '#5f9a5c', '#8a5a3c']), pots: intBetween(rng, 1, 4) }),
    render: (o) => rect(-0.5, -0.7, 1, 0.7, o.color, { opacity: 0.85 }) + poly([[-0.56, -0.7], [0, -1.05], [0.56, -0.7]], o.color, { opacity: 0.85 }) + line(-0.25, -0.7, -0.25, 0, { stroke: o.frame }) + line(0.25, -0.7, 0.25, 0, { stroke: o.frame }) + line(-0.5, -0.35, 0.5, -0.35, { stroke: o.frame }) + line(0, -1.05, 0, -0.7, { stroke: o.frame })
      + Array.from({ length: o.pots }, (_, i) => rect(-0.4 + i * 0.24, -0.16, 0.14, 0.14, '#c5713f') + circ(-0.33 + i * 0.24, -0.2, 0.08, '#5f9a5c')).join(''),
    spots: () => [{ x: -0.1, y: 0, pose: 'peek', scale: 0.3 }],
  },
  shed: {
    layer: 1, r: 0.55, kinds: ['color', 'size'],
    place: (rng) => ({ color: pick(rng, ['#a26b3d', '#8a5a3c', '#5c4a3f', '#3d5a6c']), roof: pick(rng, PALETTE.roof) }),
    render: (o) => rect(-0.5, -0.7, 1, 0.7, o.color) + poly([[-0.56, -0.7], [0, -0.98], [0.56, -0.7]], o.roof) + rect(-0.16, -0.5, 0.32, 0.5, darker(o.color)) + rect(0.24, -0.6, 0.18, 0.16, '#cfe7f5') + line(-0.5, -0.5, -0.16, -0.5, THIN) + line(-0.5, -0.3, -0.16, -0.3, THIN),
    spots: () => [{ x: 0.16, y: -0.78, pose: 'sleep', scale: 0.3 }],
  },
  pond: {
    layer: 2, r: 0.55, kinds: ['color', 'size', 'count'], count: { key: 'ducks', min: 0, max: 3, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#8ecae6', '#6d9dc5', '#5fa8a3']), ducks: intBetween(rng, 0, 3) }),
    render: (o) => ell(0, 0, 0.6, 0.24, o.color) + ell(-0.2, 0.02, 0.1, 0.05, '#7fb069', NOINK) + ell(0.25, -0.06, 0.08, 0.04, '#7fb069', NOINK)
      + Array.from({ length: o.ducks }, (_, i) => { const x = -0.3 + i * 0.28; return ell(x, -0.08, 0.1, 0.06, '#ffd166') + circ(x + 0.08, -0.16, 0.05, '#ffd166') + poly([[x + 0.13, -0.16], [x + 0.19, -0.15], [x + 0.13, -0.13]], '#f8961e', NOINK); }).join(''),
  },
  fencepost: {
    layer: 1, r: 0.4, kinds: ['color', 'size', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#fffdf7', '#d4a373', '#8a5a3c']) }),
    render: (o) => rect(-0.08, -0.6, 0.16, 0.6, o.color) + poly([[-0.08, -0.6], [0, -0.7], [0.08, -0.6]], o.color),
    spots: () => [{ x: 0, y: -0.7, pose: 'sit', scale: 0.26 }],
  },
  flowerbed: {
    layer: 3, r: 0.5, kinds: ['color', 'size', 'move', 'count'], count: { key: 'flowers', min: 3, max: 6, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#f4978e', '#c9184a', '#ffd166', '#9d8fd6', '#e07a5f']), flowers: intBetween(rng, 3, 6) }),
    render: (o) => path('M-0.5,0 q0.5,-0.2 1,0 Z', '#7fb069') + Array.from({ length: o.flowers }, (_, i) => { const x = -0.4 + (0.8 * i) / Math.max(1, o.flowers - 1); const h = 0.22 + (i % 2) * 0.1; return line(x, -0.02, x, -h, { stroke: '#3f7d4e', 'stroke-width': 1.5, class: 'noink' }) + circ(x, -h - 0.06, 0.07, o.color) + circ(x, -h - 0.06, 0.025, '#ffd166', NOINK); }).join(''),
    spots: () => [{ x: 0.1, y: -0.05, pose: 'peek', scale: 0.32 }],
  },
  wheelbarrow: {
    layer: 3, r: 0.5, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#5f9a5c', '#e07a5f', '#457b9d']), flip: chance(rng, 0.5) }),
    render: (o) => path('M-0.4,-0.4 L0.4,-0.4 L0.3,-0.1 L-0.2,-0.1 Z', o.color) + circ(0.34, 0, 0.12, '#3d405b') + line(-0.4, -0.4, -0.6, -0.3, { 'stroke-width': 2.4 }) + line(-0.2, -0.1, -0.24, 0, { 'stroke-width': 2.4 }) + path('M-0.3,-0.4 q0.3,-0.2 0.6,0 Z', '#8a5a3c', NOINK),
    spots: () => [{ x: 0, y: -0.42, pose: 'loaf', scale: 0.3 }],
  },
  wateringcan: {
    layer: 4, r: 0.45, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#5fa8a3', '#e9c46a', '#e07a5f']), flip: chance(rng, 0.5) }),
    render: (o) => rect(-0.2, -0.36, 0.4, 0.36, o.color, { rx: 0.03 }) + line(0.2, -0.28, 0.42, -0.5, { 'stroke-width': 2.6, stroke: o.color }) + circ(0.44, -0.52, 0.05, o.color) + path('M-0.2,-0.3 q-0.16,-0.14 0,-0.3 l0.06,0.02 q-0.1,0.12 0,0.24 Z', o.color),
  },
  birdbath: {
    layer: 3, r: 0.5, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#c9c1b6', '#d8e2dc', '#e3d5ca']) }),
    render: (o) => rect(-0.06, -0.5, 0.12, 0.5, o.color) + ell(0, 0, 0.16, 0.04, o.color) + path('M-0.36,-0.5 q0.36,0.3 0.72,0 Z', o.color) + ell(0, -0.5, 0.3, 0.05, '#8ecae6') + path('M0.08,-0.58 q0.06,-0.1 0.12,0 q0.06,-0.1 0.12,0', 'none', THIN),
  },
  picnic: {
    layer: 3, r: 0.55, kinds: ['color', 'size', 'move', 'count'], count: { key: 'items', min: 1, max: 3, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#c9184a', '#457b9d', '#e07a5f']), items: intBetween(rng, 1, 3) }),
    render: (o) => poly([[-0.5, 0], [0.5, 0], [0.35, -0.2], [-0.35, -0.2]], o.color) + line(-0.42, -0.1, 0.42, -0.1, { class: 'thin', stroke: '#fffdf7' }) + line(0, -0.2, 0, 0, { class: 'thin', stroke: '#fffdf7' })
      + (o.items > 0 ? path('M-0.3,-0.2 l0.2,0 l-0.02,-0.16 l-0.16,0 Z', '#d4a373') + line(-0.3, -0.34, -0.1, -0.34, THIN) : '') + (o.items > 1 ? circ(0.1, -0.24, 0.06, '#e63946') : '') + (o.items > 2 ? rect(0.24, -0.34, 0.08, 0.14, '#8ecae6') : ''),
    spots: () => [{ x: 0.3, y: -0.06, pose: 'loaf', scale: 0.26 }],
  },
  beehive: {
    layer: 3, r: 0.45, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#e9c46a', '#f2a65a', '#d4a373']) }),
    render: (o) => path('M-0.3,0 q-0.1,-0.7 0.3,-0.7 q0.4,0 0.3,0.7 Z', o.color) + line(-0.3, -0.2, 0.3, -0.2, THIN) + line(-0.28, -0.4, 0.28, -0.4, THIN) + circ(0, -0.12, 0.05, INK, NOINK) + circ(0.34, -0.5, 0.03, '#ffd166') + circ(-0.36, -0.36, 0.03, '#ffd166'),
  },
  mushroom: {
    layer: 4, r: 0.45, kinds: ['color', 'size', 'move', 'remove', 'count'], count: { key: 'dots', min: 1, max: 4, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#e63946', '#f8961e', '#c9184a']), dots: intBetween(rng, 1, 4) }),
    render: (o) => rect(-0.12, -0.3, 0.24, 0.3, '#fff2b2', { rx: 0.05 }) + path('M-0.4,-0.3 q0.4,-0.5 0.8,0 Z', o.color) + [[-0.2, -0.42], [0.1, -0.5], [0.24, -0.36], [-0.04, -0.34]].slice(0, o.dots).map(([x, y]) => circ(x, y, 0.05, '#fffdf7', NOINK)).join(''),
  },
  gnome: {
    layer: 4, r: 0.45, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#e63946', '#457b9d', '#5f9a5c']), flip: chance(rng, 0.5) }),
    render: (o) => rect(-0.14, -0.42, 0.28, 0.42, '#457b9d', { rx: 0.05 }) + circ(0, -0.5, 0.13, '#f6d3b5') + path('M-0.13,-0.5 q0.13,0.24 0.26,0 Z', '#fffdf7') + poly([[-0.15, -0.56], [0.15, -0.56], [0.02, -0.92]], o.color),
  },
  butterfly: {
    layer: 4, r: 0.45, kinds: ['color', 'size', 'move', 'rotate', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#f4978e', '#9d8fd6', '#ffd166', '#8ecae6']), rot: intBetween(rng, -30, 30) }),
    render: (o) => ell(-0.2, -0.1, 0.2, 0.16, o.color) + ell(0.2, -0.1, 0.2, 0.16, o.color) + ell(-0.16, 0.12, 0.14, 0.11, darker(o.color, 0.85)) + ell(0.16, 0.12, 0.14, 0.11, darker(o.color, 0.85)) + rect(-0.03, -0.2, 0.06, 0.42, INK, { rx: 0.03 }),
  },
  swing: {
    layer: 3, r: 0.5, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#e07a5f', '#457b9d', '#e9c46a']) }),
    render: (o) => line(-0.4, -1, -0.5, 0, { 'stroke-width': 2.4 }) + line(0.4, -1, 0.5, 0, { 'stroke-width': 2.4 }) + line(-0.45, -1, 0.45, -1, { 'stroke-width': 2.6 }) + line(-0.12, -1, -0.12, -0.4, THIN) + line(0.12, -1, 0.12, -0.4, THIN) + rect(-0.18, -0.42, 0.36, 0.06, o.color),
    spots: () => [{ x: 0, y: -0.42, pose: 'sit', scale: 0.3 }],
  },
  veggies: {
    layer: 3, r: 0.5, kinds: ['color', 'size', 'move', 'count'], count: { key: 'n', min: 3, max: 6, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#e63946', '#f8961e', '#5f9a5c']), n: intBetween(rng, 3, 6) }),
    render: (o) => rect(-0.5, -0.08, 1, 0.08, '#8a5a3c', { rx: 0.02 }) + Array.from({ length: o.n }, (_, i) => { const x = -0.42 + (0.84 * i) / Math.max(1, o.n - 1); return path(`M${r1(x - 0.06)},-0.08 q0.06,-0.2 0.12,0 Z`, '#5f9a5c', NOINK) + circ(x, -0.12, 0.05, o.color); }).join(''),
  },
};

function signIcon(kind, cx, cy, s) {
  switch (kind) {
    case 'cup': return rect(cx - s * 0.5, cy - s * 0.4, s, s * 0.8, '#e07a5f') + path(`M${r1(cx + s * 0.5)},${r1(cy - s * 0.2)} q${r1(s * 0.4)},${r1(s * 0.2)} 0,${r1(s * 0.4)}`, 'none', THIN);
    case 'bread': return ell(cx, cy, s * 0.6, s * 0.35, '#e9a15a');
    case 'book': return rect(cx - s * 0.5, cy - s * 0.35, s, s * 0.7, '#457b9d') + line(cx, cy - s * 0.35, cx, cy + s * 0.35, THIN);
    case 'fish': return ell(cx - s * 0.1, cy, s * 0.5, s * 0.28, '#8ecae6') + poly([[cx + s * 0.35, cy], [cx + s * 0.65, cy - s * 0.25], [cx + s * 0.65, cy + s * 0.25]], '#8ecae6');
    case 'flower': return circ(cx, cy, s * 0.35, '#f4978e') + circ(cx, cy, s * 0.12, '#ffd166', NOINK);
    case 'hat': return rect(cx - s * 0.3, cy - s * 0.45, s * 0.6, s * 0.5, '#3d405b') + rect(cx - s * 0.6, cy, s * 1.2, s * 0.1, '#3d405b');
    default: return '';
  }
}
function pictureArt(kind) {
  switch (kind) {
    case 'hills': return path('M-0.42,0.32 q0.2,-0.4 0.42,-0.1 q0.2,-0.3 0.42,0.02 l0,0.08 l-0.84,0 Z', '#7fb069', NOINK) + circ(0.2, -0.14, 0.08, '#ffd166', NOINK);
    case 'cat': return circ(0, 0.02, 0.2, '#e8933a', NOINK) + poly([[-0.16, -0.1], [-0.22, -0.32], [-0.04, -0.2]], '#e8933a', NOINK) + poly([[0.16, -0.1], [0.22, -0.32], [0.04, -0.2]], '#e8933a', NOINK) + circ(-0.07, 0, 0.03, INK, NOINK) + circ(0.07, 0, 0.03, INK, NOINK);
    case 'boat': return rect(-0.42, 0.08, 0.84, 0.24, '#8ecae6', NOINK) + poly([[-0.2, 0.1], [0.2, 0.1], [0.14, 0.2], [-0.14, 0.2]], '#e07a5f', NOINK) + poly([[0, 0.08], [0.16, 0.08], [0, -0.18]], '#fffdf7', NOINK);
    case 'sun': return circ(0, 0, 0.16, '#f9c74f', NOINK) + circ(0, 0, 0.26, '#f9c74f', { class: 'noink', opacity: 0.3 });
    default: return rect(-0.3, -0.2, 0.26, 0.4, '#e07a5f', NOINK) + circ(0.16, 0.06, 0.16, '#457b9d', NOINK) + rect(-0.02, -0.26, 0.3, 0.12, '#ffd166', NOINK);
  }
}

/* ───────── 테마: 배경 + 배치 규칙 ─────────
 * slots: { type, zone:[x0,x1,y0,y1], count:[min,max], size:[min,max], gap? }  zone 은 발밑 좌표.
 * ground: 소품 발밑 y 를 맞출 기준선 함수(선택).
 */
const THEME_DEFS = {
  town: {
    background: (rng) => {
      const sky = pick(rng, ['#cfe7f5', '#ffe3d8', '#d9ead3', '#fff2b2']);
      return rect(0, 0, WIDTH, HEIGHT, sky, NOINK)
        + rect(0, 330, WIDTH, 40, '#e3d5ca', NOINK) + line(0, 330, WIDTH, 330, {}) + line(0, 370, WIDTH, 370, {})
        + rect(0, 370, WIDTH, 110, '#6b7280', NOINK) + path('M0,425 H640', 'none', { stroke: '#fff2b2', 'stroke-width': 4, 'stroke-dasharray': '26 18', class: 'noink' })
        + Array.from({ length: 12 }, (_, i) => line(i * 56, 330, i * 56, 370, THIN)).join('');
    },
    slots: [
      { type: 'sun', zone: [60, 580, 60, 90], count: [0, 1], size: [50, 64] },
      { type: 'cloud', zone: [40, 600, 40, 120], count: [2, 4], size: [70, 110] },
      { type: 'building', row: { y: 330, x0: -10, x1: 650, widths: [95, 150] }, count: [5, 6], size: [95, 150] },
      { type: 'smoke', zone: [60, 580, 60, 120], count: [0, 2], size: [30, 40] },
      { type: 'bird', zone: [60, 580, 50, 140], count: [1, 3], size: [26, 36] },
      { type: 'balloon', zone: [60, 580, 80, 180], count: [0, 1], size: [40, 50] },
      { type: 'tree', zone: [20, 620, 348, 366], count: [2, 4], size: [70, 95] },
      { type: 'lamp', zone: [20, 620, 350, 362], count: [2, 3], size: [60, 70] },
      { type: 'bench', zone: [40, 600, 355, 366], count: [1, 2], size: [60, 76] },
      { type: 'bike', zone: [40, 600, 355, 366], count: [1, 2], size: [50, 62] },
      { type: 'box', zone: [30, 610, 356, 368], count: [2, 3], size: [30, 44] },
      { type: 'mailbox', zone: [30, 610, 352, 364], count: [0, 1], size: [40, 48] },
      { type: 'hydrant', zone: [30, 610, 356, 366], count: [0, 1], size: [32, 40] },
      { type: 'trash', zone: [30, 610, 356, 366], count: [1, 2], size: [34, 44] },
      { type: 'pot', zone: [30, 610, 356, 366], count: [2, 4], size: [30, 40] },
      { type: 'signpost', zone: [30, 610, 352, 364], count: [0, 1], size: [50, 60] },
      { type: 'person', zone: [30, 610, 356, 372], count: [4, 7], size: [64, 80] },
      { type: 'dog', zone: [30, 610, 358, 370], count: [0, 2], size: [34, 44] },
      { type: 'car', zone: [60, 580, 430, 468], count: [2, 3], size: [110, 140] },
      { type: 'scooter', zone: [60, 580, 430, 466], count: [0, 1], size: [70, 80] },
      { type: 'person', zone: [30, 610, 440, 470], count: [0, 1], size: [64, 76] },
    ],
  },
  room: {
    background: (rng) => {
      const wall = pick(rng, PALETTE.wall);
      const floor = pick(rng, ['#d4a373', '#c9a27e', '#a26b3d', '#e3d5ca']);
      let planks = '';
      for (let i = 0; i < 10; i++) planks += line(0, 330 + i * 15, WIDTH, 330 + i * 15, THIN);
      let dots = '';
      const r2 = makeRng(99);
      for (let i = 0; i < 40; i++) dots += circ(r2() * WIDTH, r2() * 300, 2, darker(wall, 0.9), NOINK);
      return rect(0, 0, WIDTH, HEIGHT, wall, NOINK) + dots + rect(0, 322, WIDTH, 158, floor, NOINK) + rect(0, 318, WIDTH, 8, '#fffdf7', NOINK) + line(0, 318, WIDTH, 318, {}) + line(0, 326, WIDTH, 326, {}) + planks;
    },
    slots: [
      { type: 'wallwindow', zone: [120, 520, 250, 270], count: [1, 1], size: [120, 150] },
      { type: 'picture', zone: [40, 600, 80, 220], count: [2, 4], size: [44, 70] },
      { type: 'clock', zone: [60, 580, 60, 120], count: [0, 1], size: [40, 50] },
      { type: 'shelf', zone: [60, 580, 130, 240], count: [1, 2], size: [110, 150] },
      { type: 'walllamp', zone: [60, 580, 120, 220], count: [0, 2], size: [40, 50] },
      { type: 'calendar', zone: [60, 580, 120, 240], count: [0, 1], size: [40, 48] },
      { type: 'bookshelf', zone: [40, 600, 326, 340], count: [1, 1], size: [90, 120] },
      { type: 'sofa', zone: [120, 520, 340, 372], count: [1, 1], size: [150, 190] },
      { type: 'armchair', zone: [40, 600, 340, 372], count: [0, 1], size: [80, 100] },
      { type: 'table', zone: [120, 520, 400, 440], count: [1, 1], size: [110, 140] },
      { type: 'rug', zone: [140, 500, 445, 470], count: [1, 1], size: [200, 280] },
      { type: 'floorlamp', zone: [40, 600, 330, 360], count: [0, 1], size: [90, 110] },
      { type: 'tv', zone: [40, 600, 330, 350], count: [0, 1], size: [90, 120] },
      { type: 'cattree', zone: [40, 600, 340, 380], count: [1, 1], size: [80, 100] },
      { type: 'basket', zone: [40, 600, 380, 470], count: [1, 2], size: [44, 56] },
      { type: 'box', zone: [40, 600, 380, 470], count: [1, 3], size: [36, 50] },
      { type: 'plant', zone: [40, 600, 340, 470], count: [2, 3], size: [50, 70] },
      { type: 'yarn', zone: [40, 600, 400, 470], count: [1, 2], size: [22, 30] },
      { type: 'pot', zone: [40, 600, 380, 470], count: [0, 2], size: [30, 40] },
    ],
  },
  harbor: {
    background: (rng) => {
      const sky = pick(rng, ['#ffe3d8', '#cfe7f5', '#fff2b2']);
      const sea = pick(rng, ['#6d9dc5', '#5fa8a3', '#457b9d']);
      let waves = '';
      for (let i = 0; i < 6; i++) waves += path(`M${20 + i * 100},${300 + (i % 2) * 14} q12,-6 24,0 q12,6 24,0`, 'none', { class: 'thin', stroke: '#fffdf7' });
      let planks = '';
      for (let i = 0; i < 16; i++) planks += line(i * 40, 360, i * 40, 480, THIN);
      return rect(0, 0, WIDTH, HEIGHT, sky, NOINK) + circ(560, 70, 34, '#f9c74f') + ell(120, 250, 130, 18, lighter(sea, 0.3), NOINK)
        + rect(0, 250, WIDTH, 230, sea, NOINK) + waves
        + rect(0, 360, WIDTH, 120, '#c9a27e', NOINK) + line(0, 360, WIDTH, 360, {}) + planks + line(0, 380, WIDTH, 380, THIN)
        + [40, 200, 380, 560].map((x) => rect(x - 6, 320, 12, 50, '#8a5a3c')).join('');
    },
    slots: [
      { type: 'cloud', zone: [40, 600, 40, 110], count: [2, 3], size: [70, 110] },
      { type: 'gull', zone: [40, 600, 60, 200], count: [2, 4], size: [26, 36] },
      { type: 'lighthouse', zone: [60, 220, 250, 252], count: [1, 1], size: [70, 90] },
      { type: 'sailboat', zone: [40, 600, 270, 330], count: [2, 3], size: [60, 90] },
      { type: 'boat', zone: [60, 580, 330, 358], count: [1, 2], size: [110, 140] },
      { type: 'hut', zone: [380, 600, 358, 362], count: [1, 1], size: [110, 140] },
      { type: 'stall', zone: [40, 300, 400, 420], count: [1, 1], size: [100, 130] },
      { type: 'crate', zone: [30, 610, 380, 470], count: [3, 5], size: [40, 56] },
      { type: 'barrel', zone: [30, 610, 380, 470], count: [2, 3], size: [40, 52] },
      { type: 'net', zone: [30, 610, 400, 472], count: [1, 2], size: [50, 70] },
      { type: 'rope', zone: [30, 610, 400, 472], count: [1, 2], size: [40, 52] },
      { type: 'lantern', zone: [30, 610, 380, 420], count: [1, 2], size: [50, 60] },
      { type: 'buoy', zone: [30, 610, 400, 470], count: [1, 2], size: [36, 46] },
      { type: 'anchor', zone: [30, 610, 400, 470], count: [0, 1], size: [40, 50] },
      { type: 'fisherman', zone: [30, 610, 400, 470], count: [1, 2], size: [64, 78] },
      { type: 'person', zone: [30, 610, 400, 470], count: [2, 4], size: [60, 76] },
      { type: 'dog', zone: [30, 610, 410, 470], count: [0, 1], size: [34, 42] },
      { type: 'bike', zone: [30, 610, 400, 470], count: [0, 1], size: [50, 60] },
      { type: 'pot', zone: [30, 610, 400, 470], count: [0, 2], size: [28, 36] },
    ],
  },
  garden: {
    background: (rng) => {
      const sky = pick(rng, ['#cfe7f5', '#ffe3d8', '#fff2b2']);
      const grass = pick(rng, ['#9bbf65', '#7fb069', '#a7c957']);
      let fence = '';
      for (let i = 0; i < 17; i++) fence += rect(i * 40 + 6, 224, 12, 44, '#fffdf7') + poly([[i * 40 + 6, 224], [i * 40 + 12, 214], [i * 40 + 18, 224]], '#fffdf7');
      fence += rect(0, 234, WIDTH, 6, '#fffdf7') + rect(0, 252, WIDTH, 6, '#fffdf7');
      let hedge = '';
      for (let i = 0; i < 12; i++) hedge += circ(i * 58 + 20, 224 - (i % 2) * 8, 26, i % 2 ? '#5f9a5c' : '#3f7d4e');
      let grassTufts = '';
      const r2 = makeRng(5);
      for (let i = 0; i < 30; i++) { const x = r2() * WIDTH; const y = 290 + r2() * 180; grassTufts += path(`M${r1(x)},${r1(y)} l-4,-9 M${r1(x)},${r1(y)} l3,-10 M${r1(x)},${r1(y)} l6,-6`, 'none', { class: 'thin', stroke: darker(grass, 0.75) }); }
      return rect(0, 0, WIDTH, HEIGHT, sky, NOINK) + circ(90, 70, 34, '#f9c74f') + hedge + fence + rect(0, 268, WIDTH, 212, grass, NOINK) + line(0, 268, WIDTH, 268, {}) + path('M0,420 q160,-30 320,0 t320,0 l0,60 l-640,0 Z', '#d4a373', { opacity: 0.6, class: 'noink' }) + grassTufts;
    },
    slots: [
      { type: 'cloud', zone: [40, 600, 40, 110], count: [2, 3], size: [70, 110] },
      { type: 'bird', zone: [60, 580, 50, 150], count: [1, 2], size: [26, 34] },
      { type: 'kite', zone: [60, 580, 90, 180], count: [0, 1], size: [46, 56] },
      { type: 'tree', zone: [30, 610, 268, 300], count: [3, 5], size: [90, 130] },
      { type: 'fencepost', zone: [20, 620, 268, 270], count: [2, 4], size: [40, 50] },
      { type: 'greenhouse', zone: [80, 560, 268, 290], count: [0, 1], size: [120, 150] },
      { type: 'shed', zone: [60, 580, 268, 290], count: [1, 1], size: [100, 130] },
      { type: 'swing', zone: [60, 580, 280, 320], count: [0, 1], size: [70, 90] },
      { type: 'pond', zone: [120, 520, 380, 430], count: [1, 1], size: [150, 200] },
      { type: 'flowerbed', zone: [30, 610, 300, 470], count: [3, 5], size: [70, 100] },
      { type: 'veggies', zone: [30, 610, 330, 470], count: [1, 2], size: [90, 120] },
      { type: 'bush', zone: [30, 610, 290, 470], count: [2, 3], size: [50, 70] },
      { type: 'bench', zone: [40, 600, 320, 470], count: [0, 1], size: [64, 76] },
      { type: 'wheelbarrow', zone: [30, 610, 340, 470], count: [0, 1], size: [60, 72] },
      { type: 'wateringcan', zone: [30, 610, 340, 470], count: [0, 1], size: [34, 42] },
      { type: 'birdbath', zone: [30, 610, 320, 440], count: [0, 1], size: [56, 66] },
      { type: 'picnic', zone: [40, 600, 380, 470], count: [0, 1], size: [110, 140] },
      { type: 'beehive', zone: [30, 610, 320, 440], count: [0, 1], size: [40, 50] },
      { type: 'mushroom', zone: [30, 610, 340, 470], count: [1, 3], size: [24, 34] },
      { type: 'gnome', zone: [30, 610, 340, 470], count: [0, 2], size: [34, 44] },
      { type: 'butterfly', zone: [30, 610, 280, 440], count: [1, 3], size: [22, 30] },
      { type: 'person', zone: [30, 610, 340, 470], count: [1, 3], size: [64, 80] },
      { type: 'dog', zone: [30, 610, 350, 470], count: [0, 1], size: [34, 44] },
      { type: 'pot', zone: [30, 610, 340, 470], count: [1, 3], size: [30, 40] },
    ],
  },
};

/** 자리가 모자랄 때 걷는 고양이를 놓을 수 있는 바닥 구역 [x0, x1, y0, y1] */
export const GROUND = {
  town: [[30, 610, 352, 372], [40, 600, 440, 470]],
  room: [[40, 600, 380, 470]],
  harbor: [[30, 610, 395, 470]],
  garden: [[30, 610, 320, 470]],
};

/* ───────── 배치 ───────── */

export function objectRadius(o) {
  const def = PROPS[o.type];
  return o.type === 'cat' ? o.size * 0.55 : o.size * (def ? def.r : 0.5);
}

/** 발밑 좌표 + 크기로 대략의 판정 중심 (소품은 발밑이 원점이라 위로 올린다). */
export function objectCenter(o) {
  if (o.type === 'cat') return { x: o.x, y: o.y - o.size * 0.4 };
  const def = PROPS[o.type];
  const H = o.type === 'building' ? 1 / o.aspect : o.type === 'bookshelf' ? 1.6 : o.type === 'stall' ? 1.3 : def.layer === 0 || def.layer === 2 && o.type !== 'sailboat' ? 0 : 0.5;
  return { x: o.x, y: o.y - (H * o.size) / 2 };
}

function placeProps(rng, theme, wanted) {
  const def = THEME_DEFS[theme];
  const objects = [];
  const tooClose = (o) => objects.some((p) => {
    if (p.type === 'building' || o.type === 'building') return false;
    const d = Math.hypot(p.x - o.x, p.y - o.y);
    return d < (objectRadius(p) + objectRadius(o)) * 0.55;
  });
  const add = (slot) => {
    for (let tries = 0; tries < 24; tries++) {
      const size = between(rng, slot.size[0], slot.size[1]);
      const o = {
        type: slot.type,
        x: r1(between(rng, slot.zone[0], slot.zone[1])),
        y: r1(between(rng, slot.zone[2], slot.zone[3])),
        size: r1(size),
        ...PROPS[slot.type].place(rng),
      };
      if (!tooClose(o)) {
        objects.push(o);
        return true;
      }
    }
    return false;
  };
  const counts = new Map();   // 슬롯 → 놓은 개수 (상한을 지키려고)
  for (const slot of def.slots) {
    if (slot.row) {
      // 건물처럼 한 줄로 이어 붙이는 것
      let x = slot.row.x0 + between(rng, 0, 30);
      let n = 0;
      const max = intBetween(rng, slot.count[0], slot.count[1]);
      while (x < slot.row.x1 && n < max) {
        const w = between(rng, slot.row.widths[0], slot.row.widths[1]);
        if (x + w / 2 > WIDTH - 24) break;   // 중심이 화면 밖이면 그만 (틀린그림 대상이 안 보이게 되지 않도록)
        objects.push({ type: slot.type, x: r1(x + w / 2), y: slot.row.y, size: r1(w), ...PROPS[slot.type].place(rng) });
        x += w - 4;
        n++;
      }
      // 오른쪽 끝이 비면 좁은 건물 하나로 메운다
      if (x < WIDTH - 40) objects.push({ type: slot.type, x: r1((x + WIDTH + 8) / 2), y: slot.row.y, size: r1(WIDTH + 8 - x), ...PROPS[slot.type].place(rng) });
      continue;
    }
    const n = intBetween(rng, slot.count[0], slot.count[1]);
    let placed = 0;
    for (let i = 0; i < n; i++) if (add(slot)) placed++;
    counts.set(slot, placed);
  }
  // 목표 수까지 무작위 슬롯에서 더 채우되, 슬롯 상한(작은 소품은 +2)을 넘기지 않는다
  const cap = (slot) => slot.count[1] + (slot.count[1] >= 2 && slot.size[1] <= 60 ? 2 : 0);   // 하나짜리(시계·창문·등대)는 절대 더 안 놓는다
  let guard = 0;
  while (objects.length < wanted && guard++ < 300) {
    const open = def.slots.filter((s) => !s.row && s.count[1] > 0 && (counts.get(s) ?? 0) < cap(s));
    if (!open.length) break;
    const slot = pick(rng, open);
    if (add(slot)) counts.set(slot, (counts.get(slot) ?? 0) + 1);
    else counts.set(slot, cap(slot));   // 자리가 없으면 이 슬롯은 포기
  }
  return objects;
}

/* ───────── 고양이 자리 ───────── */

/** 소품이 내놓는 고양이 자리를 장면 좌표로. */
export function catSpots(objects) {
  const out = [];
  objects.forEach((o, hostIndex) => {
    const def = PROPS[o.type];
    if (!def || !def.spots || o.hidden) return;
    for (const s of def.spots(o)) {
      const sx = o.flip ? -1 : 1;
      out.push({ hostIndex, x: r1(o.x + s.x * o.size * sx), y: r1(o.y + s.y * o.size), pose: s.pose, size: r1(s.scale * o.size) });
    }
  });
  return out;
}

export function makeCat(rng, spot, hostIndex) {
  return {
    type: 'cat', x: spot.x, y: spot.y, size: Math.max(16, spot.size), pose: spot.pose,
    color: pick(rng, PALETTE.cat), pattern: pick(rng, CAT_PATTERNS), flip: chance(rng, 0.5), host: hostIndex,
  };
}

/* ───────── 그리기 ───────── */

function renderObject(o) {
  if (o.hidden) return '';
  const t = [`translate(${o.x} ${o.y})`];
  if (o.rot) t.push(`rotate(${o.rot})`);
  t.push(`scale(${o.flip ? -o.size : o.size} ${o.size})`);
  const body = o.type === 'cat' ? renderCat(o) : PROPS[o.type].render(o);
  return `<g transform="${t.join(' ')}">${body}</g>`;
}

const layerOf = (o) => (o.type === 'cat' ? null : PROPS[o.type].layer);

/** 그리는 순서: 층 → 같은 층에선 y 순. 고양이는 자기 자리 주인 바로 뒤에. */
export function drawOrder(objects) {
  const entries = objects.map((o, i) => ({ o, i, layer: layerOf(o) }));
  const hosts = entries.filter((e) => e.o.type !== 'cat');
  hosts.sort((a, b) => a.layer - b.layer || a.o.y - b.o.y);
  const out = [];
  for (const h of hosts) {
    out.push(h.o);
    for (const e of entries) if (e.o.type === 'cat' && e.o.host === h.i) out.push(e.o);
  }
  for (const e of entries) if (e.o.type === 'cat' && (e.o.host === null || e.o.host === undefined)) out.push(e.o);
  return out;
}

export function renderScene({ theme, background, objects, seed = 1, width = WIDTH, height = HEIGHT, id = '', label = '장면' }) {
  let body = background;
  for (const o of drawOrder(objects)) body += renderObject(o);
  const fid = `w${seed % 1000}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%" ${id ? `id="${id}"` : ''} role="img" aria-label="${label}">`
    + `<defs>`
    + `<filter id="${fid}" x="-2%" y="-2%" width="104%" height="104%"><feTurbulence type="fractalNoise" baseFrequency="0.018" numOctaves="2" seed="${seed % 97}" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2.6" xChannelSelector="R" yChannelSelector="G"/></filter>`
    + `<filter id="${fid}p"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="1" seed="3"/><feColorMatrix values="0 0 0 0 0.3  0 0 0 0 0.25  0 0 0 0 0.2  0 0 0 0.08 0"/></filter>`
    + `<style>rect,circle,ellipse,path,polygon,line{stroke:${INK};stroke-width:1.5;stroke-linejoin:round;stroke-linecap:round;vector-effect:non-scaling-stroke}.noink{stroke:none}.thin{stroke-width:1;fill:none}</style>`
    + `</defs>`
    + `<g filter="url(#${fid})">${body}</g>`
    + `<rect width="${width}" height="${height}" filter="url(#${fid}p)" style="stroke:none;pointer-events:none"/>`
    + `</svg>`;
}

/* ───────── 장면 만들기 ───────── */

/**
 * 테마 장면 하나. { theme, background, objects, seed } — 고양이는 아직 없다 (spot.js 가 모드에 따라 넣는다).
 */
export function buildScene(seed, { theme = null, objects = 60 } = {}) {
  const rng = makeRng(seed);
  const rolled = pick(rng, THEMES);
  const t = THEMES.includes(theme) ? theme : rolled;
  const background = THEME_DEFS[t].background(rng);
  const props = placeProps(rng, t, objects);
  return { seed, theme: t, background, objects: props, rng };
}
