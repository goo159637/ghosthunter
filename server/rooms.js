/**
 * 방 관리 — 코드 발급, 자리 배정, 관전, 재접속 유예, 상태 브로드캐스트.
 * 게임 규칙은 건드리지 않는다. 규칙은 shared/ 의 각 상태머신이 전부 갖고 있고,
 * 방은 어떤 게임이든 같은 인터페이스(createGame / seatPlayer / setPresence / tick / forfeit / status / viewFor)로 다룬다.
 * 관전·교대는 규칙 모듈이 viewForSpectator / unseatPlayer 를 내놓을 때만 된다 (지뢰찾기).
 */
import { randomInt, randomBytes } from 'node:crypto';
import * as baseball from '../shared/engine.js';
import * as minesweeper from '../shared/msversus.js';

/** 방 종류 → 규칙 모듈 */
export const KINDS = { baseball, minesweeper };

// 헷갈리는 글자(0/O, 1/I)를 뺀 알파벳
const CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const CODE_LENGTH = 4;

export const MAX_ROOMS = 500;
export const MAX_SPECTATORS = 20;
export const RECONNECT_SECONDS = 60;   // 연결이 끊긴 뒤 돌아올 수 있는 시간
export const IDLE_MINUTES = 30;        // 아무 일도 없는 방은 정리
const CHAT_LIMIT = 40;
const CHAT_MAX_LENGTH = 120;

function newCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

const newToken = () => randomBytes(12).toString('hex');   // 재접속용 비밀 토큰
const newPid = () => randomBytes(4).toString('hex');      // 사람을 가리키는 공개 id

function cleanName(name, fallback) {
  return String(name ?? '').trim().slice(0, 16) || fallback;
}

export class Room {
  constructor(code, kind, opts) {
    this.code = code;
    this.kind = kind;
    this.rules = KINDS[kind];
    this.game = this.rules.createGame(opts);
    this.sockets = [null, null];
    this.tokens = [null, null];
    this.pids = [null, null];         // 자리에 앉은 사람의 공개 id
    this.names = [null, null];
    this.graceUntil = [null, null];
    this.acks = [0, 0];               // 각 자리가 보낸 마지막 조작 번호 — 브라우저가 미리 그린 화면과 맞추는 데 쓴다
    this.spectators = new Map();      // token → { pid, name, ws, lastSeen }
    this.swapRequests = new Map();    // 관전자 token → 바꾸고 싶은 자리 번호
    this.chat = [];
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
  }

  get full() {
    return this.tokens.every((t) => t !== null);
  }

  get freeSeat() {
    const i = this.tokens.indexOf(null);
    return i === -1 ? null : i;
  }

  get canSpectate() {
    return typeof this.rules.viewForSpectator === 'function';
  }

  touch() {
    this.lastActivity = Date.now();
  }

  /* ───────── 자리 ───────── */

  /** 빈 자리에 앉히고 재접속용 토큰을 발급한다. */
  take(name) {
    const index = this.freeSeat;
    if (index === null) return null;
    const token = newToken();
    const pid = newPid();
    if (!this.seat(index, token, pid, name)) return null;
    return { index, token };
  }

  seat(index, token, pid, name) {
    const clean = cleanName(name, index === 0 ? '플레이어 1' : '플레이어 2');
    const out = this.rules.seatPlayer(this.game, index, clean, Date.now(), pid);
    if (out && out.ok === false) return false;
    this.tokens[index] = token;
    this.pids[index] = pid;
    this.names[index] = clean;
    this.graceUntil[index] = null;
    this.touch();
    return true;
  }

  seatForToken(token) {
    const index = this.tokens.indexOf(token);
    return index === -1 ? null : index;
  }

  attach(index, ws) {
    const previous = this.sockets[index];
    if (previous && previous !== ws && previous.readyState === previous.OPEN) {
      // 같은 자리로 새 탭이 들어온 경우 — 옛 연결은 정리한다.
      previous.close(4000, 'replaced');
    }
    this.sockets[index] = ws;
    this.graceUntil[index] = null;
    this.rules.setPresence(this.game, index, true);
    this.touch();
  }

  /**
   * 자리에서 소켓을 뗀다.
   * ws 를 넘기면 "지금 그 자리에 있는 소켓이 정말 이것일 때만" 뗀다 —
   * 새 연결이 이미 자리를 넘겨받은 뒤 옛 소켓의 close 가 늦게 도착해도 새 연결을 지우지 않도록.
   * @returns {boolean} 실제로 뗐는지
   */
  detach(index, ws = null) {
    if (ws && this.sockets[index] !== ws) return false;
    this.sockets[index] = null;
    this.rules.setPresence(this.game, index, false);
    const inProgress = this.rules.status(this.game) === 'playing';
    this.graceUntil[index] = inProgress ? Date.now() + RECONNECT_SECONDS * 1000 : null;
    this.touch();
    return true;
  }

