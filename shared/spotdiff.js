/**
 * 틀린그림찾기 — 그림 생성기.
 *
 * 시드 하나로 장면(물건 목록)을 만들고, 그중 몇 개를 살짝 바꿔 두 번째 그림을 만든다.
 * 그림 파일은 없다. 모든 것이 데이터이고, 그리기는 SVG 문자열로만 한다.
 * 서버와 브라우저가 그대로 함께 쓰는 순수 모듈 (의존성 없음).
 */

export const SCENE_W = 400;
export const SCENE_H = 300;
export const MIN_HIT_RADIUS = 14; // 손가락으로 누를 수 있는 최소 판정 반지름
export const MAX_HIT_RADIUS = 40;
export const TAP_SLOP = 6;        // 판정 원 바깥 여유

export const LEVELS = {
  easy:   { key: 'easy',   label: '쉬움',   diffs: 5, seconds: 90,  types: ['remove', 'color', 'size'], sizeFactor: 1.5 },
  normal: { key: 'normal', label: '보통',   diffs: 7, seconds: 120, types: ['remove', 'color', 'size', 'variant', 'flip'], sizeFactor: 1.4 },
  hard:   { key: 'hard',   label: '어려움', diffs: 9, seconds: 150, types: ['remove', 'color', 'size', 'variant', 'flip', 'color2'], sizeFactor: 1.3 },
};
export const DEFAULT_LEVEL = 'normal';

export const THEMES = { meadow: '들판', sea: '바닷속', night: '밤거리' };

/* ───────── 난수 ───────── */

/** 시드로 정해지는 난수 생성기 (mulberry32). 같은 시드 → 같은 그림. */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (rand, list) => list[Math.floor(rand() * list.length)];
const between = (rand, a, b) => a + rand() * (b - a);
const int = (rand, a, b) => a + Math.floor(rand() * (b - a + 1));
const r1 = (v) => Math.round(v * 10) / 10;

/* ───────── 그리기 도우미 ───────── */

const HEX = /^#[0-9a-fA-F]{3,8}$/;
const col = (v, fallback = '#888888') => (typeof v === 'string' && HEX.test(v) ? v : fallback);
const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

function starPath(outer, inner, points = 5) {
  const pts = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push(`${r1(Math.cos(a) * r)},${r1(Math.sin(a) * r)}`);
  }
  return `M${pts.join('L')}Z`;
}

/** 건물 창문 위치 (지역 좌표). 건물의 w, h 로 결정된다. */
export function buildingWindows(w, h) {
  const cols = Math.max(1, Math.floor((w - 10) / 14));
  const rows = Math.max(1, Math.floor((h - 18) / 20));
  const x0 = -((cols - 1) * 14) / 2;
  const y0 = -h / 2 + 16;
  const out = [];
  for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) out.push({ x: x0 + c * 14, y: y0 + r * 20 });
  return out;
}

/* ───────── 물건 종류 ─────────
 * R: 크기 1일 때의 대략적 반지름 (겹침 검사·판정 원에 쓴다)
 * palette / palette2: 색 후보. 색 바꾸기 차이는 이 안에서 고른다.
 * diffs: 이 물건에 만들 수 있는 차이 종류
 * variants: 모양 변형 개수 (variant 차이용) — 대신 variant() 함수로 직접 정할 수도 있다
 * draw(it): 지역 좌표(중심 0,0)에 그리는 SVG 조각
 */
