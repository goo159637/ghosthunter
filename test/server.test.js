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
  assert.equal((await fetch(`${BASE}/minesweeper`)).status, 200);
  assert.equal((await fetch(`${BASE}/spot`)).status, 200);
  assert.match(await (await fetch(`${BASE}/spot`)).text(), /틀린그림찾기/);
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

/* ───────── 지뢰찾기 1:1 ───────── */

const mySeat = (m) => m.view.seats[m.view.you];
const oppSeat = (m) => m.view.seats[1 - m.view.you];
const safeClosed = (seat) => seat.layout.split('').findIndex((ch, i) => ch === '.' && seat.board[i] === '.');

test('지뢰찾기 방 — 카운트다운 뒤 출발, 조작이 상대에게 실시간으로 보이고, 점수로 승부한다', async () => {
  const a = connect();
  const b = connect();
  await a.open();
  await b.open();

  a.send({ t: 'create', game: 'minesweeper', name: '가', rows: 9, cols: 9, mines: 10, countdownSeconds: 1 });
  const joinedA = await a.until((m) => m.t === 'joined');
  assert.equal(joinedA.game, 'minesweeper');
  assert.equal(joinedA.role, 'player');
  const lobby = await a.state((v) => v.phase === 'lobby');
  assert.equal(lobby.role, 'player');
  assert.equal(lobby.view.seats[0].board, undefined);
  assert.equal(lobby.people.players[1], null);

  // 숫자야구 참가로는 못 들어간다
  const wrong = connect();
  await wrong.open();
  wrong.send({ t: 'join', game: 'baseball', code: joinedA.code, name: '엉뚱' });
  assert.equal((await wrong.until((m) => m.t === 'error')).code, 'wrong_game');
  wrong.close();

  b.send({ t: 'join', game: 'minesweeper', code: joinedA.code, name: '나' });
  await b.until((m) => m.t === 'joined');
  const countdown = await b.state((v) => v.phase === 'countdown');
  assert.equal(typeof mySeat(countdown).layout, 'string', '내 판의 지뢰 배치는 받는다');
  assert.equal(oppSeat(countdown).layout, null, '상대 판의 지뢰 배치는 받지 않는다');
  assert.equal(mySeat(countdown).board.length, 81);
  assert.ok(mySeat(countdown).opened >= 9, '출발 지점이 열려 있다');
  assert.ok(countdown.view.startAt > countdown.view.now);

  // 카운트다운 중엔 거절 — 에러 대신 상태만 다시 온다 (ack 로 확인)
  const safe = safeClosed(mySeat(countdown));
  b.send({ t: 'ms', a: 'reveal', i: safe, n: 1 });
  const rejected = await b.until((m) => m.t === 'state' && m.ack === 1);
  assert.equal(mySeat(rejected).board[safe], '.');

  // 1초 카운트다운이 끝나면 서버 ticker 가 출발시킨다
  const playing = await a.state((v) => v.phase === 'playing');
  assert.equal(oppSeat(playing).name, '나');

  // 나가 깃발을 꽂으면 가의 화면에 바로 보인다
  b.send({ t: 'ms', a: 'mark', i: safe, n: 2 });
  const seenFlag = await a.state((v) => v.seats[1].board[safe] === 'F');
  assert.equal(seenFlag.view.seats[1].flags, 1);
  await b.until((m) => m.t === 'state' && m.ack === 2);

  // 가가 지뢰를 밟는다 → 가의 판만 끝나고 라운드는 계속
  const viewA = playing.view;
  const mine = viewA.seats[0].layout.indexOf('*');
  a.send({ t: 'ms', a: 'reveal', i: mine, n: 1 });
  const stillOn = await b.state((v) => v.seats[0].boardPhase === 'lost');
  assert.equal(stillOn.view.phase, 'playing', '지뢰를 밟아도 라운드는 이어진다');
  assert.equal(stillOn.view.seats[0].board[mine], 'X');
  assert.ok(stillOn.view.seats[0].points.mine > 0);

  // 나가 지뢰를 밟으면 둘 다 끝 → 점수로 승부
  const mineB = mySeat(stillOn).layout.indexOf('*');
  b.send({ t: 'ms', a: 'reveal', i: mineB, n: 3 });
  const overB = await b.state((v) => v.phase === 'over');
  assert.equal(overB.view.overReason, 'points');
  assert.ok(overB.view.winner === 0 || overB.view.winner === 1 || overB.view.winner === 'draw');
  assert.equal(overB.view.history.length, 1);
  assert.deepEqual(overB.view.history[0].outcome, ['mine', 'mine']);
  assert.equal(overB.view.history[0].pids, undefined);
  const overA = await a.state((v) => v.phase === 'over');
  assert.equal(overA.view.winner, overB.view.winner);
  const wins = overA.view.seats.map((s) => s.wins);
  assert.equal(wins[0] + wins[1], overA.view.winner === 'draw' ? 0 : 1);

  // 재대결 → 새 판, 새 카운트다운, 승수 유지
  a.send({ t: 'rematch' });
  b.send({ t: 'rematch' });
  const again = await a.state((v) => v.gameNo === 2);
  assert.notEqual(again.view.phase, 'over');
  assert.notEqual(again.view.seats[0].layout, viewA.seats[0].layout);
  assert.deepEqual(again.view.seats.map((s) => s.wins), wins, '재대결해도 승수는 이어진다');

  a.close();
  b.close();
});