  /* ───────── 관전 ───────── */

  /** 관전자로 들어온다. */
  watch(name) {
    if (!this.canSpectate) return null;
    if (this.spectators.size >= MAX_SPECTATORS) return null;
    const token = newToken();
    this.spectators.set(token, { pid: newPid(), name: cleanName(name, '관전자'), ws: null, lastSeen: Date.now() });
    this.touch();
    return token;
  }

  spectator(token) {
    return this.spectators.get(token) ?? null;
  }

  attachSpectator(token, ws) {
    const s = this.spectators.get(token);
    if (!s) return false;
    if (s.ws && s.ws !== ws && s.ws.readyState === s.ws.OPEN) s.ws.close(4000, 'replaced');
    s.ws = ws;
    s.lastSeen = Date.now();
    return true;
  }

  /** 관전자 소켓을 뗀다. 자리는 유예 시간 동안 남겨 둔다 (새로고침 복귀용). remove 면 바로 지운다. */
  detachSpectator(token, ws = null, { remove = false } = {}) {
    const s = this.spectators.get(token);
    if (!s) return false;
    if (ws && s.ws !== ws) return false;
    if (remove) {
      this.spectators.delete(token);
      this.swapRequests.delete(token);
      return true;
    }
    s.ws = null;
    s.lastSeen = Date.now();
    return true;
  }

  /** 관전자가 빈 자리에 앉는다. */
  sit(token) {
    const s = this.spectators.get(token);
    if (!s) return { ok: false, error: 'not_spectator' };
    const index = this.freeSeat;
    if (index === null) return { ok: false, error: 'room_full' };
    if (!this.seat(index, token, s.pid, s.name)) return { ok: false, error: 'in_progress' };
    this.spectators.delete(token);
    this.swapRequests.delete(token);
    this.sockets[index] = s.ws;
    this.rules.setPresence(this.game, index, Boolean(s.ws));
    return { ok: true, index };
  }

  /** 자리에 앉은 사람이 관전으로 빠진다. 진행 중엔 안 된다 (먼저 기권). */
  stand(index) {
    if (!this.canSpectate || typeof this.rules.unseatPlayer !== 'function') return { ok: false, error: 'no_spectate' };
    const out = this.rules.unseatPlayer(this.game, index);
    if (out && out.ok === false) return out;
    const token = this.tokens[index];
    this.spectators.set(token, { pid: this.pids[index], name: this.names[index], ws: this.sockets[index], lastSeen: Date.now() });
    this.tokens[index] = null;
    this.pids[index] = null;
    this.names[index] = null;
    this.sockets[index] = null;
    this.graceUntil[index] = null;
    this.acks[index] = 0;
    this.touch();
    return { ok: true, token };
  }

  /* ───────── 교대 ───────── */

  requestSwap(token, seat) {
    if (!this.spectators.has(token)) return { ok: false, error: 'not_spectator' };
    if (seat === null) {
      this.swapRequests.delete(token);
      return { ok: true };
    }
    if (seat !== 0 && seat !== 1) return { ok: false, error: 'bad_message' };
    if (this.tokens[seat] === null) return { ok: false, error: 'seat_empty' };
    this.swapRequests.set(token, seat);
    this.touch();
    return { ok: true };
  }

  /** index 번 자리 사람이 pid 관전자의 교대 요청을 받아들인다. 판이 끝난 뒤에만. */
  acceptSwap(index, pid) {
    const entry = [...this.swapRequests].find(([token, seat]) => seat === index && this.spectators.get(token)?.pid === pid);
    if (!entry) return { ok: false, error: 'no_request' };
    if (this.rules.status(this.game) === 'playing') return { ok: false, error: 'in_progress' };
    const [specToken] = entry;
    const stood = this.stand(index);
    if (!stood.ok) return stood;
    const sat = this.sit(specToken);
    if (!sat.ok) return sat;
    return { ok: true, index };
  }

  declineSwap(index, pid) {
    for (const [token, seat] of this.swapRequests) {
      if (seat === index && this.spectators.get(token)?.pid === pid) this.swapRequests.delete(token);
    }
    return { ok: true };
  }

  /* ───────── 채팅 ───────── */