const KINDS = {
  sun: {
    R: 22,
    palette: ['#ffd23f', '#ff9f1c', '#ff6b6b'],
    diffs: ['remove', 'color', 'size', 'variant'],
    variants: 3,
    draw(it) {
      const c = col(it.c);
      const n = [8, 10, 12][it.v % 3];
      let rays = '';
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        rays += `<line x1="${r1(Math.cos(a) * 17)}" y1="${r1(Math.sin(a) * 17)}" x2="${r1(Math.cos(a) * 24)}" y2="${r1(Math.sin(a) * 24)}"/>`;
      }
      return `<g stroke="${c}" stroke-width="3" stroke-linecap="round">${rays}</g><circle r="14" fill="${c}"/>`;
    },
  },

  cloud: {
    R: 24,
    palette: ['#ffffff'],
    diffs: ['remove', 'size', 'variant'],
    variants: 2,
    draw(it) {
      const c = col(it.c, '#ffffff');
      let s = `<ellipse cy="5" rx="24" ry="8" fill="${c}"/><circle cx="-10" r="10" fill="${c}"/><circle cx="6" cy="-4" r="12" fill="${c}"/>`;
      if (it.v % 2 === 1) s += `<circle cx="17" cy="2" r="8" fill="${c}"/>`;
      return s;
    },
  },

  bird: {
    R: 11,
    palette: ['#2b2d42', '#6c757d', '#9d0208'],
    diffs: ['remove', 'color', 'size'],
    draw(it) {
      return `<path d="M-10,1 Q-5,-7 0,0 Q5,-7 10,1" fill="none" stroke="${col(it.c)}" stroke-width="2.4" stroke-linecap="round"/>`;
    },
  },

  tree: {
    R: 24,
    palette: ['#3fa34d', '#8bc34a', '#1f6b3a', '#d4a017', '#e67e22'],
    palette2: ['#8b5a2b', '#5d3a1a', '#b07a45'],
    diffs: ['remove', 'color', 'size', 'variant', 'color2'],
    variants: 3,
    draw(it) {
      const c = col(it.c);
      const c2 = col(it.c2, '#8b5a2b');
      let s = `<rect x="-4" y="4" width="8" height="20" rx="2" fill="${c2}"/>`;
      const v = it.v % 3;
      if (v === 1) s += `<path d="M0,-26 L17,6 L-17,6Z" fill="${c}"/>`;
      else {
        s += `<circle cy="-6" r="17" fill="${c}"/>`;
        if (v === 2) s += `<g fill="#e63946"><circle cx="-7" cy="-9" r="3"/><circle cx="6" cy="-2" r="3"/><circle cx="2" cy="-15" r="3"/></g>`;
      }
      return s;
    },
  },

  house: {
    R: 25,
    palette: ['#f6e7c1', '#ffb4a2', '#a2d2ff', '#caffbf', '#ffd6a5'],
    palette2: ['#d62828', '#3a86ff', '#6a4c93', '#2a9d8f'],
    diffs: ['remove', 'color', 'size', 'variant', 'color2'],
    make() {
      return { v: 3 }; // 기본은 창문 두 개
    },
    // 창문 하나를 켜거나 끈다 — 판정 원은 그 창문 위에
    variant(it, rand) {
      const bit = rand() < 0.5 ? 1 : 2;
      const v = (it.v ?? 3) ^ bit;
      return { patch: { v }, at: [bit === 1 ? -10 : 10, 3, 9] };
    },
    draw(it) {
      const c = col(it.c);
      const c2 = col(it.c2, '#d62828');
      const v = it.v ?? 3;
      let s = `<rect x="-18" y="-6" width="36" height="26" fill="${c}"/><path d="M-22,-6 L0,-26 L22,-6Z" fill="${c2}"/>`;
      s += `<rect x="-4" y="8" width="8" height="12" fill="#6b4226"/>`;
      if (v & 1) s += `<rect x="-14" y="-1" width="8" height="8" fill="#bfe3ff" stroke="#5c4a3a" stroke-width="1"/>`;
      if (v & 2) s += `<rect x="6" y="-1" width="8" height="8" fill="#bfe3ff" stroke="#5c4a3a" stroke-width="1"/>`;
      return s;
    },
  },

  flower: {
    R: 12,
    palette: ['#ff4d6d', '#ffd60a', '#9d4edd', '#4cc9f0', '#ffffff', '#ff8fab'],
    palette2: ['#ffd60a', '#ff8800', '#6b3e26'],
    diffs: ['remove', 'color', 'size', 'variant', 'color2'],
    variants: 2,
    draw(it) {
      const c = col(it.c);
      const c2 = col(it.c2, '#ffd60a');
      const n = [5, 6][it.v % 2];
      let s = `<line y1="2" y2="15" stroke="#3c8d3c" stroke-width="2"/>`;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        s += `<circle cx="${r1(Math.cos(a) * 6)}" cy="${r1(Math.sin(a) * 6)}" r="4.2" fill="${c}"/>`;
      }
      return s + `<circle r="3.5" fill="${c2}"/>`;
    },
  },

  mushroom: {
    R: 13,
    palette: ['#e63946', '#f4a261', '#8d5524', '#7209b7'],
    diffs: ['remove', 'color', 'size', 'variant'],
    variants: 3,
    draw(it) {
      const c = col(it.c);
      const dots = [[-5, -4], [4, -6], [0, -1]].slice(0, (it.v % 3) + 1);
      let s = `<rect x="-4" y="0" width="8" height="11" rx="2" fill="#f3e6cf"/><path d="M-12,1 Q0,-18 12,1 Z" fill="${c}"/>`;
      for (const [x, y] of dots) s += `<circle cx="${x}" cy="${y}" r="2" fill="#ffffff"/>`;
      return s;
    },
  },

  fence: {
    R: 22,
    palette: ['#f8f9fa', '#a0522d', '#6c757d'],
    diffs: ['remove', 'color', 'variant'],
    variants: 2,
    draw(it) {
      const c = col(it.c);
      const n = [3, 4][it.v % 2];
      let s = `<rect x="-20" y="-5" width="40" height="3" fill="${c}"/><rect x="-20" y="3" width="40" height="3" fill="${c}"/>`;
      for (let i = 0; i < n; i++) {
        const x = -18 + (i * 36) / (n - 1);
        s += `<path d="M${r1(x - 2.5)},10 V-9 L${r1(x)},-12 L${r1(x + 2.5)},-9 V10Z" fill="${c}" stroke="rgba(0,0,0,.2)" stroke-width=".6"/>`;
      }
      return s;
    },
  },

  fish: {
    R: 18,
    palette: ['#ff7b00', '#ffd000', '#4cc9f0', '#f72585', '#80ed99', '#b8b8ff'],
    palette2: ['#ffffff', '#1d3557', '#ff006e', '#fb8500'],
    diffs: ['remove', 'color', 'size', 'variant', 'flip', 'color2'],
    variants: 3,
    flip: true,
    draw(it) {
      const c = col(it.c);
      const c2 = col(it.c2, '#ffffff');
      let s = `<path d="M13,0 L24,-9 L24,9Z" fill="${c2}"/><path d="M-2,-9 L6,-15 L8,-8Z" fill="${c2}"/><ellipse rx="16" ry="10" fill="${c}"/>`;
      const stripes = it.v % 3;
      if (stripes >= 1) s += `<line x1="0" y1="-9" x2="0" y2="9" stroke="${c2}" stroke-width="2.5"/>`;
      if (stripes >= 2) s += `<line x1="7" y1="-7" x2="7" y2="7" stroke="${c2}" stroke-width="2.5"/>`;
      return s + `<circle cx="-9" cy="-2" r="2.6" fill="#ffffff"/><circle cx="-9" cy="-2" r="1.4" fill="#111111"/>`;
    },
  },

  bubble: {
    R: 7,
    palette: ['#d7f3ff'],
    diffs: ['remove', 'size'],
    draw(it) {
      const c = col(it.c, '#d7f3ff');
      return `<circle r="6" fill="none" stroke="${c}" stroke-width="1.6" opacity=".85"/><circle cx="-2" cy="-2" r="1.5" fill="${c}"/>`;
    },
  },

  jellyfish: {
    R: 16,
    palette: ['#ff99c8', '#d0a2f7', '#a0c4ff', '#fcf6bd'],
    diffs: ['remove', 'color', 'size', 'variant'],
    variants: 2,
    draw(it) {
      const c = col(it.c);
      const n = [3, 4][it.v % 2];
      let s = `<path d="M-13,0 Q-13,-16 0,-16 Q13,-16 13,0 Z" fill="${c}" opacity=".9"/>`;
      for (let i = 0; i < n; i++) {
        const x = -9 + (i * 18) / (n - 1);
        s += `<path d="M${x},0 Q${r1(x - 3)},7 ${x},12 Q${r1(x + 3)},16 ${x},20" fill="none" stroke="${c}" stroke-width="2" stroke-linecap="round"/>`;
      }
      return s;
    },
  },

  seaweed: {
    R: 20,
    palette: ['#1b7a43', '#58b368', '#a3c85a', '#7a4e9f'],
    diffs: ['remove', 'color', 'size', 'variant'],
    variants: 2,
    draw(it) {
      const c = col(it.c);
      const n = [2, 3][it.v % 2];
      let s = '';
      for (let i = 0; i < n; i++) {
        const x = n === 2 ? (i === 0 ? -5 : 5) : -7 + i * 7;
        const top = -22 + (i % 2) * 8;
        s += `<path d="M${x},22 Q${x - 8},8 ${x},0 Q${x + 8},${top + 12} ${x},${top}" fill="none" stroke="${c}" stroke-width="4" stroke-linecap="round"/>`;
      }
      return s;
    },
  },

  shell: {
    R: 11,
    palette: ['#ffcad4', '#f4d35e', '#ffffff', '#f79d65'],
    diffs: ['remove', 'color', 'size'],
    draw(it) {
      const c = col(it.c);
      return `<path d="M0,8 L-11,-2 Q0,-14 11,-2 Z" fill="${c}"/><g stroke="rgba(0,0,0,.22)" stroke-width="1"><line x1="0" y1="8" x2="-6" y2="-6"/><line x1="0" y1="8" x2="0" y2="-8"/><line x1="0" y1="8" x2="6" y2="-6"/></g>`;
    },
  },

  starfish: {
    R: 12,
    palette: ['#ff6b35', '#e63946', '#ffbe0b', '#c77dff'],
    diffs: ['remove', 'color', 'size'],
    draw(it) {
      return `<path d="${starPath(12, 5.5)}" fill="${col(it.c)}" stroke="rgba(0,0,0,.15)" stroke-width="1"/>`;
    },
  },

  rock: {
    R: 17,
    palette: ['#6c757d', '#495057', '#8d6e63', '#adb5bd'],
    diffs: ['remove', 'color', 'size'],
    draw(it) {
      return `<ellipse cy="4" rx="17" ry="11" fill="${col(it.c)}"/><ellipse cx="-5" cy="0" rx="6" ry="3" fill="rgba(255,255,255,.18)"/>`;
    },
  },

  crab: {
    R: 15,
    palette: ['#e63946', '#f77f00', '#9d0208'],
    diffs: ['remove', 'color', 'size'],
    draw(it) {
      const c = col(it.c);
      return `<g stroke="${c}" stroke-width="2.4" stroke-linecap="round"><line x1="-10" y1="2" x2="-17" y2="8"/><line x1="-11" y1="5" x2="-16" y2="12"/><line x1="10" y1="2" x2="17" y2="8"/><line x1="11" y1="5" x2="16" y2="12"/><line x1="-8" y1="-5" x2="-15" y2="-9"/><line x1="8" y1="-5" x2="15" y2="-9"/></g><circle cx="-16" cy="-10" r="4.5" fill="${c}"/><circle cx="16" cy="-10" r="4.5" fill="${c}"/><ellipse rx="12" ry="8" fill="${c}"/><circle cx="-4" cy="-3" r="2" fill="#ffffff"/><circle cx="4" cy="-3" r="2" fill="#ffffff"/><circle cx="-4" cy="-3" r="1" fill="#111111"/><circle cx="4" cy="-3" r="1" fill="#111111"/>`;
    },
  },

  moon: {
    R: 18,
    palette: ['#f5f3ce', '#ffe066', '#ffb4a2'],
    diffs: ['remove', 'color', 'size', 'variant'],
    variants: 2,
    draw(it) {
      const c = col(it.c);
      if (it.v % 2 === 1) return `<path d="M5,-16 A16,16 0 1 0 5,16 A12,12 0 1 1 5,-16Z" fill="${c}"/>`;
      return `<circle r="16" fill="${c}"/><circle cx="-5" cy="-3" r="3" fill="rgba(0,0,0,.08)"/><circle cx="5" cy="6" r="4" fill="rgba(0,0,0,.08)"/>`;
    },
  },

  star: {
    R: 6,
    palette: ['#fff7c2', '#ffffff', '#ffe27a', '#cde3ff'],
    diffs: ['remove', 'size'],
    draw(it) {
      return `<path d="${starPath(6, 2.6)}" fill="${col(it.c, '#fff7c2')}"/>`;
    },
  },

  building: {
    R: 30,
    palette: ['#3d405b', '#4a4e69', '#2b2d42', '#5c3c4f', '#264653'],
    diffs: ['variant'],
    // 창문 하나의 불을 켜거나 끈다 — 판정 원은 그 창문 위에
    variant(it, rand) {
      const wins = buildingWindows(it.w, it.h);
      if (!wins.length) return null;
      const i = int(rand, 0, wins.length - 1);
      const m = it.m.split('');
      m[i] = m[i] === '1' ? '0' : '1';
      return { patch: { m: m.join('') }, at: [wins[i].x, wins[i].y, 9] };
    },
    box(it) {
      return [-it.w / 2, -it.h / 2, it.w / 2, it.h / 2];
    },
    draw(it) {
      const w = num(it.w, 50);
      const h = num(it.h, 100);
      const m = String(it.m ?? '');
      let s = `<rect x="${r1(-w / 2)}" y="${r1(-h / 2)}" width="${w}" height="${h}" fill="${col(it.c)}"/><rect x="${r1(-w / 2)}" y="${r1(-h / 2)}" width="${w}" height="5" fill="rgba(0,0,0,.28)"/>`;
      buildingWindows(w, h).forEach((p, i) => {
        s += `<rect x="${r1(p.x - 3.5)}" y="${r1(p.y - 4.5)}" width="7" height="9" fill="${m[i] === '1' ? '#ffd86b' : '#161a33'}"/>`;
      });
      return s;
    },
  },

  lamp: {
    R: 26,
    palette: ['#6b7088'],
    diffs: ['remove', 'variant'],
    box() {
      return [-12, -40, 12, 28];
    },
    variant(it) {
      return { patch: { v: (it.v ?? 1) ^ 1 }, at: [0, -28, 10] };
    },
    draw(it) {
      const lit = (it.v ?? 1) % 2 === 1;
      let s = lit ? `<circle cy="-28" r="13" fill="#ffe27a" opacity=".22"/>` : '';
      s += `<rect x="-1.5" y="-26" width="3" height="54" fill="${col(it.c, '#6b7088')}"/><rect x="-5" y="26" width="10" height="3" fill="${col(it.c, '#6b7088')}"/>`;
      s += `<circle cy="-28" r="5" fill="${lit ? '#ffe27a' : '#4a4f66'}"/>`;
      return s;
    },
  },

  car: {
    R: 20,
    palette: ['#e63946', '#ffd166', '#118ab2', '#06d6a0', '#f8f9fa', '#8338ec'],
    diffs: ['remove', 'color', 'size', 'flip'],
    flip: true,
    draw(it) {
      const c = col(it.c);
      return `<path d="M-20,4 L-20,-3 Q-18,-6 -12,-6 L-7,-13 L8,-13 L13,-6 Q19,-6 20,-2 L20,4 Z" fill="${c}"/><path d="M-9,-6 L-5,-11 L-1,-11 L-1,-6Z" fill="#bfe3ff"/><path d="M1,-6 L1,-11 L7,-11 L10,-6Z" fill="#bfe3ff"/><circle cx="-11" cy="5" r="4.5" fill="#111111"/><circle cx="11" cy="5" r="4.5" fill="#111111"/><circle cx="-11" cy="5" r="1.8" fill="#999999"/><circle cx="11" cy="5" r="1.8" fill="#999999"/><circle cx="19" cy="-1" r="1.8" fill="#ffe27a"/>`;
    },
  },
};

