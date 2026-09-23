/**
 * 틀린그림찾기 — 장면 생성, 차이 만들기, 판정, SVG 그리기.
 *
 * 그림 파일 없이 seed 하나로 똑같은 장면을 어디서든 다시 만든다.
 * 그래서 서버와 브라우저(그리고 대전 상대)가 같은 퍼즐을 갖고, 저장할 것도 seed 뿐이다.
 * 의존성 없는 순수 모듈 — SVG 는 문자열로 만들기만 하고 DOM 은 모른다.
 */

export const WIDTH = 480;
export const HEIGHT = 360;

export const PRESETS = {
  easy: { diffs: 5, objects: 10 },
  normal: { diffs: 7, objects: 14 },
  hard: { diffs: 10, objects: 18 },
};
export const MAX_DIFFS = 12;
export const THEMES = ['park', 'sea', 'city', 'space'];
export const THEME_LABEL = { park: '공원', sea: '바다', city: '밤거리', space: '우주' };

/* ───────── 난수 ───────── */

/** mulberry32 — seed 가 같으면 같은 수열. */
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

export function randomSeed(rand = Math.random) {
  return 1 + Math.floor(rand() * 2147483646);
}

const between = (rng, lo, hi) => lo + rng() * (hi - lo);
const intBetween = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
const pick = (rng, list) => list[Math.floor(rng() * list.length)];
const round1 = (n) => Math.round(n * 10) / 10;

/* ───────── 색 ───────── */

const PALETTE = {
  warm: ['#ef5b5b', '#f0863a', '#f5c02c', '#e84f8a', '#c0392b'],
  cool: ['#3b82f6', '#6366f1', '#0ea5e9', '#14b8a6', '#8b5cf6'],
  green: ['#2e9e5b', '#4ade80', '#166534', '#84cc16', '#0f766e'],
  pastel: ['#fca5a5', '#fde68a', '#a7f3d0', '#bfdbfe', '#ddd6fe', '#fbcfe8'],
  any: ['#ef5b5b', '#f0863a', '#f5c02c', '#2e9e5b', '#3b82f6', '#8b5cf6', '#e84f8a', '#14b8a6', '#a16207', '#f8fafc'],
};

/** 지금 색과 눈에 띄게 다른 색을 고른다. */
function otherColor(rng, list, current) {
  const options = list.filter((c) => c !== current);
  return pick(rng, options.length ? options : list);
}

/* ───────── 물체 ─────────
 * 각 타입: place(rng, size) 로 고유 파라미터를 만들고, render(o) 로 (0,0) 중심의 SVG 를 그린다.
 * layer: 0 하늘(뒤) · 1 땅(y 순) · 2 공중(앞).  kinds: 적용할 수 있는 차이 종류.
 * count: 개수를 바꿀 수 있는 파라미터 {key, min, max, step}.  r: 판정 반지름 계수.
 */