test('지뢰찾기 방 — 끊긴 자리로 돌아오면 판이 그대로고, 상대가 나가면 이긴다', async () => {
  const a = connect();
  const b = connect();
  await a.open();
  await b.open();

  a.send({ t: 'create', game: 'minesweeper', name: '가', countdownSeconds: 0 });
  const joined = await a.until((m) => m.t === 'joined');
  b.send({ t: 'join', game: 'minesweeper', code: joined.code, name: '나' });
  await b.until((m) => m.t === 'joined');
  const playing = await a.state((v) => v.phase === 'playing');
  const safe = safeClosed(mySeat(playing));
  a.send({ t: 'ms', a: 'mark', i: safe, n: 7 });
  await a.until((m) => m.t === 'state' && m.ack === 7);

  a.close();
  const gone = await b.state((v) => v.seats[0].present === false);
  assert.ok(gone.grace > Date.now());

  const a2 = connect();
  await a2.open();
  a2.send({ t: 'rejoin', game: 'minesweeper', code: joined.code, token: joined.token });
  const back = await a2.until((m) => m.t === 'joined');
  assert.equal(back.you, 0);
  const restored = await a2.state((v) => v.phase === 'playing');
  assert.equal(restored.ack, 7, '조작 번호가 유지된다');
  assert.equal(mySeat(restored).board[safe], 'F');
  assert.equal(mySeat(restored).layout, mySeat(playing).layout);

  a2.send({ t: 'surrender' });
  const won = await b.state((v) => v.phase === 'over');
  assert.equal(won.view.winner, 1);
  assert.equal(won.view.overReason, 'forfeit');

  a2.close();
  b.close();
});