export const KIND_NAMES = Object.keys(KINDS);

function radiusOf(it) {
  return KINDS[it.k].R * it.s;
}

/** 물건의 대략적 화면 상자 [x0, y0, x1, y1]. */
function boxOf(it) {
  const kind = KINDS[it.k];
  const b = kind.box ? kind.box(it) : [-kind.R, -kind.R, kind.R, kind.R];
  const sx = it.f ? -it.s : it.s;
  const xs = [it.x + b[0] * sx, it.x + b[2] * sx];
  return [Math.min(...xs), it.y + b[1] * it.s, Math.max(...xs), it.y + b[3] * it.s];
}

/* ───────── 장면 만들기 ───────── */

function makeItem(rand, k, x, y, s, layer, over = {}) {
  const kind = KINDS[k];
  const it = { k, x: r1(x), y: r1(y), s: r1(s), c: pick(rand, kind.palette) };
  if (kind.palette2) it.c2 = pick(rand, kind.palette2);
  if (kind.variants) it.v = int(rand, 0, kind.variants - 1);
  if (kind.flip) it.f = rand() < 0.5 ? 1 : 0;
  if (kind.make) Object.assign(it, kind.make(rand));
  Object.assign(it, over);
  it.z = layer * 1000 + it.y; // 그리는 순서 — 보내기 전에 지운다
  return it;
}

