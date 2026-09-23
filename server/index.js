/**
 * 게임 서버 — 정적 파일 + WebSocket 대전 (숫자야구, 지뢰찾기 1:1).
 * 의존성은 ws 하나뿐이다.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { RoomStore, KINDS } from './rooms.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
};

// 확장자 없는 깔끔한 주소 → 실제 파일.
const PAGES = {
  '/minesweeper': '/minesweeper.html',
  '/spot': '/spot.html',
};

// URL 앞부분 → 실제 디렉터리. 이 두 곳 밖으로는 절대 나가지 않는다.
const MOUNTS = [
  { prefix: '/shared/', dir: path.join(ROOT, 'shared') },
  { prefix: '/', dir: path.join(ROOT, 'public') },
];

const ERROR_TEXT = {
  bad_message: '이해할 수 없는 요청이에요.',
  room_not_found: '그런 방이 없어요. 코드를 다시 확인해 주세요.',
  room_full: '이미 두 명이 들어와 있는 방이에요.',
  server_full: '지금은 방이 가득 찼어요. 잠시 뒤에 다시 시도해 주세요.',
  no_room: '먼저 방에 들어가야 해요.',
  bad_token: '재접속 정보가 맞지 않아요. 코드로 다시 들어와 주세요.',
  invalid_number: '서로 다른 숫자로 자릿수에 맞게 입력해 주세요.',
  not_setup_phase: '지금은 비밀번호를 정하는 단계가 아니에요.',
  not_playing: '지금은 공격할 수 없어요.',
  not_your_turn: '아직 상대 차례예요.',
  duplicate_guess: '이미 해 본 숫자예요.',
  not_over: '아직 게임이 끝나지 않았어요.',
  rate_limited: '요청이 너무 빨라요.',
  wrong_game: '이 코드는 다른 게임의 방이에요.',
  already_over: '이미 끝난 게임이에요.',
  no_spectate: '이 게임은 관전할 수 없어요.',
  spectators_full: '관전석이 가득 찼어요.',
  not_player: '자리에 앉은 사람만 할 수 있어요.',
  not_spectator: '관전 중일 때만 할 수 있어요.',
  in_progress: '판이 끝난 뒤에 할 수 있어요.',
  seat_empty: '그 자리는 비어 있어요 — 바로 앉을 수 있어요.',
  no_request: '그런 교대 요청이 없어요.',
  board_over: '내 판은 이미 끝났어요.',
};

/** 만들기/참가 요청이 어느 게임인지. 안 적으면 숫자야구. */
function kindOf(msg) {
  return KINDS[msg.game] && msg.game !== 'baseball' ? msg.game : 'baseball';
}

function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.endsWith('/')) decoded += 'index.html';
  if (PAGES[decoded]) decoded = PAGES[decoded];
  for (const { prefix, dir } of MOUNTS) {
    if (!decoded.startsWith(prefix)) continue;
    const rel = decoded.slice(prefix.length);
    const target = path.resolve(dir, rel);
    if (target !== dir && !target.startsWith(dir + path.sep)) return null; // 경로 탈출 차단
    if (!MIME[path.extname(target)]) return null;
    return target;
  }
  return null;
}

const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { allow: 'GET, HEAD' }).end();
    return;
  }
  const url = req.url || '/';
  if (url === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: true, ...store.stats, uptime: Math.round(process.uptime()) }));
    return;
  }
  const file = resolveFile(url);
  if (!file) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('찾을 수 없습니다');
    return;
  }
  fs.stat(file, (err, stat) => {
    if (err || !stat.isFile()) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('찾을 수 없습니다');
      return;
    }
    res.writeHead(200, {
      'content-type': MIME[path.extname(file)],
      'content-length': stat.size,
      'cache-control': 'no-cache',
    });
    if (req.method === 'HEAD') return res.end();
    fs.createReadStream(file).pipe(res);
  });
});