test('관전 — 두 판을 지뢰 없이 보고, 채팅하고, 교대 요청을 플레이어가 수락하면 자리가 바뀐다', async () => {
  const a = connect();
  const b = connect();
  const c = connect();
  await a.open();
  await b.open();
  await c.open();

  a.send({ t: 'create', game: 'minesweeper', name: '가', countdownSeconds: 0 });
  const joined = await a.until((m) => m.t === 'joined');
  b.send({ t: 'join', game: 'minesweeper', code: joined.code, name: '나' });
  await b.until((m) => m.t === 'joined');
  await a.state((v) => v.phase === 'playing');

  // 다가 관전으로 들어온다
  c.send({ t: 'watch', game: 'minesweeper', code: joined.code, name: '다' });
  const joinedC = await c.until((m) => m.t === 'joined');
  assert.equal(joinedC.role, 'spectator');
  assert.equal(joinedC.you, null);
  const specView = await c.state((v) => v.phase === 'playing');
  assert.equal(specView.role, 'spectator');
  assert.equal(specView.view.role, 'spectator');
  assert.equal(specView.view.seats[0].layout, null);
  assert.equal(specView.view.seats[1].layout, null);
  assert.equal(specView.view.seats[0].board.length, 81);
  assert.equal(specView.people.spectators.length, 1);
  assert.equal(specView.people.spectators[0].name, '다');
  assert.equal(specView.freeSeat, null);
  const stateA = await a.state((v) => true);
  assert.equal(stateA.people.spectators[0].name, '다', '플레이어도 관전자 목록을 본다');

  // 관전자는 판을 조작할 수 없다
  c.send({ t: 'ms', a: 'reveal', i: 0, n: 1 });
  assert.equal((await c.until((m) => m.t === 'error')).code, 'not_player');

  // 관전자 채팅
  c.send({ t: 'chat', text: '화이팅' });
  const chat = await a.until((m) => m.t === 'state' && m.chat.length > 0);
  assert.equal(chat.chat[0].name, '다');
  assert.equal(chat.chat[0].player, null);

  // 진행 중엔 앉을 자리도 없고, 교대 요청은 걸어 둘 수 있지만 수락은 안 된다
  c.send({ t: 'sit' });
  assert.equal((await c.until((m) => m.t === 'error')).code, 'room_full');
  c.send({ t: 'swap', seat: 1 });
  const pending = await b.until((m) => m.t === 'state' && m.swaps.length === 1);
  assert.equal(pending.swaps[0].name, '다');
  const specPid = pending.swaps[0].pid;
  const mine = await c.until((m) => m.t === 'state' && m.mySwap === 1);
  assert.equal(mine.mySwap, 1);
  b.send({ t: 'swap_accept', pid: specPid });
  assert.equal((await b.until((m) => m.t === 'error')).code, 'in_progress');

  // 판을 끝낸다 (가 기권) → 나가 교대 수락 → 다가 1번 자리, 나는 관전. 둘 다 앉았으니 바로 새 판.
  a.send({ t: 'surrender' });
  await b.state((v) => v.phase === 'over');
  b.send({ t: 'swap_accept', pid: specPid });
  const bNow = await b.until((m) => m.t === 'joined');
  assert.equal(bNow.role, 'spectator');
  const cNow = await c.until((m) => m.t === 'joined');
  assert.equal(cNow.role, 'player');
  assert.equal(cNow.you, 1);
  const cPlaying = await c.state((v) => v.phase === 'playing' && v.you === 1);
  assert.equal(cPlaying.role, 'player');
  assert.equal(cPlaying.view.seats[1].name, '다');
  assert.equal(typeof cPlaying.view.seats[1].layout, 'string', '이제 자기 판의 지뢰 배치를 받는다');
  assert.equal(cPlaying.view.seats[1].wins, 0);
  assert.equal(cPlaying.people.spectators[0].name, '나');
  const bSpec = await b.state((v) => v.role === 'spectator');
  assert.equal(bSpec.view.seats[0].layout, null);
  assert.equal(bSpec.mySwap, null);

  // 관전자(나)는 진행 중인 판을 여전히 실시간으로 본다
  const safeC = safeClosed(cPlaying.view.seats[1]);
  c.send({ t: 'ms', a: 'mark', i: safeC, n: 1 });
  await b.state((v) => v.seats[1].board[safeC] === 'F');

  // 가가 관전으로 빠지려면 먼저 판이 끝나야 한다
  a.send({ t: 'stand' });
  assert.equal((await a.until((m) => m.t === 'error')).code, 'in_progress');
  a.send({ t: 'surrender' });
  await a.state((v) => v.phase === 'over');
  a.send({ t: 'stand' });
  const aSpec = await a.until((m) => m.t === 'joined');
  assert.equal(aSpec.role, 'spectator');
  const lobbyC = await c.state((v) => v.phase === 'lobby');
  assert.equal(lobbyC.people.players[0], null);
  assert.equal(lobbyC.people.spectators.length, 2);

  // 빈 자리에 나가 앉는다 → 바로 새 판
  b.send({ t: 'sit' });
  const bBack = await b.until((m) => m.t === 'joined');
  assert.equal(bBack.role, 'player');
  assert.equal(bBack.you, 0);
  const restarted = await c.state((v) => v.phase !== 'lobby');
  assert.equal(restarted.view.seats[0].name, '나');
  assert.equal(restarted.view.seats[0].wins, 1, '나의 승수(가 기권으로 1승)는 사람을 따라온다');

  // 관전자 재접속 — 토큰으로 관전석에 돌아온다
  a.close();
  const a2 = connect();
  await a2.open();
  a2.send({ t: 'rejoin', game: 'minesweeper', code: joined.code, token: aSpec.token });
  const a2Joined = await a2.until((m) => m.t === 'joined');
  assert.equal(a2Joined.role, 'spectator');

  // 숫자야구 방은 관전이 안 된다
  const d = connect();
  await d.open();
  d.send({ t: 'create', name: '야구', digits: 3, turnSeconds: 0 });
  const bb = await d.until((m) => m.t === 'joined');
  const e = connect();
  await e.open();
  e.send({ t: 'watch', code: bb.code, name: '구경' });
  assert.equal((await e.until((m) => m.t === 'error')).code, 'no_spectate');

  for (const s of [a2, b, c, d, e]) s.close();
});