/**
 * 영역 안에 물건을 겹치지 않게 흩뿌린다.
 * @param {object} spec { x:[a,b], y:[a,b], s:[a,b], layer, gap, ignore:[kinds], over:{} }
 */
function scatter(items, rand, k, count, spec) {
  const gap = spec.gap ?? 0.95;
  const ignore = new Set(spec.ignore ?? []);
  let placed = 0;
  for (let n = 0; n < count; n++) {
    for (let attempt = 0; attempt < 40; attempt++) {
      const s = r1(between(rand, spec.s[0], spec.s[1]));
      const x = between(rand, spec.x[0], spec.x[1]);
      const y = between(rand, spec.y[0], spec.y[1]);
      const r = KINDS[k].R * s;
      const ok = items.every((o) => {
        if (ignore.has(o.k)) return true;
        return Math.hypot(o.x - x, o.y - y) >= (r + radiusOf(o)) * gap;
      });
      if (!ok) continue;
      items.push(makeItem(rand, k, x, y, s, spec.layer, spec.over));
      placed++;
      break;
    }
  }
  return placed;
}

const THEME_BUILDERS = {
  meadow(rand) {
    const bg = {
      theme: 'meadow',
      sky1: pick(rand, ['#7ec8f5', '#9ad7ff', '#b3e0ff']),
      sky2: pick(rand, ['#dff3ff', '#e9f6ff']),
      hill1: '#7cc576',
      hill2: '#69b865',
      ground: '#8bd17f',
    };
    const items = [];
    scatter(items, rand, 'sun', 1, { x: [45, 355], y: [30, 55], s: [0.9, 1.2], layer: 0 });
    scatter(items, rand, 'cloud', int(rand, 2, 3), { x: [35, 365], y: [25, 95], s: [0.8, 1.2], layer: 1 });
    scatter(items, rand, 'bird', int(rand, 2, 3), { x: [30, 370], y: [30, 120], s: [0.8, 1.1], layer: 2 });
    scatter(items, rand, 'house', 2, { x: [40, 360], y: [152, 185], s: [0.9, 1.1], layer: 3 });
    scatter(items, rand, 'tree', int(rand, 3, 4), { x: [22, 378], y: [150, 200], s: [0.8, 1.1], layer: 3 });
    scatter(items, rand, 'fence', int(rand, 1, 2), { x: [45, 355], y: [200, 218], s: [0.9, 1.1], layer: 3 });
    scatter(items, rand, 'flower', int(rand, 6, 8), { x: [15, 385], y: [218, 283], s: [0.9, 1.3], layer: 3 });
    scatter(items, rand, 'mushroom', int(rand, 2, 4), { x: [15, 385], y: [222, 283], s: [0.9, 1.2], layer: 3 });
    return { bg, items };
  },

  sea(rand) {
    const bg = {
      theme: 'sea',
      water1: pick(rand, ['#2a8fc9', '#1f7fb8', '#3aa0d8']),
      water2: pick(rand, ['#0d3f66', '#0a3357']),
      sand: pick(rand, ['#e6cf94', '#dcc38a']),
    };
    const items = [];
    scatter(items, rand, 'bubble', int(rand, 5, 7), { x: [15, 385], y: [15, 210], s: [0.7, 1.3], layer: 0 });
    scatter(items, rand, 'jellyfish', int(rand, 1, 2), { x: [30, 370], y: [35, 130], s: [0.9, 1.2], layer: 1 });
    scatter(items, rand, 'fish', int(rand, 5, 6), { x: [30, 370], y: [40, 215], s: [0.8, 1.2], layer: 1 });
    scatter(items, rand, 'seaweed', int(rand, 3, 4), { x: [20, 380], y: [222, 250], s: [0.9, 1.3], layer: 2 });
    scatter(items, rand, 'rock', int(rand, 2, 3), { x: [25, 375], y: [255, 282], s: [0.8, 1.2], layer: 3 });
    scatter(items, rand, 'shell', int(rand, 2, 3), { x: [20, 380], y: [258, 290], s: [0.9, 1.2], layer: 3 });
    scatter(items, rand, 'starfish', int(rand, 1, 2), { x: [20, 380], y: [255, 290], s: [0.9, 1.2], layer: 3 });
    scatter(items, rand, 'crab', int(rand, 1, 2), { x: [25, 375], y: [258, 285], s: [0.9, 1.1], layer: 3 });
    return { bg, items };
  },

  night(rand) {
    const bg = {
      theme: 'night',
      sky1: pick(rand, ['#0b1030', '#120c2e']),
      sky2: pick(rand, ['#2c2f63', '#3a2f63']),
      sidewalk: '#3a3a48',
      road: '#23232e',
    };
    const items = [];
    scatter(items, rand, 'moon', 1, { x: [40, 360], y: [25, 55], s: [0.9, 1.2], layer: 0 });
    scatter(items, rand, 'star', int(rand, 7, 9), { x: [10, 390], y: [10, 110], s: [0.7, 1.2], layer: 0 });
    scatter(items, rand, 'cloud', int(rand, 1, 2), { x: [40, 360], y: [30, 80], s: [0.8, 1.1], layer: 0, over: { c: '#3b4270' } });

    // 건물은 흩뿌리지 않고 지평선을 따라 줄지어 세운다
    let x = between(rand, -20, 6);
    while (x < SCENE_W) {
      const w = int(rand, 46, 78);
      const h = int(rand, 80, 165);
      const wins = buildingWindows(w, h);
      let m = '';
      for (let i = 0; i < wins.length; i++) m += rand() < 0.45 ? '1' : '0';
      items.push(makeItem(rand, 'building', x + w / 2, 235 - h / 2, 1, 1, { w, h, m, v: 0 }));
      x += w + int(rand, 2, 10);
    }

    scatter(items, rand, 'lamp', int(rand, 2, 3), { x: [20, 380], y: [214, 216], s: [1, 1], layer: 2, ignore: ['building', 'star', 'cloud'], over: { v: 1 } });
    scatter(items, rand, 'tree', int(rand, 1, 2), { x: [20, 380], y: [220, 224], s: [0.8, 0.9], layer: 2, ignore: ['building', 'star', 'cloud'], over: { c: '#1f6b3a' } });
    scatter(items, rand, 'car', int(rand, 2, 3), { x: [30, 370], y: [262, 285], s: [0.9, 1.1], layer: 3, ignore: ['building', 'star', 'cloud'] });
    return { bg, items };
  },
};