const store = new RoomStore();
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 8 * 1024 });

function send(ws, message) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
}

function sendError(ws, code) {
  send(ws, { t: 'error', code, message: ERROR_TEXT[code] || '문제가 생겼어요.' });
}

/** 메시지 폭주 차단 (5초에 100개 — 지뢰찾기는 빠르게 연타한다). */
function allowed(ws) {
  const now = Date.now();
  if (now - ws.windowStart > 5000) {
    ws.windowStart = now;
    ws.windowCount = 0;
  }
  return ++ws.windowCount <= 100;
}

/** 방에서 나간다. explicit 이면(직접 나가기) 관전석은 바로 지우고, 끊긴 거면 유예를 둔다. */
function leaveRoom(ws, { explicit = false } = {}) {
  const room = ws.room;
  if (!room) return;
  const seat = ws.seat;
  const specToken = ws.specToken;
  ws.room = null;
  ws.seat = null;
  ws.specToken = null;
  let changed = false;
  if (seat !== null) {
    changed = room.detach(seat, ws);
    if (explicit && room.vacate(seat)) changed = true;   // 직접 나갔으면 자리를 비운다 (판이 끝난 뒤일 때)
  }
  if (specToken) changed = room.detachSpectator(specToken, ws, { remove: explicit });
  if (changed) room.broadcast();
}

function enter(ws, room, index, token) {
  leaveRoom(ws);
  ws.room = room;
  ws.seat = index;
  ws.specToken = null;
  room.attach(index, ws);
  send(ws, { t: 'joined', code: room.code, game: room.kind, role: 'player', you: index, token });
  room.broadcast();
}

function enterAsSpectator(ws, room, token) {
  leaveRoom(ws);
  ws.room = room;
  ws.seat = null;
  ws.specToken = token;
  room.attachSpectator(token, ws);
  send(ws, { t: 'joined', code: room.code, game: room.kind, role: 'spectator', you: null, token });
  room.broadcast();
}

/** 방에 들어와 있고, (게임을 밝혔다면) 그 게임의 방일 때만 통과. role 을 주면 그 역할일 때만. */
function roomFor(ws, kind = null, role = null) {
  if (!ws.room) return sendError(ws, 'no_room'), null;
  if (kind && ws.room.kind !== kind) return sendError(ws, 'wrong_game'), null;
  if (role === 'player' && ws.seat === null) return sendError(ws, 'not_player'), null;
  if (role === 'spectator' && !ws.specToken) return sendError(ws, 'not_spectator'), null;
  return ws.room;
}

/** 규칙이 돌려준 결과가 실패면 에러를 보내고 false, 아니면 상태를 뿌리고 true. */
function apply(ws, room, out) {
  if (out && out.ok === false) {
    sendError(ws, out.error);
    return false;
  }
  room.touch();
  room.broadcast();
  return true;
}