const TYPES = {
  sun: {
    layer: 0, r: 0.95, kinds: ['color', 'size', 'move', 'count'], count: { key: 'rays', min: 8, max: 16, step: 4 },
    place: (rng) => ({ color: pick(rng, ['#f5c02c', '#f0863a', '#fde047']), rays: pick(rng, [8, 12, 16]) }),
    render: (o) => {
      let rays = '';
      for (let i = 0; i < o.rays; i++) {
        const a = (i / o.rays) * Math.PI * 2;
        rays += `<line x1="${round1(Math.cos(a) * 0.62)}" y1="${round1(Math.sin(a) * 0.62)}" x2="${round1(Math.cos(a) * 0.92)}" y2="${round1(Math.sin(a) * 0.92)}" stroke="${o.color}" stroke-width=".1" stroke-linecap="round"/>`;
      }
      return `${rays}<circle r=".5" fill="${o.color}"/>`;
    },
  },
  moon: {
    layer: 0, r: 0.6, kinds: ['color', 'size', 'move', 'flip'],
    place: (rng) => ({ color: pick(rng, ['#fde68a', '#f8fafc', '#fcd34d']), flip: rng() < 0.5 }),
    render: (o) => `<path d="M.15,-.5 A.5,.5 0 1,0 .15,.5 A.38,.38 0 1,1 .15,-.5 Z" fill="${o.color}"/>`,
  },
  star: {
    layer: 0, r: 0.6, kinds: ['color', 'size', 'move', 'rotate', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#fde68a', '#f8fafc', '#fcd34d', '#a5f3fc']), rot: intBetween(rng, 0, 72) }),
    render: (o) => `<path d="${starPath(5, 0.5, 0.22)}" fill="${o.color}"/>`,
  },
  cloud: {
    layer: 0, r: 0.8, kinds: ['color', 'size', 'move', 'count', 'remove', 'flip'], count: { key: 'bumps', min: 3, max: 5, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#ffffff', '#e2e8f0', '#fef3c7']), bumps: intBetween(rng, 3, 5), flip: rng() < 0.5 }),
    render: (o) => {
      let out = `<rect x="-.7" y="-.05" width="1.4" height=".35" rx=".17" fill="${o.color}"/>`;
      for (let i = 0; i < o.bumps; i++) {
        const cx = -0.55 + (1.1 * i) / Math.max(1, o.bumps - 1);
        const rr = i % 2 === 0 ? 0.28 : 0.36;
        out += `<circle cx="${round1(cx)}" cy="${i % 2 === 0 ? '-.02' : '-.12'}" r="${rr}" fill="${o.color}"/>`;
      }
      return out;
    },
  },
  planet: {
    layer: 0, r: 0.9, kinds: ['color', 'size', 'move', 'count', 'rotate'], count: { key: 'rings', min: 0, max: 2, step: 1 },
    place: (rng) => ({ color: pick(rng, PALETTE.any), ring: pick(rng, ['#e2e8f0', '#fde68a', '#c4b5fd']), rings: intBetween(rng, 0, 2), rot: intBetween(rng, -30, 30) }),
    render: (o) => {
      let out = `<circle r=".42" fill="${o.color}"/><circle cx="-.12" cy="-.1" r=".1" fill="#000" opacity=".15"/>`;
      for (let i = 0; i < o.rings; i++) out += `<ellipse rx="${0.75 + i * 0.14}" ry="${0.18 + i * 0.04}" fill="none" stroke="${o.ring}" stroke-width=".07"/>`;
      return out;
    },
  },
  tree: {
    layer: 1, r: 0.75, kinds: ['color', 'size', 'move', 'count', 'remove'], count: { key: 'tiers', min: 2, max: 4, step: 1 },
    place: (rng) => ({ color: pick(rng, PALETTE.green), tiers: intBetween(rng, 2, 4) }),
    render: (o) => {
      let out = `<rect x="-.08" y=".25" width=".16" height=".35" fill="#8b5a2b"/>`;
      for (let i = 0; i < o.tiers; i++) {
        const y = 0.3 - i * 0.28;
        const w = 0.5 - i * 0.08;
        out += `<polygon points="0,${round1(y - 0.45)} ${round1(-w)},${round1(y)} ${round1(w)},${round1(y)}" fill="${o.color}"/>`;
      }
      return out;
    },
  },
  roundtree: {
    layer: 1, r: 0.7, kinds: ['color', 'size', 'move', 'count', 'remove'], count: { key: 'fruits', min: 0, max: 4, step: 2 },
    place: (rng) => ({ color: pick(rng, PALETTE.green), fruit: pick(rng, ['#ef5b5b', '#f5c02c', '#f0863a']), fruits: pick(rng, [0, 2, 4]) }),
    render: (o) => {
      let out = `<rect x="-.07" y=".1" width=".14" height=".5" fill="#8b5a2b"/><circle cy="-.1" r=".48" fill="${o.color}"/>`;
      const spots = [[-0.2, -0.2], [0.2, 0.05], [0.05, -0.35], [-0.25, 0.12]];
      for (let i = 0; i < o.fruits; i++) out += `<circle cx="${spots[i][0]}" cy="${spots[i][1]}" r=".08" fill="${o.fruit}"/>`;
      return out;
    },
  },
  flower: {
    layer: 1, r: 0.6, kinds: ['color', 'size', 'move', 'count', 'remove'], count: { key: 'petals', min: 5, max: 8, step: 1 },
    place: (rng) => ({ color: pick(rng, [...PALETTE.warm, ...PALETTE.pastel, '#f8fafc']), petals: intBetween(rng, 5, 8) }),
    render: (o) => {
      let out = `<rect x="-.04" y=".1" width=".08" height=".55" fill="#3f9142"/>`;
      for (let i = 0; i < o.petals; i++) {
        const a = (i / o.petals) * 360;
        out += `<ellipse cx="0" cy="-.28" rx=".14" ry=".24" fill="${o.color}" transform="rotate(${round1(a)})"/>`;
      }
      return out + `<circle r=".14" fill="#f5c02c"/>`;
    },
  },
  mushroom: {
    layer: 1, r: 0.6, kinds: ['color', 'size', 'move', 'count', 'remove'], count: { key: 'dots', min: 1, max: 4, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#ef5b5b', '#f0863a', '#a16207', '#e84f8a']), dots: intBetween(rng, 1, 4) }),
    render: (o) => {
      let out = `<rect x="-.14" y="0" width=".28" height=".45" rx=".08" fill="#fef3c7"/><path d="M-.5,.05 A.5,.5 0 0,1 .5,.05 Z" fill="${o.color}"/>`;
      const spots = [[-0.25, -0.15], [0.12, -0.3], [0.3, -0.08], [-0.05, -0.1]];
      for (let i = 0; i < o.dots; i++) out += `<circle cx="${spots[i][0]}" cy="${spots[i][1]}" r=".07" fill="#fff"/>`;
      return out;
    },
  },
  house: {
    layer: 1, r: 0.8, kinds: ['color', 'size', 'move', 'count', 'flip'], count: { key: 'windows', min: 1, max: 3, step: 1 },
    place: (rng) => ({ color: pick(rng, [...PALETTE.pastel, '#f5c02c', '#ef5b5b']), roof: pick(rng, ['#c0392b', '#7c3aed', '#1f2937', '#0f766e']), windows: intBetween(rng, 1, 3), flip: rng() < 0.5 }),
    render: (o) => {
      let out = `<rect x="-.5" y="-.1" width="1" height=".6" fill="${o.color}"/><polygon points="-.6,-.1 0,-.6 .6,-.1" fill="${o.roof}"/>`;
      out += `<rect x="-.4" y=".15" width=".2" height=".35" fill="#7c4a1e"/>`;
      for (let i = 0; i < o.windows; i++) out += `<rect x="${round1(-0.08 + i * 0.22)}" y=".05" width=".16" height=".16" fill="#bfdbfe" stroke="#1f2937" stroke-width=".03"/>`;
      return out;
    },
  },
  balloon: {
    layer: 2, r: 0.6, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, [...PALETTE.warm, ...PALETTE.cool]) }),
    render: (o) => `<ellipse cy="-.15" rx=".3" ry=".38" fill="${o.color}"/><path d="M0,.23 Q.12,.45 0,.7" stroke="#334155" stroke-width=".03" fill="none"/>`,
  },
  kite: {
    layer: 2, r: 0.7, kinds: ['color', 'size', 'move', 'rotate', 'remove', 'flip'],
    place: (rng) => ({ color: pick(rng, [...PALETTE.warm, ...PALETTE.cool]), rot: intBetween(rng, -25, 25), flip: rng() < 0.5 }),
    render: (o) => `<polygon points="0,-.5 .3,-.1 0,.4 -.3,-.1" fill="${o.color}"/><line x1="-.3" y1="-.1" x2=".3" y2="-.1" stroke="#1f2937" stroke-width=".03"/><path d="M0,.4 q.15,.2 0,.4 q-.15,.2 .05,.4" stroke="#334155" stroke-width=".03" fill="none"/>`,
  },
  bird: {
    layer: 2, r: 0.55, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#1f2937', '#475569', '#0f172a', '#7c2d12']), flip: rng() < 0.5 }),
    render: (o) => `<path d="M-.5,0 Q-.25,-.35 0,0 Q.25,-.35 .5,0" stroke="${o.color}" stroke-width=".09" fill="none" stroke-linecap="round"/><circle cx=".38" cy="-.02" r=".05" fill="${o.color}"/>`,
  },
  butterfly: {
    layer: 2, r: 0.55, kinds: ['color', 'size', 'move', 'rotate', 'remove'],
    place: (rng) => ({ color: pick(rng, [...PALETTE.warm, ...PALETTE.cool, ...PALETTE.pastel]), rot: intBetween(rng, -30, 30) }),
    render: (o) => `<ellipse cx="-.22" cy="-.12" rx=".22" ry=".18" fill="${o.color}"/><ellipse cx=".22" cy="-.12" rx=".22" ry=".18" fill="${o.color}"/><ellipse cx="-.18" cy=".15" rx=".16" ry=".13" fill="${o.color}" opacity=".8"/><ellipse cx=".18" cy=".15" rx=".16" ry=".13" fill="${o.color}" opacity=".8"/><rect x="-.04" y="-.25" width=".08" height=".5" rx=".04" fill="#1f2937"/>`,
  },
  boat: {
    layer: 1, r: 0.75, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, [...PALETTE.warm, ...PALETTE.cool, '#a16207']), sail: pick(rng, ['#f8fafc', '#fde68a', '#fecaca']), flip: rng() < 0.5 }),
    render: (o) => `<polygon points="-.5,.1 .5,.1 .35,.4 -.35,.4" fill="${o.color}"/><rect x="-.02" y="-.55" width=".04" height=".65" fill="#334155"/><polygon points=".02,-.5 .45,.05 .02,.05" fill="${o.sail}"/>`,
  },
  fish: {
    layer: 1, r: 0.6, kinds: ['color', 'size', 'move', 'flip', 'count', 'remove'], count: { key: 'stripes', min: 0, max: 3, step: 1 },
    place: (rng) => ({ color: pick(rng, [...PALETTE.warm, ...PALETTE.cool]), stripes: intBetween(rng, 0, 3), flip: rng() < 0.5 }),
    render: (o) => {
      let out = `<ellipse rx=".4" ry=".24" fill="${o.color}"/><polygon points=".35,0 .6,-.2 .6,.2" fill="${o.color}"/><circle cx="-.2" cy="-.06" r=".05" fill="#fff"/><circle cx="-.2" cy="-.06" r=".025" fill="#000"/>`;
      for (let i = 0; i < o.stripes; i++) out += `<rect x="${round1(-0.05 + i * 0.12)}" y="-.22" width=".05" height=".44" fill="#fff" opacity=".6"/>`;
      return out;
    },
  },
  lighthouse: {
    layer: 1, r: 0.8, kinds: ['color', 'size', 'move', 'count'], count: { key: 'stripes', min: 2, max: 4, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#ef5b5b', '#3b82f6', '#1f2937']), stripes: intBetween(rng, 2, 4) }),
    render: (o) => {
      let out = `<polygon points="-.22,.6 .22,.6 .15,-.4 -.15,-.4" fill="#f8fafc"/>`;
      for (let i = 0; i < o.stripes; i++) out += `<rect x="-.2" y="${round1(-0.3 + i * (0.85 / o.stripes))}" width=".4" height="${round1(0.4 / o.stripes)}" fill="${o.color}"/>`;
      return out + `<rect x="-.17" y="-.6" width=".34" height=".2" fill="#fde047"/><polygon points="-.2,-.6 .2,-.6 0,-.75" fill="#1f2937"/>`;
    },
  },
  building: {
    layer: 1, r: 0.8, kinds: ['color', 'size', 'move', 'count'], count: { key: 'rows', min: 2, max: 5, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#334155', '#475569', '#1e293b', '#3f3f46', '#4c1d95']), rows: intBetween(rng, 2, 5), cols: intBetween(rng, 2, 3) }),
    render: (o) => {
      let out = `<rect x="-.4" y="-.6" width=".8" height="1.2" fill="${o.color}"/>`;
      for (let r = 0; r < o.rows; r++) {
        for (let c = 0; c < o.cols; c++) {
          const on = (r * 3 + c) % 4 !== 3;
          out += `<rect x="${round1(-0.3 + (c * 0.6) / o.cols + 0.03)}" y="${round1(-0.5 + (r * 1.0) / o.rows + 0.03)}" width="${round1(0.6 / o.cols - 0.08)}" height="${round1(1.0 / o.rows - 0.08)}" fill="${on ? '#fde68a' : '#0f172a'}"/>`;
        }
      }
      return out;
    },
  },
  car: {
    layer: 1, r: 0.65, kinds: ['color', 'size', 'move', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, [...PALETTE.warm, ...PALETTE.cool, '#f8fafc']), flip: rng() < 0.5 }),
    render: (o) => `<rect x="-.55" y="-.1" width="1.1" height=".35" rx=".1" fill="${o.color}"/><path d="M-.3,-.1 L-.2,-.35 L.25,-.35 L.4,-.1 Z" fill="${o.color}"/><rect x="-.15" y="-.3" width=".3" height=".18" fill="#bfdbfe"/><circle cx="-.3" cy=".28" r=".13" fill="#1f2937"/><circle cx=".3" cy=".28" r=".13" fill="#1f2937"/><rect x=".45" y="0" width=".1" height=".08" fill="#fde047"/>`,
  },
  lamp: {
    layer: 1, r: 0.6, kinds: ['color', 'size', 'move', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#fde047', '#fb923c', '#a5f3fc']) }),
    render: (o) => `<rect x="-.03" y="-.4" width=".06" height="1" fill="#475569"/><circle cy="-.45" r=".14" fill="${o.color}"/><circle cy="-.45" r=".24" fill="${o.color}" opacity=".25"/>`,
  },
  rocket: {
    layer: 2, r: 0.7, kinds: ['color', 'size', 'move', 'rotate', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, [...PALETTE.warm, ...PALETTE.cool, '#f8fafc']), rot: intBetween(rng, -40, 40), flip: rng() < 0.5 }),
    render: (o) => `<polygon points="-.15,.4 -.3,.6 -.15,.6" fill="#ef5b5b"/><polygon points=".15,.4 .3,.6 .15,.6" fill="#ef5b5b"/><rect x="-.15" y="-.3" width=".3" height=".75" rx=".08" fill="${o.color}"/><polygon points="-.15,-.3 0,-.6 .15,-.3" fill="#ef5b5b"/><circle cy="-.05" r=".08" fill="#bfdbfe"/><polygon points="-.1,.45 0,.7 .1,.45" fill="#fb923c"/>`,
  },
  ufo: {
    layer: 2, r: 0.75, kinds: ['color', 'size', 'move', 'count', 'remove'], count: { key: 'lights', min: 3, max: 5, step: 1 },
    place: (rng) => ({ color: pick(rng, ['#94a3b8', '#c4b5fd', '#67e8f9', '#e2e8f0']), lights: intBetween(rng, 3, 5) }),
    render: (o) => {
      let out = `<ellipse cy="-.15" rx=".28" ry=".2" fill="#bfdbfe"/><ellipse rx=".6" ry=".2" fill="${o.color}"/>`;
      for (let i = 0; i < o.lights; i++) out += `<circle cx="${round1(-0.4 + (0.8 * i) / (o.lights - 1))}" cy=".08" r=".05" fill="#fde047"/>`;
      return out;
    },
  },
  comet: {
    layer: 0, r: 0.7, kinds: ['color', 'size', 'move', 'rotate', 'flip', 'remove'],
    place: (rng) => ({ color: pick(rng, ['#fde68a', '#a5f3fc', '#f8fafc']), rot: intBetween(rng, -20, 20), flip: rng() < 0.5 }),
    render: (o) => `<polygon points="-.15,-.12 .7,-.03 -.15,.12" fill="${o.color}" opacity=".6"/><circle cx="-.2" r=".18" fill="${o.color}"/>`,
  },
};