/* ───────── 차이 만들기 ───────── */

function hitRadius(r) {
  return Math.min(MAX_HIT_RADIUS, Math.max(MIN_HIT_RADIUS, r));
}

/** 지역 좌표 → 장면 좌표 */
function toScene(it, lx, ly, s = it.s) {
  return { x: it.x + lx * (it.f ? -s : s), y: it.y + ly * s };
}

function otherColor(rand, list, current) {
  const rest = list.filter((c) => c !== current);
  return rest.length ? pick(rand, rest) : null;
}

/**
 * 물건 하나에 차이 하나를 만든다.
 * @returns {{patch:object|null, hide:boolean, x:number, y:number, r:number}|null}
 */
function makeChange(type, it, level, rand) {
  const kind = KINDS[it.k];
  const centre = { x: it.x, y: it.y, r: hitRadius(radiusOf(it)) };
  switch (type) {
    case 'remove':
      return { ...centre, hide: true, patch: null };
    case 'color': {
      const c = otherColor(rand, kind.palette, it.c);
      return c ? { ...centre, hide: false, patch: { c } } : null;
    }
    case 'color2': {
      const c2 = otherColor(rand, kind.palette2 ?? [], it.c2);
      return c2 ? { ...centre, hide: false, patch: { c2 } } : null;
    }
    case 'size': {
      const grow = rand() < 0.5;
      const s = r1(grow ? it.s * level.sizeFactor : it.s / level.sizeFactor);
      const r = hitRadius(kind.R * Math.max(s, it.s));
      // 커져서 화면 밖으로 나가면 곤란하다
      if (it.x - r < 2 || it.x + r > SCENE_W - 2 || it.y - r < 2 || it.y + r > SCENE_H - 2) return null;
      return { ...centre, r, hide: false, patch: { s } };
    }
    case 'flip':
      if (!kind.flip) return null;
      return { ...centre, hide: false, patch: { f: it.f ? 0 : 1 } };
    case 'variant': {
      if (kind.variant) {
        const out = kind.variant(it, rand);
        if (!out) return null;
        const p = toScene(it, out.at[0], out.at[1]);
        if (p.x < 8 || p.x > SCENE_W - 8 || p.y < 8 || p.y > SCENE_H - 8) return null;
        return { x: r1(p.x), y: r1(p.y), r: hitRadius(out.at[2] * it.s), hide: false, patch: out.patch };
      }
      if (!kind.variants || kind.variants < 2) return null;
      let v = int(rand, 0, kind.variants - 2);
      if (v >= it.v) v++;
      return { ...centre, hide: false, patch: { v } };
    }
    default:
      return null;
  }
}

