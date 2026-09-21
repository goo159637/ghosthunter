/**
 * 방 관리 — 코드 발급, 자리 배정, 재접속 유예, 상태 브로드캐스트.
 * 게임 규칙은 건드리지 않는다. 규칙은 shared/ 의 각 상태머신이 전부 갖고 있고,
 * 방은 어떤 게임이든 같은 인터페이스(createGame / seatPlayer / setPresence / tick / forfeit / status / viewFor)로 다룬다.
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
export const RECONNECT_SECONDS = 60;   // 연결이 끊긴 뒤 돌아올 수 있는 시간
export const IDLE_MINUTES = 30;        // 아무 일도 없는 방은 정리
const CHAT_LIMIT = 40;
const CHAT_MAX_LENGTH = 120;

function newCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) out += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return out;
}

export class Room {
  constructor(code, kind, opts) {
    this.code = code;
    this.kind = kind;
    this.rules = KINDS[kind];
    this.game = this.rules.createGame(opts);
    this.sockets = [null, null];
    this.tokens = [null, null];
    this.graceUntil = [null, null];
    this.acks = [0, 0];   // 각 자리가 보낸 마지막 조작 번호 — 브라우저가 미리 그린 화면과 맞추는 데 쓴다
    this.chat = [];
    this.createdAt = Date.now();
    this.lastActivity = Date.now();
  }

  get full() {
    return this.tokens.every((t) => t !== null);
  }

  touch() {
    this.lastActivity = Date.now();
  }

  /** 빈 자리에 앉히고 재접속용 토큰을 발급한다. */
  take(name) {
    const index = this.tokens.findIndex((t) => t === null);
    if (index === -1) return null;
    const token = randomBytes(12).toString('hex');
    this.tokens[index] = token;
    this.rules.seatPlayer(this.game, index, name);
    this.touch();
    return { index, token };
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

  addChat(index, text) {
    const clean = String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LENGTH);
    if (!clean) return false;
    this.chat.push({ player: index, name: this.game.players[index].name, text: clean, at: Date.now() });
    if (this.chat.length > CHAT_LIMIT) this.chat.shift();
    this.touch();
    return true;
  }

  payloadFor(index) {
    return {
      t: 'state',
      code: this.code,
      game: this.kind,
      view: this.rules.viewFor(this.game, index),
      ack: this.acks[index],
      chat: this.chat,
      grace: this.graceUntil[1 - index],
    };
  }

  send(index, message) {
    const ws = this.sockets[index];
    if (ws && ws.readyState === ws.OPEN) ws.send(JSON.stringify(message));
  }

  broadcast() {
    for (let i = 0; i < 2; i++) this.send(i, this.payloadFor(i));
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
    return changed;
  }

  get abandoned() {
    const bothGone = this.sockets.every((s) => s === null);
    const idleFor = Date.now() - this.lastActivity;
    const status = this.rules.status(this.game);
    if (bothGone && status === 'over') return idleFor > 60_000;
    if (bothGone && status === 'lobby') return idleFor > 10 * 60_000;
    return idleFor > IDLE_MINUTES * 60_000;
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
        this.rooms.delete(code);
      }
    }
  }

  get stats() {
    let players = 0;
    for (const room of this.rooms.values()) players += room.sockets.filter(Boolean).length;
    return { rooms: this.rooms.size, players };
  }
}