function starPath(points, outer, inner) {
  let d = '';
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 === 0 ? outer : inner;
    const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    d += `${i === 0 ? 'M' : 'L'}${round1(Math.cos(a) * rr)},${round1(Math.sin(a) * rr)} `;
  }
  return d + 'Z';
}

/* ───────── 테마 ─────────
 * slots: 어떤 물체를 어느 구역에 몇 개 놓을지. 배경은 seed 로 색만 조금 바뀐다.
 */
const THEME_DEFS = {
  park: {
    background: (rng) => {
      const sky = pick(rng, ['#bfe3ff', '#cfe8ff', '#dbeafe']);
      const hill = pick(rng, ['#7fcf8a', '#86efac', '#a3e635']);
      const ground = pick(rng, ['#5fb96a', '#4ade80', '#65a30d']);
      return `<rect width="${WIDTH}" height="${HEIGHT}" fill="${sky}"/>`
        + `<ellipse cx="120" cy="250" rx="260" ry="90" fill="${hill}"/><ellipse cx="400" cy="260" rx="220" ry="80" fill="${hill}" opacity=".85"/>`
        + `<rect y="250" width="${WIDTH}" height="110" fill="${ground}"/>`
        + `<path d="M0,300 Q240,270 480,305 L480,360 L0,360 Z" fill="#d6b27a" opacity=".55"/>`;
    },
    slots: [
      { type: 'sun', zone: [50, 430, 40, 90], count: [1, 1], size: [40, 55] },
      { type: 'cloud', zone: [40, 440, 40, 120], count: [2, 3], size: [40, 70] },
      { type: 'tree', zone: [30, 450, 190, 260], count: [2, 4], size: [50, 80] },
      { type: 'roundtree', zone: [30, 450, 190, 260], count: [1, 3], size: [45, 75] },
      { type: 'house', zone: [80, 400, 200, 240], count: [0, 1], size: [55, 80] },
      { type: 'flower', zone: [20, 460, 280, 340], count: [3, 5], size: [22, 34] },
      { type: 'mushroom', zone: [20, 460, 290, 340], count: [1, 2], size: [22, 32] },
      { type: 'balloon', zone: [40, 440, 90, 200], count: [1, 2], size: [30, 45] },
      { type: 'kite', zone: [60, 420, 80, 180], count: [0, 1], size: [35, 50] },
      { type: 'bird', zone: [40, 440, 60, 160], count: [1, 3], size: [24, 36] },
      { type: 'butterfly', zone: [40, 440, 150, 300], count: [1, 2], size: [22, 32] },
    ],
  },
  sea: {
    background: (rng) => {
      const sky = pick(rng, ['#bae6fd', '#c7d2fe', '#fed7aa']);
      const sea = pick(rng, ['#0ea5e9', '#0284c7', '#0891b2']);
      return `<rect width="${WIDTH}" height="${HEIGHT}" fill="${sky}"/>`
        + `<rect y="200" width="${WIDTH}" height="160" fill="${sea}"/>`
        + `<path d="M0,215 Q60,205 120,215 T240,215 T360,215 T480,215" stroke="#fff" stroke-width="2" fill="none" opacity=".5"/>`
        + `<ellipse cx="400" cy="205" rx="80" ry="22" fill="#fde68a"/><rect x="392" y="160" width="6" height="48" fill="#8b5a2b"/>`
        + `<path d="M395,160 q-30,-25 -45,-5 M395,160 q30,-25 45,-5 M395,160 q-10,-35 5,-40 M395,160 q15,-30 35,-20" stroke="#2e9e5b" stroke-width="7" fill="none" stroke-linecap="round"/>`;
    },
    slots: [
      { type: 'sun', zone: [50, 300, 40, 90], count: [1, 1], size: [40, 55] },
      { type: 'cloud', zone: [40, 440, 40, 130], count: [2, 3], size: [40, 70] },
      { type: 'boat', zone: [40, 320, 195, 240], count: [2, 3], size: [45, 70] },
      { type: 'fish', zone: [30, 450, 250, 340], count: [3, 5], size: [30, 45] },
      { type: 'lighthouse', zone: [40, 300, 150, 190], count: [0, 1], size: [50, 70] },
      { type: 'bird', zone: [40, 440, 60, 170], count: [2, 3], size: [24, 36] },
      { type: 'balloon', zone: [40, 440, 90, 180], count: [0, 1], size: [30, 45] },
      { type: 'kite', zone: [60, 420, 80, 170], count: [0, 1], size: [35, 50] },
      { type: 'star', zone: [60, 420, 250, 340], count: [1, 2], size: [22, 30] },
    ],
  },
  city: {
    background: (rng) => {
      const sky = pick(rng, ['#0f172a', '#1e1b4b', '#172554']);
      const road = pick(rng, ['#334155', '#3f3f46']);
      let stars = '';
      const r2 = makeRng(1234);
      for (let i = 0; i < 28; i++) stars += `<circle cx="${round1(r2() * WIDTH)}" cy="${round1(r2() * 150)}" r="${round1(0.8 + r2() * 1.2)}" fill="#fff" opacity=".8"/>`;
      return `<rect width="${WIDTH}" height="${HEIGHT}" fill="${sky}"/>${stars}`
        + `<rect y="290" width="${WIDTH}" height="70" fill="${road}"/>`
        + `<path d="M0,325 H480" stroke="#fde68a" stroke-width="3" stroke-dasharray="24 16"/>`;
    },
    slots: [
      { type: 'moon', zone: [60, 420, 40, 90], count: [1, 1], size: [40, 52] },
      { type: 'building', zone: [40, 440, 190, 240], count: [4, 6], size: [60, 110] },
      { type: 'car', zone: [40, 440, 300, 320], count: [2, 3], size: [50, 70] },
      { type: 'lamp', zone: [30, 450, 245, 270], count: [1, 3], size: [40, 55] },
      { type: 'star', zone: [40, 440, 40, 140], count: [1, 3], size: [18, 28] },
      { type: 'balloon', zone: [40, 440, 100, 200], count: [0, 1], size: [30, 45] },
      { type: 'cloud', zone: [40, 440, 50, 130], count: [0, 2], size: [40, 60] },
      { type: 'comet', zone: [60, 420, 40, 120], count: [0, 1], size: [40, 55] },
    ],
  },
  space: {
    background: (rng) => {
      const bg = pick(rng, ['#020617', '#0f0a2a', '#111827']);
      let stars = '';
      const r2 = makeRng(777);
      for (let i = 0; i < 60; i++) stars += `<circle cx="${round1(r2() * WIDTH)}" cy="${round1(r2() * HEIGHT)}" r="${round1(0.6 + r2() * 1.4)}" fill="#fff" opacity=".8"/>`;
      return `<rect width="${WIDTH}" height="${HEIGHT}" fill="${bg}"/>${stars}`
        + `<path d="M0,340 Q240,290 480,340 L480,360 L0,360 Z" fill="#6b7280"/><ellipse cx="120" cy="345" rx="20" ry="6" fill="#4b5563"/><ellipse cx="330" cy="342" rx="26" ry="7" fill="#4b5563"/>`;
    },
    slots: [
      { type: 'planet', zone: [50, 430, 50, 250], count: [3, 4], size: [40, 75] },
      { type: 'rocket', zone: [40, 440, 60, 280], count: [1, 2], size: [45, 65] },
      { type: 'ufo', zone: [40, 440, 60, 260], count: [1, 2], size: [45, 65] },
      { type: 'star', zone: [30, 450, 30, 300], count: [4, 7], size: [18, 30] },
      { type: 'comet', zone: [40, 440, 40, 280], count: [1, 2], size: [40, 60] },
      { type: 'moon', zone: [40, 440, 40, 260], count: [0, 1], size: [35, 50] },
    ],
  },
};

