import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../shared/spot.js';
import * as SC from '../shared/scene.js';

test('makeRng — 같은 seed 면 같은 수열, 다른 seed 면 다르다', () => {
  const a = S.makeRng(42);
  const b = S.makeRng(42);
  const c = S.makeRng(43);
  const sa = [a(), a(), a()];
  assert.deepEqual(sa, [b(), b(), b()]);
  assert.notDeepEqual(sa, [c(), c(), c()]);
});

test('normalizeOptions — 모드·프리셋·커스텀', () => {
  assert.deepEqual(S.normalizeOptions({ difficulty: 'easy' }), { mode: 'diff', difficulty: 'easy', targets: 5, diffs: 5, objects: 45, theme: null });
  assert.deepEqual(S.normalizeOptions({ mode: 'cats', difficulty: 'hard', theme: 'room' }), { mode: 'cats', difficulty: 'hard', targets: 15, diffs: 15, objects: 65, theme: 'room' });
  assert.equal(S.normalizeOptions({ targets: 99 }).targets, 20);
  assert.equal(S.normalizeOptions({ mode: 'nope', theme: 'nope' }).mode, 'diff');
});

test('buildScene — 테마마다 물체가 빽빽하고, 슬롯 상한을 지키며, 고양이 자리가 충분하다', () => {
  for (const theme of SC.THEMES) {
    for (let seed = 1; seed <= 20; seed++) {
      const sc = SC.buildScene(seed, { theme, objects: 60 });
      assert.equal(sc.theme, theme);
      assert.ok(sc.objects.length >= 35, `${theme} seed ${seed}: 물체 ${sc.objects.length}개`);
      const byType = {};
      for (const o of sc.objects) byType[o.type] = (byType[o.type] ?? 0) + 1;
      assert.ok((byType.clock ?? 0) <= 1, `${theme} seed ${seed}: 시계 ${byType.clock}개`);
      assert.ok((byType.lighthouse ?? 0) <= 1, `${theme} seed ${seed}: 등대 ${byType.lighthouse}개`);
      assert.ok((byType.wallwindow ?? 0) <= 1);
      assert.ok(SC.catSpots(sc.objects).length >= 12, `${theme} seed ${seed}: 고양이 자리 ${SC.catSpots(sc.objects).length}`);
    }
  }
});

test('generatePuzzle — seed 가 같으면 완전히 같은 퍼즐 (테마를 명시해도)', () => {
  const a = S.generatePuzzle({ seed: 12345, difficulty: 'normal' });
  const b = S.generatePuzzle({ seed: 12345, difficulty: 'normal' });
  assert.deepEqual(a, b);
  const c = S.generatePuzzle({ seed: 12345, difficulty: 'normal', theme: a.theme });
  assert.deepEqual(a, c);
  const d = S.generatePuzzle({ seed: 12346, difficulty: 'normal' });
  assert.notDeepEqual(a.left, d.left);
});

test('틀린그림 — 차이 수가 맞고, 서로 다른 물체에, 그 물체만 다르며, 보이는 곳에 있다', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (let seed = 1; seed <= 30; seed++) {
      const p = S.generatePuzzle({ seed, difficulty });
      assert.equal(p.mode, 'diff');
      assert.equal(p.diffs.length, S.PRESETS.diff[difficulty].targets, `${difficulty} seed ${seed}: 차이 ${p.diffs.length}개`);
      assert.equal(p.left.length, p.right.length);
      const idx = new Set(p.diffs.map((d) => d.index));
      assert.equal(idx.size, p.diffs.length, '차이는 서로 다른 물체에');
      p.left.forEach((o, i) => {
        const same = JSON.stringify(o) === JSON.stringify(p.right[i]);
        assert.equal(same, !idx.has(i), `${difficulty} seed ${seed}: 물체 ${i} (${o.type}) 가 ${idx.has(i) ? '달라야' : '같아야'} 한다`);
      });
      for (const d of p.diffs) {
        assert.ok(d.r >= 24 && d.r <= 90, `판정 반지름 ${d.r}`);
        assert.ok(d.cx >= 0 && d.cx <= S.WIDTH && d.cy >= 0 && d.cy <= S.HEIGHT);
      }
      assert.ok(p.left.some((o) => o.type === 'cat'), '장면에 고양이가 몇 마리 있다');
    }
  }
});