  addChat(who, text) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
    if (!clean) return false;
    this.chat.push({ player: who.player ?? null, pid: who.pid ?? null, name: who.name, text: clean, at: Date.now() });
    if (this.chat.length > CHAT_LIMIT) this.chat.shift();
    this.touch();
    return true;
  }

  /* ───────── 보내기 ───────── */

  /** 방에 있는 사람들 — 자리와 관전석. */
  people() {
    return {
      players: this.tokens.map((t, i) => (t === null ? null : { pid: this.pids[i], name: this.names[i], present: this.sockets[i] !== null })),
      spectators: [...this.spectators.values()].map((s) => ({ pid: s.pid, name: s.name, present: s.ws !== null })),
    };
  }

  payloadFor(index) {
    const swaps = [];
    for (const [token, seat] of this.swapRequests) {
      const s = this.spectators.get(token);
      if (seat === index && s) swaps.push({ pid: s.pid, name: s.name });
    }
    return {
      t: 'state',
      code: this.code,
      game: this.kind,
      role: 'player',
      you: index,
      view: this.rules.viewFor(this.game, index),
      ack: this.acks[index],
      chat: this.chat,
      grace: this.graceUntil[1 - index],
      people: this.people(),
      swaps,
    };
  }

  payloadForSpectator(token) {
    const s = this.spectators.get(token);
    return {
      t: 'state',
      code: this.code,
      game: this.kind,
      role: 'spectator',
      you: null,
      pid: s?.pid ?? null,
      view: this.rules.viewForSpectator(this.game),
      chat: this.chat,
      people: this.people(),
      freeSeat: this.freeSeat,
      mySwap: this.swapRequests.get(token) ?? null,
    };
  }

  send(index, message) {
    const ws = this.sockets[index];
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  broadcast() {
    for (let i = 0; i < 2; i++) if (this.tokens[i] !== null) this.send(i, this.payloadFor(i));
    for (const [token, s] of this.spectators) {
      if (s.ws && s.ws.readyState === s.ws.OPEN) s.ws.send(JSON.stringify(this.payloadForSpectator(token)));
    }
  }

  /** 시간 경과 처리. 바뀐 게 있으면 true. */
  tick(now = Date.now()) {
    let changed = this.rules.tick(this.game, now);
    for (let i = 0; i < 2; i++) {
      const until = this.graceUntil[i];
      if (until === null || now < until) continue;
      this.graceUntil[i] = null;
      if (this.rules.status(this.game) === 'playing') {
        this.rules.forfeit(this.game, i, 'forfeit');
        changed = true;
      }
    }
    for (const [token, s] of this.spectators) {
      if (s.ws === null && now - s.lastSeen > RECONNECT_SECONDS * 1000) {
        this.spectators.delete(token);
        this.swapRequests.delete(token);
        changed = true;
      }
    }
    return changed;
  }

  get abandoned() {
    const anyoneHere = this.sockets.some((s) => s !== null) || [...this.spectators.values()].some((s) => s.ws !== null);
    const idleFor = Date.now() - this.lastActivity;
    const status = this.rules.status(this.game);
    if (!anyoneHere && status === 'over') return idleFor > 60_000;
    if (!anyoneHere && status === 'lobby') return idleFor > 10 * 60_000;
    return idleFor > IDLE_MINUTES * 60_000;
  }

  get connections() {
    const players = this.sockets.filter(Boolean).length;
    const spectators = [...this.spectators.values()].filter((s) => s.ws).length;
    return { players, spectators };
  }
}

export class RoomStore {
  constructor() {
    this.rooms = new Map();
  }

  create(kind, opts) {
    if (!KINDS[kind]) throw new Error(`unknown room kind: ${kind}`);
    if (this.rooms.size >= MAX_ROOMS) return null;
    let code = newCode();
    let attempts = 0;
    while (this.rooms.has(code)) {
      if (++attempts > 50) return null;
      code = newCode();
    }
    const room = new Room(code, kind, opts);
    this.rooms.set(code, room);
    return room;
  }

  get(code) {
    return this.rooms.get(String(code ?? '').toUpperCase().trim()) ?? null;
  }

  remove(code) {
    this.rooms.delete(code);
  }

  /** 1초마다 호출된다: 제한시간·유예시간 처리 후 바뀐 방만 브로드캐스트, 버려진 방은 정리. */
  tickAll(now = Date.now()) {
    for (const [code, room] of this.rooms) {
      if (room.tick(now)) room.broadcast();
      if (room.abandoned) {
        for (const ws of room.sockets) if (ws) ws.close(4001, 'room_closed');
        for (const s of room.spectators.values()) if (s.ws) s.ws.close(4001, 'room_closed');
        this.rooms.delete(code);
      }
    }
  }

  get stats() {
    let players = 0;
    let spectators = 0;
    for (const room of this.rooms.values()) {
      const c = room.connections;
      players += c.players;
      spectators += c.spectators;
    }
    return { rooms: this.rooms.size, players, spectators };
  }
}