/* ───────── 장면 만들기 ───────── */

/** 물체 하나의 판정 반지름 (장면 좌표). */
export function objectRadius(o) {
  return o.size * TYPES[o.type].r;
}

function placeObjects(rng, theme, wanted) {
  const def = THEME_DEFS[theme];
  const objects = [];
  const fits = (o) => objects.every((p) => Math.hypot(p.x - o.x, p.y - o.y) >= (objectRadius(p) + objectRadius(o)) * 0.75);
  const add = (slot) => {
    const size = between(rng, slot.size[0], slot.size[1]);
    for (let tries = 0; tries < 30; tries++) {
      const o = {
        type: slot.type,
        x: round1(between(rng, slot.zone[0], slot.zone[1])),
        y: round1(between(rng, slot.zone[2], slot.zone[3])),
        size: round1(size),
        ...TYPES[slot.type].place(rng),
      };
      if (fits(o)) {
        objects.push(o);
        return true;
      }
    }
    return false;
  };
  // 슬롯마다 최소 개수는 꼭 놓고, 그 다음 목표 수까지 무작위 슬롯에서 채운다
  for (const slot of def.slots) for (let i = 0; i < slot.count[0]; i++) add(slot);
  const extra = def.slots.filter((s) => s.count[1] > s.count[0]);
  let guard = 0;
  while (objects.length < wanted && guard++ < 200) {
    const slot = pick(rng, extra);
    const have = objects.filter((o) => o.type === slot.type).length;
    if (have >= slot.count[1] + 1) continue;   // 최대치보다 하나까지는 봐준다
    add(slot);
  }
  return objects;
}