test('숨은 고양이 — 고양이 수가 맞고, 정답이 고양이를 가리키며, 서로 겹치지 않는다', () => {
  for (const difficulty of ['easy', 'normal', 'hard']) {
    for (const theme of SC.THEMES) {
      for (let seed = 1; seed <= 12; seed++) {
        const p = S.generatePuzzle({ seed, difficulty, theme, mode: 'cats' });
        assert.equal(p.mode, 'cats');
        assert.equal(p.diffs.length, S.PRESETS.cats[difficulty].targets, `${theme} ${difficulty} seed ${seed}: 고양이 ${p.diffs.length}마리`);
        assert.equal(p.right, p.left);
        for (const d of p.diffs) {
          assert.equal(p.left[d.index].type, 'cat');
          assert.equal(d.kind, 'cat');
          assert.ok(d.r >= 18);
        }
        for (let i = 0; i < p.diffs.length; i++) for (let j = i + 1; j < p.diffs.length; j++) {
          assert.ok(Math.hypot(p.diffs[i].cx - p.diffs[j].cx, p.diffs[i].cy - p.diffs[j].cy) >= 26);
        }
      }
    }
  }
});

test('hitTest — 정답 중심은 맞고, 멀리는 틀리고, 판 밖은 틀리다', () => {
  const p = S.generatePuzzle({ seed: 7, difficulty: 'normal' });
  p.diffs.forEach((d, i) => assert.equal(S.hitTest(p, d.cx, d.cy), i));
  let miss = null;
  for (let x = 0; x < S.WIDTH && miss === null; x += 7) {
    for (let y = 0; y < S.HEIGHT; y += 7) {
      if (p.diffs.every((d) => Math.hypot(d.cx - x, d.cy - y) > d.r + 1)) { miss = [x, y]; break; }
    }
  }
  assert.ok(miss);
  assert.equal(S.hitTest(p, miss[0], miss[1]), -1);
  assert.equal(S.hitTest(p, -50, -50), -1);
});

test('renderScene — SVG 이고 두 장면이 다르며, 숨긴 물체는 안 그리고, 고양이는 주인 바로 뒤에', () => {
  const p = S.generatePuzzle({ seed: 99, difficulty: 'easy' });
  const l = S.renderScene(p, 'left');
  const r = S.renderScene(p, 'right', { id: 'right-svg' });
  assert.ok(l.startsWith('<svg'));
  assert.ok(l.includes(`viewBox="0 0 ${S.WIDTH} ${S.HEIGHT}"`));
  assert.ok(r.includes('id="right-svg"'));
  assert.notEqual(l, r);
  const groups = (s) => (s.match(/<g transform=/g) || []).length;
  assert.equal(groups(l), p.left.filter((o) => !o.hidden).length);
  assert.equal(groups(r), p.right.filter((o) => !o.hidden).length);
  assert.ok(!l.includes('undefined') && !l.includes('NaN'));
  const order = SC.drawOrder(p.left);
  for (const cat of p.left.filter((o) => o.type === 'cat' && o.host !== null)) {
    assert.equal(order.indexOf(cat), order.indexOf(p.left[cat.host]) + 1 + order.slice(order.indexOf(p.left[cat.host]) + 1, order.indexOf(cat)).filter((o) => o.type === 'cat').length);
  }
  const c = S.generatePuzzle({ seed: 5, mode: 'cats', difficulty: 'easy' });
  assert.equal(S.renderScene(c, 'left'), S.renderScene(c, 'right'));
});

test('publicPuzzle — 정답(diffs) 이 빠지고 개수만 남는다', () => {
  const p = S.generatePuzzle({ seed: 5, difficulty: 'hard' });
  const pub = S.publicPuzzle(p);
  assert.equal(pub.diffs, undefined);
  assert.equal(pub.diffCount, 10);
  assert.deepEqual(pub.left, p.left);
  assert.equal(S.renderScene(pub, 'left'), S.renderScene(p, 'left'));
});
