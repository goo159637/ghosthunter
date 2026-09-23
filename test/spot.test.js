import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../shared/spot.js';

test('makeRng — 같은 seed 면 같은 수열, 다른 seed 면 다르다', () => {
  const a = S.makeRng(42);
  const b = S.makeRng(42);
  const c = S.makeRng(43);
  const sa = [a(), a(), a()];
  assert.deepEqual(sa, [b(), b(), b()]);
  assert.notDeepEqual(sa, [c(), c(), c()]);
  for (const v of sa) assert.ok(v >= 0 && v < 1);
});

test('normalizeOptions — 프리셋과 커스텀', () => {
  assert.deepEqual(S.normalizeOptions({ difficulty: 'easy' }), { difficulty: 'easy', diffs: 5, objects: 10, theme: null });
  assert.deepEqual(S.normalizeOptions({ difficulty: 'hard', theme: 'sea' }), { difficulty: 'hard', diffs: 10, objects: 18, theme: 'sea' });
  assert.deepEqual(S.normalizeOptions({ diffs: 99, theme: 'nope' }), { difficulty: 'custom', diffs: 12, objects: 16, theme: null });
  assert.equal(S.normalizeOptions({}).diffs, 7);
});

test('generatePuzzle — seed 가 같으면 완전히 같은 퍼즐', () => {
  const a = S.generatePuzzle({ seed: 12345, difficulty: 'normal' });
  const b = S.generatePuzzle({ seed: 12345, difficulty: 'normal' });
  assert.deepEqual(a, b);
  assert.equal(a.seed, 12345);
  const c = S.generatePuzzle({ seed: 12346, difficulty: 'normal' });
  assert.notDeepEqual(a.left, c.left);
});

test('generatePuzzle — 차이 수가 맞고, 차이는 서로 다른 물체에, 그 물체만 다르다', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (let seed = 1; seed <= 40; seed++) {
      const p = S.generatePuzzle({ seed, difficulty });
      assert.equal(p.diffs.length, S.PRESETS[difficulty].diffs, `${difficulty} seed ${seed}: 차이 ${p.diffs.length}개`);
      assert.equal(p.left.length, p.right.length);
      assert.ok(p.left.length >= S.PRESETS[difficulty].objects - 2, `${difficulty} seed ${seed}: 물체 ${p.left.length}개`);
      const idx = new Set(p.diffs.map((d) => d.index));
      assert.equal(idx.size, p.diffs.length, '차이는 서로 다른 물체에');
      p.left.forEach((o, i) => {
        const same = JSON.stringify(o) === JSON.stringify(p.right[i]);
        assert.equal(same, !idx.has(i), `${difficulty} seed ${seed}: 물체 ${i} (${o.type}) 가 ${idx.has(i) ? '달라야' : '같아야'} 한다`);
      });
      for (const d of p.diffs) {
        assert.ok(d.r >= 22 && d.r <= 130, `판정 반지름 ${d.r}`);
        assert.ok(d.cx >= 0 && d.cx <= S.WIDTH && d.cy >= 0 && d.cy <= S.HEIGHT);
        assert.ok(['color', 'size', 'move', 'flip', 'rotate', 'count', 'remove'].includes(d.kind));
      }
      assert.ok(S.THEMES.includes(p.theme));
    }
  }
});

test('generatePuzzle — 모든 테마에서 모든 종류의 차이가 실제로 나온다', () => {
  const seen = {};
  for (const theme of S.THEMES) {
    seen[theme] = new Set();
    for (let seed = 1; seed <= 60; seed++) {
      const p = S.generatePuzzle({ seed, difficulty: 'hard', theme });
      assert.equal(p.theme, theme);
      for (const d of p.diffs) seen[theme].add(d.kind);
    }
    for (const kind of ['color', 'size', 'move', 'count']) assert.ok(seen[theme].has(kind), `${theme}: ${kind} 차이가 한 번도 안 나옴`);
  }
});

test('hitTest — 차이 중심은 맞고, 멀리는 틀리고, 겹치면 가까운 것', () => {
  const p = S.generatePuzzle({ seed: 7, difficulty: 'normal' });
  p.diffs.forEach((d, i) => {
    assert.equal(S.hitTest(p, d.cx, d.cy), i);
    assert.equal(S.hitTest(p, d.cx + d.r * 0.9, d.cy), S.hitTest(p, d.cx + d.r * 0.9, d.cy)); // 안 터진다
  });
  // 어떤 차이 원에도 안 들어가는 점을 찾아 확인
  let miss = null;
  for (let x = 0; x < S.WIDTH && miss === null; x += 7) {
    for (let y = 0; y < S.HEIGHT; y += 7) {
      if (p.diffs.every((d) => Math.hypot(d.cx - x, d.cy - y) > d.r + 1)) { miss = [x, y]; break; }
    }
  }
  assert.ok(miss, '빈 곳이 있어야 한다');
  assert.equal(S.hitTest(p, miss[0], miss[1]), -1);
  assert.equal(S.hitTest(p, -50, -50), -1);
});

test('renderScene — 두 장면이 SVG 이고 차이 난 물체 수만큼만 다르며, 숨긴 물체는 안 그린다', () => {
  const p = S.generatePuzzle({ seed: 99, difficulty: 'easy' });
  const l = S.renderScene(p, 'left');
  const r = S.renderScene(p, 'right', { id: 'right-svg' });
  assert.ok(l.startsWith('<svg'));
  assert.ok(l.includes(`viewBox="0 0 ${S.WIDTH} ${S.HEIGHT}"`));
  assert.ok(r.includes('id="right-svg"'));
  assert.notEqual(l, r);
  const groups = (s) => (s.match(/<g transform=/g) || []).length;
  const hiddenL = p.left.filter((o) => o.hidden).length;
  const hiddenR = p.right.filter((o) => o.hidden).length;
  assert.equal(groups(l), p.left.length - hiddenL);
  assert.equal(groups(r), p.right.length - hiddenR);
  assert.ok(!l.includes('undefined') && !l.includes('NaN'));
});

test('publicPuzzle — 정답(diffs) 이 빠지고 개수만 남는다', () => {
  const p = S.generatePuzzle({ seed: 5, difficulty: 'hard' });
  const pub = S.publicPuzzle(p);
  assert.equal(pub.diffs, undefined);
  assert.equal(pub.diffCount, 10);
  assert.deepEqual(pub.left, p.left);
  assert.equal(S.renderScene(pub, 'left'), S.renderScene(p, 'left'));
});