/** 물체 하나에 차이를 하나 만든다. 못 만들면 null. */
function mutate(rng, o, kind) {
  const def = TYPES[o.type];
  const m = { ...o };
  switch (kind) {
    case 'color': {
      const current = o.color;
      const list = o.type === 'cloud' ? ['#ffffff', '#fecaca', '#fde68a', '#c7d2fe'] : PALETTE.any;
      m.color = otherColor(rng, list, current);
      return m;
    }
    case 'size':
      m.size = round1(o.size * (rng() < 0.5 ? 0.7 : 1.35));
      return m;
    case 'move': {
      const d = Math.max(18, objectRadius(o) * 0.9);
      const a = rng() * Math.PI * 2;
      m.x = round1(Math.min(WIDTH - 20, Math.max(20, o.x + Math.cos(a) * d)));
      m.y = round1(Math.min(HEIGHT - 20, Math.max(20, o.y + Math.sin(a) * d)));
      if (Math.hypot(m.x - o.x, m.y - o.y) < d * 0.6) return null;
      return m;
    }
    case 'flip':
      m.flip = !o.flip;
      return m;
    case 'rotate':
      m.rot = (o.rot ?? 0) + (rng() < 0.5 ? -1 : 1) * intBetween(rng, 35, 60);
      return m;
    case 'count': {
      const c = def.count;
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

export function normalizeOptions(opts = {}) {
  const preset = PRESETS[opts.difficulty] ? opts.difficulty : null;
  const rawDiffs = Number(opts.diffs);
  const diffs = preset ? PRESETS[preset].diffs : Number.isFinite(rawDiffs) ? Math.min(MAX_DIFFS, Math.max(1, Math.trunc(rawDiffs))) : PRESETS.normal.diffs;
  const objects = preset ? PRESETS[preset].objects : Math.max(diffs + 4, PRESETS.normal.objects);
  const theme = THEMES.includes(opts.theme) ? opts.theme : null;   // null 이면 seed 로 고른다
  return { difficulty: preset ?? 'custom', diffs, objects, theme };
}

/**
 * 퍼즐 하나. seed 가 같으면 언제 어디서 만들어도 똑같다.
 * @returns {{ seed, theme, width, height, left: object[], right: object[], diffs: {index, kind, cx, cy, r}[] }}
 */
export function generatePuzzle(opts = {}) {
  const seed = Number(opts.seed) > 0 ? Math.trunc(Number(opts.seed)) : randomSeed();
  const o = normalizeOptions(opts);
  const rng = makeRng(seed);
  const rolled = pick(rng, THEMES);          // 테마를 명시해도 난수는 똑같이 소비 — seed 결정성 유지
  const theme = o.theme ?? rolled;
  const background = THEME_DEFS[theme].background(rng);
  const left = placeObjects(rng, theme, Math.max(o.objects, o.diffs + 3));
  const right = left.map((x) => ({ ...x }));

  // 차이를 줄 물체를 고른다 — 서로 다른 물체에 하나씩, 큰 물체부터 우선하지 않고 무작위
  const order = left.map((_, i) => i).sort(() => rng() - 0.5);
  const diffs = [];
  for (const index of order) {
    if (diffs.length >= o.diffs) break;
    const obj = left[index];
    const kinds = [...TYPES[obj.type].kinds].sort(() => rng() - 0.5);
    for (const kind of kinds) {
      const m = mutate(rng, obj, kind);
      if (!m) continue;
      // 바뀐 쪽을 왼쪽/오른쪽 무작위로 — "오른쪽이 항상 바뀐 그림" 이 아니게
      const changedSide = rng() < 0.5 ? 'left' : 'right';
      if (changedSide === 'right') right[index] = m;
      else left[index] = m;
      const a = left[index];
      const b = right[index];
      const cx = round1((a.x + b.x) / 2);
      const cy = round1((a.y + b.y) / 2);
      const spread = Math.hypot(a.x - b.x, a.y - b.y) / 2;
      const r = round1(Math.max(objectRadius(a), objectRadius(b)) + spread + 10);
      diffs.push({ index, kind, cx, cy, r: Math.min(130, Math.max(22, r)) });
      break;
    }
  }
  return { seed, theme, width: WIDTH, height: HEIGHT, background, left, right, diffs };
}

/** (x, y) 가 어느 차이 안인지. 여러 개에 겹치면 가장 가까운 것. 없으면 -1. */
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

/* ───────── 그리기 ───────── */

function renderObject(o) {
  if (o.hidden) return '';
  const def = TYPES[o.type];
  const t = [`translate(${o.x} ${o.y})`];
  if (o.rot) t.push(`rotate(${o.rot})`);
  t.push(`scale(${o.flip ? -o.size : o.size} ${o.size})`);
  return `<g transform="${t.join(' ')}">${def.render(o)}</g>`;
}

const LAYER = (o) => TYPES[o.type].layer;

/** 장면 하나(왼쪽 또는 오른쪽)를 SVG 문자열로. 뒤(하늘) → 땅(y 순) → 앞(공중) 순서로 그린다. */
export function renderScene(puzzle, side, { id = '' } = {}) {
  const objects = [...(side === 'left' ? puzzle.left : puzzle.right)]
    .map((o, i) => ({ o, i }))
    .sort((a, b) => LAYER(a.o) - LAYER(b.o) || a.o.y - b.o.y);
  let body = puzzle.background;
  for (const { o } of objects) body += renderObject(o);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${puzzle.width} ${puzzle.height}" width="100%" height="100%" ${id ? `id="${id}"` : ''} role="img" aria-label="틀린그림 ${side === 'left' ? '왼쪽' : '오른쪽'}">${body}</svg>`;
}

/** 브라우저에 보낼 수 있는, 정답이 빠진 퍼즐. (대전에서 상대에게 차이 위치가 새지 않게) */
export function publicPuzzle(puzzle) {
  const { diffs, ...rest } = puzzle;
  return { ...rest, diffCount: diffs.length };
}
