import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidNumber, judge, formatResult, randomNumber, allCandidates } from '../shared/baseball.js';

test('isValidNumber — 자릿수와 중복을 검사한다', () => {
  assert.equal(isValidNumber('123', 3), true);
  assert.equal(isValidNumber('012', 3), true);   // 0 으로 시작해도 된다
  assert.equal(isValidNumber('112', 3), false);  // 중복
  assert.equal(isValidNumber('12', 3), false);   // 짧다
  assert.equal(isValidNumber('12a', 3), false);
  assert.equal(isValidNumber(123, 3), false);
  assert.equal(isValidNumber('', 3), false);
});

test('judge — 스트라이크/볼/아웃', () => {
  assert.deepEqual(judge('123', '123'), { strikes: 3, balls: 0, out: false });
  assert.deepEqual(judge('123', '321'), { strikes: 1, balls: 2, out: false });
  assert.deepEqual(judge('123', '145'), { strikes: 1, balls: 0, out: false });
  assert.deepEqual(judge('123', '456'), { strikes: 0, balls: 0, out: true });
  assert.deepEqual(judge('012345', '543210'), { strikes: 0, balls: 6, out: false });
});

test('formatResult — 사람이 읽는 문구', () => {
  assert.equal(formatResult({ strikes: 2, balls: 1 }), '2스트라이크 1볼');
  assert.equal(formatResult({ strikes: 0, balls: 2 }), '2볼');
  assert.equal(formatResult({ strikes: 0, balls: 0 }), '아웃');
});

test('randomNumber — 항상 규칙에 맞다', () => {
  for (const digits of [3, 4, 5, 6]) {
    for (let i = 0; i < 200; i++) {
      assert.equal(isValidNumber(randomNumber(digits), digits), true);
    }
  }
});

test('allCandidates — 순열 개수가 맞고 전부 유효하다', () => {
  assert.equal(allCandidates(3).length, 720);      // 10P3
  assert.equal(allCandidates(4).length, 5040);     // 10P4
  assert.equal(new Set(allCandidates(3)).size, 720);
  assert.equal(allCandidates(3).every((c) => isValidNumber(c, 3)), true);
});