/** 나중에 그려지는 물건이 판정 원을 가리는가 */
function occluded(items, idx, hit) {
  const inner = hit.r * 0.6;
  for (let j = idx + 1; j < items.length; j++) {
    const b = boxOf(items[j]);
    if (hit.x + inner > b[0] && hit.x - inner < b[2] && hit.y + inner > b[1] && hit.y - inner < b[3]) return true;
  }
  return false;
}

function chooseDiffs(items, level, rand) {
  const order = items.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const diffs = [];
  for (const idx of order) {
    if (diffs.length === level.diffs) break;
    const it = items[idx];
    const types = KINDS[it.k].diffs.filter((t) => level.types.includes(t));
    if (!types.length) continue;
    const change = makeChange(pick(rand, types), it, level, rand);
    if (!change) continue;
    // 판정 원의 여유(TAP_SLOP)까지 서로 겹치지 않게
    if (diffs.some((d) => Math.hypot(d.x - change.x, d.y - change.y) < d.r + change.r + 2 * TAP_SLOP + 4)) continue;
    if (occluded(items, idx, change)) continue;
    diffs.push({ idx, side: rand() < 0.5 ? 'left' : 'right', ...change });
  }
  return diffs.length === level.diffs ? diffs : null;
}

/**
 * 그림 한 벌을 만든다. 같은 seed·level 이면 언제나 같은 결과.
 * @returns {{theme:string, bg:object, left:object[], right:object[], diffs:{id:number,x:number,y:number,r:number}[]}}
 */
