/**
 * 서버 통합 테스트 — 실제로 서버를 띄우고 소켓 두 개를 붙여 한 판을 끝까지 돌린다.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket from 'ws';

const PORT = 4000 + Math.floor(Math.random() * 900);
const BASE = `http://127.0.0.1:${PORT}`;
let child;

before(async () => {
  child = spawn(process.execPath, ['server/index.js'], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
    stdio: ['ignore', 'ignore', 'inherit'],
  });
  for (let i = 0; i < 60; i++) {
    try {
      const res = await fetch(`${BASE}/healthz`);
      if (res.ok) return;
    } catch { /* 아직 안 떴다 */ }
    await delay(100);
  }
  throw new Error('서버가 뜨지 않았습니다');
});

after(() => child?.kill('SIGKILL'));

function connect() {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/ws`);
  const queue = [];
  const waiters = [];
  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    const waiter = waiters.shift();
    if (waiter) waiter(msg);
    else queue.push(msg);
  });
  return {
    ws,
    open: () => new Promise((resolve, reject) => {
      ws.once('open', resolve);
      ws.once('error', reject);
    }),
    send: (msg) => ws.send(JSON.stringify(msg)),
    next: () => (queue.length ? Promise.resolve(queue.shift()) : new Promise((r) => waiters.push(r))),
    async until(predicate) {
      for (let i = 0; i < 40; i++) {
        const msg = await this.next();
        if (predicate(msg)) return msg;
      }
      throw new Error('기다리던 메시지가 오지 않았습니다');
    },
    state: function (predicate = () => true) {
      return this.until((m) => m.t === 'state' && predicate(m.view));
    },
    close: () => ws.close(),
  };
}

test('정적 파일을 제공하고, 경로 탈출은 막는다', async () => {
  const home = await fetch(`${BASE}/`);
  assert.equal(home.status, 200);
  assert.match(home.headers.get('content-type'), /text\/html/);
  assert.match(await home.text(), /숫자야구/);

  assert.equal((await fetch(`${BASE}/shared/baseball.js`)).status, 200);
  assert.equal((await fetch(`${BASE}/js/app.js`)).status, 200);
  assert.equal((await fetch(`${BASE}/../package.json`)).status, 404);
  assert.equal((await fetch(`${BASE}/%2e%2e/package.json`)).status, 404);
  assert.equal((await fetch(`${BASE}/nope.html`)).status, 404);
});

test('두 명이 한 판을 끝내고 재대결까지 한다', async () => {
  const a = connect();
  const b = connect();
  await a.open();
  await b.open();

  a.send({ t: 'create', name: '가가', digits: 3, turnSeconds: 0 });
  const joinedA = await a.until((m) => m.t === 'joined');
  assert.equal(joinedA.you, 0);
  assert.match(joinedA.code, /^[A-Z0-9]{4}$/);

  b.send({ t: 'join', name: '나나', code: joinedA.code });
  const joinedB = await b.until((m) => m.t === 'joined');
  assert.equal(joinedB.you, 1);

  await a.state((v) => v.phase === 'setup');
  a.send({ t: 'secret', value: '123' });
  b.send({ t: 'secret', value: '456' });
  const playing = await b.state((v) => v.phase === 'playing');
  assert.equal(playing.view.opponent.name, '가가');
  assert.equal(playing.view.opponent.secret, null, '상대 비밀번호가 새어나가면 안 된다');

  // 선공(가가)이 헛방 → 후공(나나)이 정답
  a.send({ t: 'guess', value: '789' });
  await b.state((v) => v.opponent.guesses.length === 1);
  b.send({ t: 'guess', value: '123' });

  const overB = await b.state((v) => v.phase === 'over');
  assert.equal(overB.view.winner, 'you');
  assert.equal(overB.view.overReason, 'strikes');
  assert.equal(overB.view.opponent.secret, '123', '끝난 뒤엔 공개된다');
  const overA = await a.state((v) => v.phase === 'over');
  assert.equal(overA.view.winner, 'opponent');

  // 채팅
  a.send({ t: 'chat', text: '한 판 더!' });
  const chat = await b.until((m) => m.t === 'state' && m.chat.length > 0);
  assert.equal(chat.chat[0].text, '한 판 더!');
  assert.equal(chat.chat[0].name, '가가');

  // 재대결 — 둘 다 눌러야 시작되고 선공이 바뀐다
  a.send({ t: 'rematch' });
  const half = await b.state((v) => v.opponent.rematch === true);
  assert.equal(half.view.phase, 'over');
  b.send({ t: 'rematch' });
  const again = await a.state((v) => v.phase === 'setup');
  assert.equal(again.view.gameNo, 2);
  assert.equal(again.view.firstMover, 1);
  assert.deepEqual(again.view.me.guesses, []);

  a.close();
  b.close();
});

test('연결이 끊겨도 토큰으로 자리에 돌아온다', async () => {
  const a = connect();
  const b = connect();
  await a.open();
  await b.open();

  a.send({ t: 'create', name: '가', digits: 3, turnSeconds: 0 });
  const joined = await a.until((m) => m.t === 'joined');
  b.send({ t: 'join', name: '나', code: joined.code });
  await b.until((m) => m.t === 'joined');
  await b.state((v) => v.phase === 'setup');

  a.close();
  const gone = await b.state((v) => v.opponent.present === false);
  assert.ok(gone.grace > Date.now(), '재접속 유예 시간이 내려와야 한다');

  const a2 = connect();
  await a2.open();
  a2.send({ t: 'rejoin', code: joined.code, token: joined.token });
  const back = await a2.until((m) => m.t === 'joined');
  assert.equal(back.you, 0);
  await b.state((v) => v.opponent.present === true);

  a2.close();
  b.close();
});

test('옛 연결이 뒤늦게 끊겨도 새로 붙은 자리를 지우지 않는다', async () => {
  const a = connect();
  const b = connect();
  await a.open();
  await b.open();

  a.send({ t: 'create', name: '가', digits: 3, turnSeconds: 0 });
  const joined = await a.until((m) => m.t === 'joined');
  b.send({ t: 'join', code: joined.code, name: '나' });
  await b.until((m) => m.t === 'joined');
  await b.state((v) => v.phase === 'setup');

  // 옛 연결(a)을 열어둔 채로 같은 토큰으로 새 연결을 붙인다 — 서버가 옛 연결을 닫는다
  const a2 = connect();
  await a2.open();
  a2.send({ t: 'rejoin', code: joined.code, token: joined.token });
  await a2.until((m) => m.t === 'joined');
  await delay(300); // 옛 소켓의 close 가 뒤늦게 도착할 시간을 준다

  a2.send({ t: 'chat', text: '나 여기 있어' });
  const seen = await b.until((m) => m.t === 'state' && m.chat.length > 0);
  assert.equal(seen.view.opponent.present, true, '새 연결이 살아 있어야 한다');
  assert.equal(seen.grace, null, '재접속 유예가 걸려 있으면 안 된다');

  a2.close();
  b.close();
});

test('없는 방·가득 찬 방·잘못된 요청은 에러로 돌려준다', async () => {
  const a = connect();
  await a.open();
  a.send({ t: 'join', code: 'ZZZZ', name: '떠돌이' });
  assert.equal((await a.until((m) => m.t === 'error')).code, 'room_not_found');

  a.send({ t: 'guess', value: '123' });
  assert.equal((await a.until((m) => m.t === 'error')).code, 'no_room');

  a.send({ t: 'create', name: '가', digits: 3, turnSeconds: 0 });
  const joined = await a.until((m) => m.t === 'joined');

  const b = connect();
  const c = connect();
  await b.open();
  await c.open();
  b.send({ t: 'join', code: joined.code, name: '나' });
  await b.until((m) => m.t === 'joined');
  c.send({ t: 'join', code: joined.code, name: '다' });
  assert.equal((await c.until((m) => m.t === 'error')).code, 'room_full');

  a.ws.send('이건 JSON 이 아니다');
  assert.equal((await a.until((m) => m.t === 'error')).code, 'bad_message');

  a.close();
  b.close();
  c.close();
});

test('틀린그림찾기 방 — 카운트다운 뒤 시작, 누른 결과가 상대에게도 보인다', async () => {
  const a = connect();
  const b = connect();
  await a.open();
  await b.open();

  a.send({ t: 'create', game: 'spot', level: 'easy', name: '가' });
  const joined = await a.until((m) => m.t === 'joined');
  b.send({ t: 'join', code: joined.code, name: '나' });
  await b.until((m) => m.t === 'joined');

  const counting = await a.until((m) => m.t === 'state' && m.view.phase === 'countdown');
  assert.equal(counting.game, 'spot');
  assert.equal(counting.view.total, 5);
  assert.ok(counting.view.puzzle.left.length > 10);
  assert.equal(counting.view.answers, null, '정답이 새어나가면 안 된다');

  a.send({ t: 'guess', value: '123' });
  assert.equal((await a.until((m) => m.t === 'error')).code, 'wrong_game');

  const playing = await a.state((v) => v.phase === 'playing');
  assert.ok(playing.view.deadline > Date.now());

  // 정답 위치는 서버만 안다 — 두 그림에서 달라진 물건을 찾아 그 자리를 누른다
  const { left, right } = playing.view.puzzle;
  const changed = left.map((l, i) => (JSON.stringify(l) !== JSON.stringify(right[i]) ? l : null)).filter((l) => l && l.k !== 'building');
  assert.ok(changed.length > 0);
  a.send({ t: 'tap', x: changed[0].x, y: changed[0].y });
  const hit = await a.state((v) => v.me.found === 1);
  assert.equal(hit.view.found[0].by, 'you');
  const seen = await b.state((v) => v.opponent.found === 1);
  assert.equal(seen.view.found[0].by, 'opponent');

  a.send({ t: 'tap', x: 'x', y: 1 });
  assert.equal((await a.until((m) => m.t === 'error')).code, 'bad_tap');

  b.send({ t: 'surrender' });
  const over = await a.state((v) => v.phase === 'over');
  assert.equal(over.view.winner, 'you');
  assert.equal(over.view.overReason, 'forfeit');
  assert.equal(over.view.answers.length, 5, '끝난 뒤엔 정답이 공개된다');

  a.close();
  b.close();
});
