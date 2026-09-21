/**
 * 숫자야구 서버 — 정적 파일 + WebSocket 대전.
 * 의존성은 ws 하나뿐이다.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { MIN_DIGITS, MAX_DIGITS } from '../shared/baseball.js';
import { normalizeOptions } from '../shared/engine.js';
import { RoomStore, actions } from './rooms.js';

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
};

function resolveFile(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0]);
  } catch {
    return null;
  }
  if (decoded.endsWith('/')) decoded += 'index.html';
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

/** 초당 메시지 폭주 차단 (5초에 40개). */
function allowed(ws) {
  const now = Date.now();
  if (now - ws.windowStart > 5000) {
    ws.windowStart = now;
    ws.windowCount = 0;
  }
  return ++ws.windowCount <= 40;
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
  send(ws, { t: 'joined', code: room.code, you: index, token });
  room.broadcast();
}

const handlers = {
  create(ws, msg) {
    const opts = normalizeOptions({ digits: msg.digits, turnSeconds: msg.turnSeconds });
    const room = store.create(opts);
    if (!room) return sendError(ws, 'server_full');
    const seat = room.take(msg.name);
    enter(ws, room, seat.index, seat.token);
  },

  join(ws, msg) {
    const room = store.get(msg.code);
    if (!room) return sendError(ws, 'room_not_found');
    if (room.full) return sendError(ws, 'room_full');
    const seat = room.take(msg.name);
    if (!seat) return sendError(ws, 'room_full');
    enter(ws, room, seat.index, seat.token);
  },

  rejoin(ws, msg) {
    const room = store.get(msg.code);
    if (!room) return sendError(ws, 'room_not_found');
    const index = room.seatForToken(String(msg.token ?? ''));
    if (index === null) return sendError(ws, 'bad_token');
    enter(ws, room, index, room.tokens[index]);
  },

  secret(ws, msg) {
    if (!ws.room) return sendError(ws, 'no_room');
    const out = actions.submitSecret(ws.room.game, ws.seat, String(msg.value ?? ''));
    if (!out.ok) return sendError(ws, out.error);
    ws.room.touch();
    ws.room.broadcast();
  },

  guess(ws, msg) {
    if (!ws.room) return sendError(ws, 'no_room');
    const out = actions.makeGuess(ws.room.game, ws.seat, String(msg.value ?? ''));
    if (!out.ok) return sendError(ws, out.error);
    ws.room.touch();
    ws.room.broadcast();
  },

  chat(ws, msg) {
    if (!ws.room) return sendError(ws, 'no_room');
    if (ws.room.addChat(ws.seat, msg.text)) ws.room.broadcast();
  },

  rematch(ws) {
    if (!ws.room) return sendError(ws, 'no_room');
    const out = actions.requestRematch(ws.room.game, ws.seat);
    if (!out.ok) return sendError(ws, out.error);
    ws.room.touch();
    ws.room.broadcast();
  },

  surrender(ws) {
    if (!ws.room) return sendError(ws, 'no_room');
    actions.forfeit(ws.room.game, ws.seat, 'forfeit');
    ws.room.broadcast();
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
  console.log(`숫자야구 서버 실행 중 → http://localhost:${PORT} (${MIN_DIGITS}~${MAX_DIGITS}자리)`);
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