const handlers = {
  create(ws, msg) {
    const kind = kindOf(msg);
    const room = store.create(kind, KINDS[kind].normalizeOptions(msg));
    if (!room) return sendError(ws, 'server_full');
    const seat = room.take(msg.name);
    enter(ws, room, seat.index, seat.token);
  },

  join(ws, msg) {
    const room = store.get(msg.code);
    if (!room) return sendError(ws, 'room_not_found');
    if (msg.game && room.kind !== kindOf(msg)) return sendError(ws, 'wrong_game');
    if (room.full) return sendError(ws, 'room_full');
    const seat = room.take(msg.name);
    if (!seat) return sendError(ws, 'room_full');
    enter(ws, room, seat.index, seat.token);
  },

  /** 재접속 — 토큰이 자리 것이든 관전석 것이든 원래 역할로 돌아간다. */
  rejoin(ws, msg) {
    const room = store.get(msg.code);
    if (!room) return sendError(ws, 'room_not_found');
    if (msg.game && room.kind !== kindOf(msg)) return sendError(ws, 'wrong_game');
    const token = String(msg.token ?? '');
    const index = room.seatForToken(token);
    if (index !== null) return enter(ws, room, index, token);
    if (room.spectator(token)) return enterAsSpectator(ws, room, token);
    sendError(ws, 'bad_token');
  },

  /* ── 관전 ── */

  watch(ws, msg) {
    const room = store.get(msg.code);
    if (!room) return sendError(ws, 'room_not_found');
    if (msg.game && room.kind !== kindOf(msg)) return sendError(ws, 'wrong_game');
    if (!room.canSpectate) return sendError(ws, 'no_spectate');
    const token = room.watch(msg.name);
    if (!token) return sendError(ws, 'spectators_full');
    enterAsSpectator(ws, room, token);
  },

  /** 관전자가 빈 자리에 앉는다. */
  sit(ws) {
    const room = roomFor(ws, null, 'spectator');
    if (!room) return;
    const out = room.sit(ws.specToken);
    if (!out.ok) return sendError(ws, out.error);
    const token = ws.specToken;
    ws.specToken = null;
    ws.seat = out.index;
    send(ws, { t: 'joined', code: room.code, game: room.kind, role: 'player', you: out.index, token });
    room.touch();
    room.broadcast();
  },

  /** 자리에 앉은 사람이 관전으로 빠진다. 진행 중이면 먼저 기권해야 한다. */
  stand(ws) {
    const room = roomFor(ws, null, 'player');
    if (!room) return;
    const out = room.stand(ws.seat);
    if (!out.ok) return sendError(ws, out.error);
    ws.seat = null;
    ws.specToken = out.token;
    send(ws, { t: 'joined', code: room.code, game: room.kind, role: 'spectator', you: null, token: out.token });
    room.touch();
    room.broadcast();
  },

  /** 관전자 → "그 자리 사람과 바꾸고 싶다". seat 이 null 이면 취소. */
  swap(ws, msg) {
    const room = roomFor(ws, null, 'spectator');
    if (!room) return;
    const seat = msg.seat === null || msg.seat === undefined ? null : Number(msg.seat);
    apply(ws, room, room.requestSwap(ws.specToken, seat));
  },

  /** 자리 사람 → 교대 수락. 바뀐 두 사람 모두에게 새 역할을 알린다. */
  swap_accept(ws, msg) {
    const room = roomFor(ws, null, 'player');
    if (!room) return;
    const mySeat = ws.seat;
    const myToken = room.tokens[mySeat];
    const out = room.acceptSwap(mySeat, String(msg.pid ?? ''));
    if (!out.ok) return sendError(ws, out.error);
    // 나는 관전자로
    ws.seat = null;
    ws.specToken = myToken;
    send(ws, { t: 'joined', code: room.code, game: room.kind, role: 'spectator', you: null, token: myToken });
    // 상대(관전자였던 사람)는 자리로 — 그 소켓을 찾아 역할을 바꾼다
    const newToken = room.tokens[mySeat];
    const other = room.sockets[mySeat];
    if (other) {
      other.seat = mySeat;
      other.specToken = null;
      send(other, { t: 'joined', code: room.code, game: room.kind, role: 'player', you: mySeat, token: newToken });
    }
    room.touch();
    room.broadcast();
  },

  swap_decline(ws, msg) {
    const room = roomFor(ws, null, 'player');
    if (!room) return;
    apply(ws, room, room.declineSwap(ws.seat, String(msg.pid ?? '')));
  },

  /* ── 숫자야구 ── */

  secret(ws, msg) {
    const room = roomFor(ws, 'baseball', 'player');
    if (!room) return;
    apply(ws, room, room.rules.submitSecret(room.game, ws.seat, String(msg.value ?? '')));
  },

  guess(ws, msg) {
    const room = roomFor(ws, 'baseball', 'player');
    if (!room) return;
    apply(ws, room, room.rules.makeGuess(room.game, ws.seat, String(msg.value ?? '')));
  },

  /* ── 지뢰찾기 1:1 ── */

  /**
   * 내 판 조작: {a:'reveal'|'mark'|'chord', i:칸, n:조작 번호, q:물음표 사용}.
   * 브라우저는 규칙을 먼저 적용해 그려 놓고 보내므로, 거절돼도 에러 대신
   * 확정 상태를 내려보내 화면을 맞추기만 한다.
   */
  ms(ws, msg) {
    const room = roomFor(ws, 'minesweeper', 'player');
    if (!room) return;
    const n = Number(msg.n);
    if (Number.isFinite(n)) room.acks[ws.seat] = n;
    room.rules.act(room.game, ws.seat, String(msg.a ?? ''), Number(msg.i), Date.now(), { question: Boolean(msg.q) });
    room.touch();
    room.broadcast();
  },

  /* ── 틀린그림찾기 1:1 ── */

  /** 그림을 찍는다: {x, y} 장면 좌표. 맞았는지는 본인에게만 바로 알려주고, 상태는 모두에게. */
  spot(ws, msg) {
    const room = roomFor(ws, 'spot', 'player');
    if (!room) return;
    const out = room.rules.click(room.game, ws.seat, msg.x, msg.y, Date.now());
    if (!out.ok) return sendError(ws, out.error);
    send(ws, { t: 'spot_result', hit: out.hit, index: out.index ?? null, locked: Boolean(out.locked), lockedUntil: out.lockedUntil ?? null, x: Number(msg.x), y: Number(msg.y) });
    room.touch();
    room.broadcast();
  },

  /* ── 공통 ── */

  chat(ws, msg) {
    const room = roomFor(ws);
    if (!room) return;
    const who = ws.seat !== null
      ? { player: ws.seat, pid: room.pids[ws.seat], name: room.names[ws.seat] }
      : { player: null, pid: room.spectator(ws.specToken)?.pid, name: room.spectator(ws.specToken)?.name ?? '관전자' };
    if (room.addChat(who, msg.text)) room.broadcast();
  },

  rematch(ws) {
    const room = roomFor(ws, null, 'player');
    if (!room) return;
    apply(ws, room, room.rules.requestRematch(room.game, ws.seat));
  },

  surrender(ws) {
    const room = roomFor(ws, null, 'player');
    if (!room) return;
    room.rules.forfeit(room.game, ws.seat, 'forfeit');
    room.broadcast();
  },

  leave(ws) {
    leaveRoom(ws, { explicit: true });
  },

  ping(ws) {
    send(ws, { t: 'pong' });
  },
};

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.seat = null;
  ws.specToken = null;
  ws.windowStart = Date.now();
  ws.windowCount = 0;

  ws.on('pong', () => {
    ws.isAlive = true;
  });

  ws.on('message', (raw) => {
    if (!allowed(ws)) {
      sendError(ws, 'rate_limited');
      return;
    }
    let msg;
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return sendError(ws, 'bad_message');
    }
    if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return sendError(ws, 'bad_message');
    const handler = handlers[msg.t];
    if (!handler) return sendError(ws, 'bad_message');
    try {
      handler(ws, msg);
    } catch (err) {
      console.error('handler failed:', msg.t, err);
      sendError(ws, 'bad_message');
    }
  });

  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (!ws.isAlive) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    ws.ping();
  }
}, 30_000);

const ticker = setInterval(() => store.tickAll(), 1000);

server.listen(PORT, HOST, () => {
  console.log(`게임 서버 실행 중 → http://localhost:${PORT} (숫자야구 / · 지뢰찾기 /minesweeper · 틀린그림찾기 /spot)`);
});

function shutdown() {
  clearInterval(heartbeat);
  clearInterval(ticker);
  for (const ws of wss.clients) ws.close(1001, 'server_shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