export function generatePuzzle(seed, levelKey = DEFAULT_LEVEL) {
  const level = LEVELS[levelKey] ?? LEVELS[DEFAULT_LEVEL];
  const rand = mulberry32(seed);
  const theme = pick(rand, Object.keys(THEME_BUILDERS));

  for (let attempt = 0; attempt < 40; attempt++) {
    const { bg, items } = THEME_BUILDERS[theme](rand);
    items.sort((a, b) => a.z - b.z);
    for (const it of items) delete it.z;
    const chosen = chooseDiffs(items, level, rand);
    if (!chosen) continue;

    const left = items.map((it) => ({ ...it }));
    const right = items.map((it) => ({ ...it }));
    const diffs = chosen.map((d, id) => {
      const target = d.side === 'left' ? left[d.idx] : right[d.idx];
      if (d.hide) target.hide = 1;
      else Object.assign(target, d.patch);
      return { id, x: d.x, y: d.y, r: r1(d.r) };
    });
    return { theme, bg, left, right, diffs };
  }
  throw new Error('그림을 만들지 못했습니다');
}

/** 누른 곳에 걸리는 차이. 없으면 null. */
export function hitTest(diffs, x, y) {
  let best = null;
  for (const d of diffs) {
    const dist = Math.hypot(d.x - x, d.y - y);
    if (dist <= d.r + TAP_SLOP && (!best || dist < best.dist)) best = { d, dist };
  }
  return best ? best.d : null;
}