/* ───────── 틀린그림찾기 1:1 ───────── */

test('틀린그림 방 — 같은 퍼즐, 정답은 안 새고, 먼저 찍은 사람이 가져가며, 관전자도 본다', async () => {
  const a = connect();
  const b = connect();
  const c = connect();
  await a.open();
  await b.open();
  await c.open();

  a.send({ t: 'create', game: 'spot', name: '가', difficulty: 'easy', countdownSeconds: 0, timeLimitSeconds: 60 });
  const joined = await a.until((m) => m.t === 'joined');
  assert.equal(joined.game, 'spot');
  b.send({ t: 'join', game: 'spot', code: joined.code, name: '나' });
  await b.until((m) => m.t === 'joined');
  const pa = await a.state((v) => v.phase === 'playing');
  const pb = await b.state((v) => v.phase === 'playing');
  assert.deepEqual(pa.view.puzzle, pb.view.puzzle, '둘이 같은 그림');
  assert.equal(pa.view.puzzle.diffs, undefined, '정답이 새면 안 된다');
  assert.equal(pa.view.puzzle.diffCount, 5);
  assert.ok(pa.view.puzzle.left.length >= 8);
  assert.equal(typeof pa.view.puzzle.background, 'string');

  // 정답은 서버 테스트가 seed 로 다시 만들어 안다 (브라우저는 모른다)
  const { generatePuzzle } = await import('../shared/spot.js');
  const truth = generatePuzzle({ seed: pa.view.puzzle.seed, difficulty: 'easy', theme: pa.view.puzzle.theme });
  assert.deepEqual(truth.left, pa.view.puzzle.left);
  const d0 = truth.diffs[0];

  c.send({ t: 'watch', game: 'spot', code: joined.code, name: '다' });
  await c.until((m) => m.t === 'joined');
  await c.state((v) => v.phase === 'playing');

  // 가가 첫 차이를 찍는다 → 본인에게 spot_result, 모두에게 found 반영
  a.send({ t: 'spot', x: d0.cx, y: d0.cy });
  const res = await a.until((m) => m.t === 'spot_result');
  assert.equal(res.hit, true);
  assert.equal(res.index, 0);
  const seenB = await b.state((v) => v.found.length === 1);
  assert.equal(seenB.view.found[0].by, 0);
  assert.equal(seenB.view.found[0].cx, d0.cx);
  assert.equal(seenB.view.seats[0].found, 1);
  const seenC = await c.state((v) => v.found.length === 1);
  assert.equal(seenC.role, 'spectator');

  // 나가 같은 곳을 찍으면 틀림 + 잠김
  b.send({ t: 'spot', x: d0.cx, y: d0.cy });
  const miss = await b.until((m) => m.t === 'spot_result');
  assert.equal(miss.hit, false);
  assert.ok(miss.lockedUntil > Date.now());
  const afterMiss = await b.state((v) => v.seats[1].misses === 1);
  assert.equal(afterMiss.view.seats[1].lockedUntil, miss.lockedUntil);

  // 관전자는 못 찍는다
  c.send({ t: 'spot', x: d0.cx, y: d0.cy });
  assert.equal((await c.until((m) => m.t === 'error')).code, 'not_player');

  // 나머지를 가가 다 찍으면 끝 → 가 승
  for (let i = 1; i < truth.diffs.length; i++) {
    a.send({ t: 'spot', x: truth.diffs[i].cx, y: truth.diffs[i].cy });
    await a.until((m) => m.t === 'spot_result');
  }
  const over = await b.state((v) => v.phase === 'over');
  assert.equal(over.view.winner, 0);
  assert.equal(over.view.overReason, 'found');
  assert.deepEqual(over.view.history[0].found, [5, 0]);
  assert.equal(over.view.seats[0].wins, 1);

  // 가가 직접 나가면(판이 끝난 뒤) 자리가 비고, 관전자 다가 앉을 수 있다
  a.send({ t: 'leave' });
  const freed = await c.state((v) => v.phase === 'lobby');
  assert.equal(freed.freeSeat, 0);
  assert.equal(freed.people.players[0], null);
  c.send({ t: 'sit' });
  const sat = await c.until((m) => m.t === 'joined');
  assert.equal(sat.role, 'player');
  assert.equal(sat.you, 0);
  await b.state((v) => v.phase !== 'lobby' && v.seats[0].name === '다');

  a.close();
  b.close();
  c.close();
});
