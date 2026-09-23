import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as H from '../shared/hidden.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pack = JSON.parse(fs.readFileSync(path.join(ROOT, 'public/hidden/puzzles.json'), 'utf8'));

/** 작은 시험용 퍼즐: 별(두 곳) · 달(한 곳) */
const sample = () => ({
  id: 't', difficulty: 'easy', title: '시험', image: '/hidden/easy/01.webp', width: 100, height: 100,
  scene: [10, 10, 90, 90], list: { x: 95, ys: [20, 40] },
  items: [
    { name: '별', targets: [{ x: 30, y: 30, r: 5 }, { x: 70, y: 70, r: 5 }] },
    { name: '달', targets: [{ x: 50, y: 50, r: 5 }] },
  ],
});

/* ───────── 데이터 ───────── */

test('puzzles.json 이 형식에 맞고, 그림·썸네일 파일이 있으며, 난이도별로 그림이 있다', () => {
  assert.deepEqual(H.validatePack(pack), []);
  assert.ok(pack.puzzles.length >= 30, '그림 수');
  for (const p of pack.puzzles) {
    assert.ok(fs.existsSync(path.join(ROOT, 'public', p.image)), `${p.id} 그림 파일`);
    assert.ok(fs.existsSync(path.join(ROOT, 'public', p.thumb)), `${p.id} 썸네일`);
    assert.ok(p.items.length >= 10, `${p.id} 물건 수 ${p.items.length}`);
  }
  for (const d of ['easy', 'normal', 'hard']) assert.ok(pack.puzzles.some((p) => p.difficulty === d), d);
  assert.deepEqual(pack.difficulties.map((d) => d.id), H.DIFFICULTIES.map((d) => d.id));
});

test('모든 정답은 자기 중심을 찍으면 자기 물건으로 판정된다', () => {
  for (const p of pack.puzzles) {
    p.items.forEach((it, i) => {
      for (const t of it.targets) {
        const hit = H.hitTest(p, t.x, t.y);
        assert.equal(hit?.index, i, `${p.id}: ${it.name} (${t.x},${t.y}) 을 찍으면 ${p.items[hit?.index]?.name} 으로 판정됨`);
        assert.ok(H.inScene(p, t.x, t.y), `${p.id}: ${it.name} 이 장면 밖`);
      }
    });
  }
});

test('validatePuzzle 은 빠진 것과 이상한 값을 집어낸다', () => {
  assert.deepEqual(H.validatePuzzle(sample()), []);
  const bad = sample();
  bad.difficulty = 'nope';
  bad.items[0].targets[0].x = 5; // 장면 밖
  bad.items.push({ name: '별', targets: [{ x: 50, y: 50, r: 1 }] }); // 이름 중복
  bad.list.ys = [1];
  const problems = H.validatePuzzle(bad);
  assert.ok(problems.some((s) => s.includes('난이도')));
  assert.ok(problems.some((s) => s.includes('장면 밖')));
  assert.ok(problems.some((s) => s.includes('중복')));
  assert.ok(problems.some((s) => s.includes('list.ys')));
  assert.ok(H.validatePuzzle({ ...sample(), items: [] }).some((s) => s.includes('items')));
  assert.ok(H.validatePack({ puzzles: [sample(), sample()] }).some((s) => s.includes('id 중복')));
});

test('listPositions — y0/y1 · ys · pts 세 가지 형식', () => {
  const p = sample();
  assert.deepEqual(H.listPositions(p), [{ x: 95, y: 20 }, { x: 95, y: 40 }]);
  p.list = { x: 95, y0: 10, y1: 30 };
  assert.deepEqual(H.listPositions(p), [{ x: 95, y: 10 }, { x: 95, y: 30 }]);
  p.list = { pts: [{ x: 1, y: 2 }, { x: 3, y: 4 }] };
  assert.deepEqual(H.listPositions(p), [{ x: 1, y: 2 }, { x: 3, y: 4 }]);
  p.list = undefined;
  assert.equal(H.listPositions(p), null);
});

/* ───────── 규칙 ───────── */

test('찍기 — 찾음 · 또 찍음 · 오답(벌점) · 장면 밖(무시) · 끝', () => {
  const g = H.createGame(sample(), 1000);
  assert.equal(H.remaining(g), 2);

  assert.equal(H.click(g, 5, 5, 1100).kind, 'outside');
  assert.equal(g.misses, 0);

  assert.equal(H.click(g, 50, 20, 1200).kind, 'miss');
  assert.equal(g.misses, 1);

  const a = H.click(g, 72, 68, 1300); // 별의 두 번째 자리, 원 안
  assert.equal(a.kind, 'found');
  assert.equal(a.index, 0);
  assert.equal(a.done, false);
  assert.deepEqual(g.found[0], { x: 70, y: 70, r: 5, at: 1300 });

  const again = H.click(g, 30, 30, 1400); // 별의 첫 자리 — 이미 찾은 물건
  assert.equal(again.kind, 'again');
  assert.equal(g.misses, 1, '또 찍은 건 벌점 없음');

  const b = H.click(g, 50, 50, 2000);
  assert.equal(b.kind, 'found');
  assert.equal(b.done, true);
  assert.equal(H.isOver(g), true);
  assert.equal(g.endedAt, 2000);
  assert.equal(H.click(g, 50, 50, 2100).kind, 'over');

  // 기록 = 걸린 1초 + 오답 5초
  assert.equal(H.elapsedMs(g, 9999), 1000 + H.MISS_PENALTY_MS);
});

test('경계에서는 못 찾은 물건이 우선이고, 겹치면 상대적으로 더 가까운 쪽', () => {
  const p = sample();
  p.items[1].targets[0] = { x: 34, y: 30, r: 10 }; // 달이 별의 첫 자리와 겹침
  const g = H.createGame(p, 0);
  assert.equal(H.hitTest(p, 31, 30).index, 0, '별 중심에 더 가까움(반지름 대비)');
  H.click(g, 30, 30, 1); // 별 찾음
  assert.equal(H.click(g, 31, 30, 2).index, 1, '이제 못 찾은 달이 우선');
});

test('힌트는 못 찾은 물건 중 하나를 알려주고 벌점을 매기며, 끝나면 없다', () => {
  const g = H.createGame(sample(), 0);
  const h = H.hint(g, () => 0.99);
  assert.equal(h.index, 1);
  assert.deepEqual(h.target, { x: 50, y: 50, r: 5 });
  assert.equal(g.hints, 1);
  assert.equal(H.elapsedMs(g, 500), 500 + H.HINT_PENALTY_MS);
  H.click(g, 50, 50, 600);
  const h2 = H.hint(g, () => 0);
  assert.equal(h2.index, 0, '남은 건 별뿐');
  H.click(g, 30, 30, 700);
  assert.equal(H.hint(g), null);
  assert.equal(g.hints, 2);
});

test('abandon 은 진행 중인 판만 끝내고, formatMs 는 분:초', () => {
  const g = H.createGame(sample(), 0);
  H.abandon(g, 700);
  assert.equal(g.endedAt, 700);
  H.abandon(g, 900);
  assert.equal(g.endedAt, 700);
  assert.equal(H.formatMs(0), '0:00');
  assert.equal(H.formatMs(61_500), '1:01');
  assert.equal(H.formatMs(600_000), '10:00');
});