/* ───────── SVG 그리기 ───────── */

function renderBackground(bg, idp) {
  const g = (id, a, b) =>
    `<linearGradient id="${idp}-${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${col(a)}"/><stop offset="1" stop-color="${col(b)}"/></linearGradient>`;
  switch (bg?.theme) {
    case 'sea':
      return `<defs>${g('w', bg.water1, bg.water2)}</defs><rect width="${SCENE_W}" height="${SCENE_H}" fill="url(#${idp}-w)"/>` +
        `<g fill="#ffffff" opacity=".07"><path d="M60,0 L110,0 L200,300 L120,300Z"/><path d="M240,0 L280,0 L380,300 L320,300Z"/></g>` +
        `<path d="M0,250 Q100,235 200,250 T400,248 V300 H0Z" fill="${col(bg.sand)}"/>`;
    case 'night':
      return `<defs>${g('s', bg.sky1, bg.sky2)}</defs><rect width="${SCENE_W}" height="${SCENE_H}" fill="url(#${idp}-s)"/>` +
        `<rect y="235" width="${SCENE_W}" height="16" fill="${col(bg.sidewalk)}"/><rect y="251" width="${SCENE_W}" height="49" fill="${col(bg.road)}"/>` +
        `<g fill="#d8d8a0" opacity=".7"><rect x="10" y="273" width="22" height="3"/><rect x="60" y="273" width="22" height="3"/><rect x="110" y="273" width="22" height="3"/><rect x="160" y="273" width="22" height="3"/><rect x="210" y="273" width="22" height="3"/><rect x="260" y="273" width="22" height="3"/><rect x="310" y="273" width="22" height="3"/><rect x="360" y="273" width="22" height="3"/></g>`;
    default:
      return `<defs>${g('s', bg?.sky1, bg?.sky2)}</defs><rect width="${SCENE_W}" height="${SCENE_H}" fill="url(#${idp}-s)"/>` +
        `<ellipse cx="90" cy="178" rx="175" ry="50" fill="${col(bg?.hill1)}"/><ellipse cx="320" cy="182" rx="165" ry="45" fill="${col(bg?.hill2)}"/>` +
        `<rect y="168" width="${SCENE_W}" height="132" fill="${col(bg?.ground)}"/>`;
  }
}

function renderItem(it) {
  const kind = KINDS[it.k];
  if (!kind || it.hide) return '';
  const s = num(it.s, 1);
  const sx = it.f ? -s : s;
  return `<g transform="translate(${num(it.x)} ${num(it.y)}) scale(${sx} ${s})">${kind.draw(it)}</g>`;
}

/**
 * 장면 전체를 SVG 안쪽 마크업으로 만든다. (<svg> 태그는 포함하지 않는다)
 * idp 는 두 그림이 한 문서에 같이 있을 때 gradient id 가 겹치지 않게 하는 접두어.
 */
export function renderScene(bg, items, idp = 'p') {
  let s = renderBackground(bg, idp);
  for (const it of items ?? []) s += renderItem(it);
  return s;
}
