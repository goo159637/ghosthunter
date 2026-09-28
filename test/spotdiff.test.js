import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as D from '../shared/spotdiff.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/diff/puzzles.json'), 'utf8'));

/** 작은 시험용 퍼즐: 100×100 두 장, 차이 두 곳 */
const sample = () => ({
  id: 't', title: '시험', left: '/diff/t/left.webp', right: '/diff/t/right.webp', width: 100, height: 100,
  diffs: [{ x: 30, y: 30, r: 15 }, { x: 70, y: 70, r: 15 }],
});

/* ───────── 데이터 ───────── */

test('puzzles.json 이 형식에 맞고, 그림·썸네일 파일이 있으며, 차이가 그림 안에 서로 겹치지 않게 있다', () => {
  assert.deepEqual(D.validatePack(pack), []);
  assert.ok(pack.puzzles.length >= 1, '그림 수');
  for (const p of pack.puzzles) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public', p.left)), `${p.id} 왼쪽 그림 파일`);
    assert.ok(fs.existsSync(path.join(ROOT, 'public', p.right)), `${p.id} 오른쪽 그림 파일`);
    assert.ok(fs.existsSync(path.join(ROOT, 'public', p.thumb)), `${p.id} 썸네일`);
    assert.ok(p.diffs.length >= 10, `${p.id} 차이 수 ${p.diffs.length}`);
    p.diffs.forEach((t, i) => {
      assert.equal(D.hitTest(p, t.x, t.y)?.index, i, `${p.id}: ${i + 1}번 중심을 찍으면 자기 자신`);
    });
  }
});

test('validatePuzzle 은 빠진 것과 이상한 값을 집어낸다', () => {
  assert.deepEqual(D.validatePuzzle(sample()), []);
  const bad = sample();
  bad.right = 'right.webp'; // 절대 경로가 아님
  bad.diffs[0].x = 130; // 그림 밖
  bad.diffs.push({ x: 72, y: 72, r: 15 }); // 겹침
  bad.diffs.push({ x: 50, y: 50, r: 5 }); // 너무 작음
  const problems = D.validatePuzzle(bad);
  assert.ok(problems.some((s) => s.includes('right 경로')));
  assert.ok(problems.some((s) => s.includes('그림 밖')));
  assert.ok(problems.some((s) => s.includes('겹침')));
  assert.ok(problems.some((s) => s.includes('반지름')));
  assert.ok(D.validatePuzzle({ ...sample(), diffs: [] }).some((s) => s.includes('diffs')));
  assert.ok(D.validatePack({ puzzles: [sample(), sample()] }).some((s) => s.includes('id 중복')));
});

/* ───────── 규칙 ───────── */

test('찍기 — 찾음(어느 쪽이든) · 또 찍음 · 오답(벌점) · 그림 밖(무시) · 끝', () => {
  const g = D.createGame(sample(), 1000);
  assert.equal(D.remaining(g), 2);

  assert.equal(D.click(g, -5, 50, 1100).kind, 'outside');
  assert.equal(g.misses, 0);

  assert.equal(D.click(g, 50, 20, 1200).kind, 'miss');
  assert.equal(g.misses, 1);

  const a = D.click(g, 75, 65, 1300, 'right'); // 오른쪽 그림에서 찾음
  assert.equal(a.kind, 'found');
  assert.equal(a.index, 1);
  assert.equal(a.done, false);
  assert.deepEqual(g.found[1], { at: 1300, side: 'right' });

  const again = D.click(g, 70, 70, 1400);
  assert.equal(again.kind, 'again');
  assert.equal(g.misses, 1, '또 찍은 건 벌점 없음');

  const b = D.click(g, 30, 30, 2000);
  assert.equal(b.kind, 'found');
  assert.equal(b.done, true);
  assert.equal(D.isOver(g), true);
  assert.equal(D.click(g, 30, 30, 2100).kind, 'over');

  // 기록 = 걸린 1초 + 오답 5초
  assert.equal(D.elapsedMs(g, 9999), 1000 + D.MISS_PENALTY_MS);
});

test('겹치는 자리에서는 반지름 대비 더 가까운 쪽', () => {
  const p = sample();
  p.diffs[1] = { x: 45, y: 30, r: 30 };
  assert.equal(D.hitTest(p, 33, 30).index, 0);
  assert.equal(D.hitTest(p, 42, 30).index, 1);
  assert.equal(D.hitTest(p, 90, 90), null);
});

test('힌트는 못 찾은 차이 하나를 알려주고 벌점을 매기며, 끝나면 없다', () => {
  const g = D.createGame(sample(), 0);
  const h = D.hint(g, () => 0.99);
  assert.equal(h.index, 1);
  assert.deepEqual(h.target, { x: 70, y: 70, r: 15 });
  assert.equal(g.hints, 1);
  assert.equal(D.elapsedMs(g, 500), 500 + D.HINT_PENALTY_MS);
  D.click(g, 70, 70, 600);
  assert.equal(D.hint(g, () => 0).index, 0, '남은 건 첫 번째뿐');
  D.click(g, 30, 30, 700);
  assert.equal(D.hint(g), null);
  assert.equal(g.hints, 2);
});

test('abandon 은 진행 중인 판만 끝내고, formatMs 는 분:초', () => {
  const g = D.createGame(sample(), 0);
  D.abandon(g, 700);
  assert.equal(g.endedAt, 700);
  D.abandon(g, 900);
  assert.equal(g.endedAt, 700);
  assert.equal(D.formatMs(0), '0:00');
  assert.equal(D.formatMs(61_500), '1:01');
  assert.equal(D.formatMs(600_000), '10:00');
});
