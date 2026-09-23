import test from 'node:test';
import assert from 'node:assert/strict';
import { generatePuzzle, hitTest, renderScene, LEVELS, SCENE_W, SCENE_H, TAP_SLOP, MIN_HIT_RADIUS } from '../shared/spotdiff.js';

test('같은 시드면 언제나 같은 그림이 나온다', () => {
  const a = generatePuzzle(12345, 'normal');
  const b = generatePuzzle(12345, 'normal');
  assert.deepEqual(a, b);
  const c = generatePuzzle(12346, 'normal');
  assert.notDeepEqual(a.left, c.left);
});

test('난이도마다 정해진 개수의 차이가 생기고, 판정 원은 서로 겹치지 않는다', () => {
  for (const level of Object.keys(LEVELS)) {
    for (let seed = 0; seed < 300; seed++) {
      const p = generatePuzzle(seed, level);
      assert.equal(p.diffs.length, LEVELS[level].diffs, `${level} seed ${seed}`);
      for (const d of p.diffs) {
        assert.ok(d.r >= MIN_HIT_RADIUS && d.x >= 0 && d.x <= SCENE_W && d.y >= 0 && d.y <= SCENE_H);
      }
      for (let i = 0; i < p.diffs.length; i++) {
        for (let j = i + 1; j < p.diffs.length; j++) {
          const a = p.diffs[i];
          const b = p.diffs[j];
          assert.ok(Math.hypot(a.x - b.x, a.y - b.y) > a.r + b.r + 2 * TAP_SLOP, `${level} seed ${seed}: 판정 원 겹침`);
        }
      }
    }
  }
});

test('두 그림은 차이 개수만큼만 다르다', () => {
  for (let seed = 0; seed < 100; seed++) {
    const p = generatePuzzle(seed, 'hard');
    assert.equal(p.left.length, p.right.length);
    let changed = 0;
    p.left.forEach((l, i) => {
      if (JSON.stringify(l) !== JSON.stringify(p.right[i])) changed++;
    });
    assert.equal(changed, p.diffs.length);
  }
});

test('판정: 원 안(여유 포함)은 맞고 바깥은 틀리며, 가장 가까운 것을 고른다', () => {
  const diffs = [
    { id: 0, x: 100, y: 100, r: 20 },
    { id: 1, x: 160, y: 100, r: 20 },
  ];
  assert.equal(hitTest(diffs, 100, 100).id, 0);
  assert.equal(hitTest(diffs, 100 + 20 + TAP_SLOP, 100).id, 0);
  assert.equal(hitTest(diffs, 100 + 20 + TAP_SLOP + 1, 100), null);
  assert.equal(hitTest(diffs, 145, 100).id, 1);
  assert.equal(hitTest(diffs, 10, 10), null);
});

test('SVG 로 그릴 수 있고 숨긴 물건은 빠진다', () => {
  const p = generatePuzzle(7, 'easy');
  const left = renderScene(p.bg, p.left, 'l');
  const right = renderScene(p.bg, p.right, 'r');
  assert.match(left, /<rect width="400" height="300"/);
  assert.match(left, /url\(#l-/);
  assert.notEqual(left, right);
  const visible = (items) => items.filter((it) => !it.hide).length;
  assert.equal((left.match(/<g transform=/g) ?? []).length, visible(p.left));
  assert.equal((right.match(/<g transform=/g) ?? []).length, visible(p.right));
});

test('이상한 값이 들어와도 그리기가 깨지지 않는다', () => {
  const s = renderScene({ theme: 'meadow' }, [{ k: 'tree', x: 'abc', y: null, s: 'x', c: 'javascript:alert(1)' }, { k: '없음', x: 1, y: 1 }]);
  assert.doesNotMatch(s, /javascript/);
  assert.match(s, /translate\(0 0\)/);
});
