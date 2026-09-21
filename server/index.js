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
};

/** 만들기/참가 요청이 어느 게임인지. 안 적으면 숫자야구. */
function kindOf(msg) {
  return msg.game === 'minesweeper' ? 'minesweeper' : 'baseball';
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

function leaveRoom(ws) {
  const room = ws.room;
  if (!room) return;
  const seat = ws.seat;
  ws.room = null;
  ws.seat = null;
  if (room.detach(seat, ws)) room.broadcast();
}

function enter(ws, room, index, token) {
  leaveRoom(ws);
  ws.room = room;
  ws.seat = index;
  room.attach(index, ws);
  send(ws, { t: 'joined', code: room.code, game: room.kind, you: index, token });
  room.broadcast();
}

/** 방에 들어와 있고, (게임을 밝혔다면) 그 게임의 방일 때만 통과. */
function roomFor(ws, kind = null) {
  if (!ws.room) return sendError(ws, 'no_room'), null;
  if (kind && ws.room.kind !== kind) return sendError(ws, 'wrong_game'), null;
  return ws.room;
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

  rejoin(ws, msg) {
    const room = store.get(msg.code);
    if (!room) return sendError(ws, 'room_not_found');
    if (msg.game && room.kind !== kindOf(msg)) return sendError(ws, 'wrong_game');
    const index = room.seatForToken(String(msg.token ?? ''));
    if (index === null) return sendError(ws, 'bad_token');
    enter(ws, room, index, room.tokens[index]);
  },

  /* ── 숫자야구 ── */

  secret(ws, msg) {
    const room = roomFor(ws, 'baseball');
    if (!room) return;
    const out = room.rules.submitSecret(room.game, ws.seat, String(msg.value ?? ''));
    if (!out.ok) return sendError(ws, out.error);
    room.touch();
    room.broadcast();
  },

  guess(ws, msg) {
    const room = roomFor(ws, 'baseball');
    if (!room) return;
    const out = room.rules.makeGuess(room.game, ws.seat, String(msg.value ?? ''));
    if (!out.ok) return sendError(ws, out.error);
    room.touch();
    room.broadcast();
  },

  /* ── 지뢰찾기 1:1 ── */

  /**
   * 내 판 조작: {a:'reveal'|'mark'|'chord', i:칸, n:조작 번호, q:물음표 사용}.
   * 브라우저는 규칙을 먼저 적용해 그려 놓고 보내므로, 거절돼도 에러 대신
   * 확정 상태를 내려보내 화면을 맞추기만 한다.
   */
  ms(ws, msg) {
    const room = roomFor(ws, 'minesweeper');
    if (!room) return;
    const n = Number(msg.n);
    if (Number.isFinite(n)) room.acks[ws.seat] = n;
    room.rules.act(room.game, ws.seat, String(msg.a ?? ''), Number(msg.i), Date.now(), { question: Boolean(msg.q) });
    room.touch();
    room.broadcast();
  },

  /* ── 공통 ── */

  chat(ws, msg) {
    if (!ws.room) return sendError(ws, 'no_room');
    if (ws.room.addChat(ws.seat, msg.text)) ws.room.broadcast();
  },

  rematch(ws) {
    const room = roomFor(ws);
    if (!room) return;
    const out = room.rules.requestRematch(room.game, ws.seat);
    if (!out.ok) return sendError(ws, out.error);
    room.touch();
    room.broadcast();
  },

  surrender(ws) {
    const room = roomFor(ws);
    if (!room) return;
    room.rules.forfeit(room.game, ws.seat, 'forfeit');
    room.broadcast();
  },

  leave(ws) {
    leaveRoom(ws);
  },

  ping(ws) {
    send(ws, { t: 'pong' });
  },
};

wss.on('connection', (ws) => {
  ws.isAlive = true;
  ws.room = null;
  ws.seat = null;
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
  console.log(`게임 서버 실행 중 → http://localhost:${PORT} (숫자야구 / , 지뢰찾기 /minesweeper)`);
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
