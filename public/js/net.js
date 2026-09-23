/**
 * 온라인 대전 엔진 — 서버와의 WebSocket 연결을 감싼다.
 * 연결이 끊기면 자동으로 다시 붙고, 저장해 둔 토큰으로 원래 자리에 복귀한다.
 * 숫자야구와 지뢰찾기 1:1 이 같이 쓴다 — 게임별로 다른 건 방 만들 때 옵션과 조작 메시지뿐이다.
 */
const RECONNECT_STEPS = [500, 1000, 2000, 4000, 8000];

function socketUrl() {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/ws`;
}

function storeToken(code, token, game) {
  try {
    sessionStorage.setItem(`${game}:${code}`, token);
  } catch { /* 시크릿 모드 등 — 없어도 게임은 돌아간다 */ }
}

export function loadToken(code, game = 'baseball') {
  try {
    return sessionStorage.getItem(`${game}:${code}`);
  } catch {
    return null;
  }
}

/**
 * @param {{
 *   type:'create'|'join'|'watch', name:string, code?:string,
 *   game?:'baseball'|'minesweeper'|'spot', options?:object,
 *   digits?:number, turnSeconds?:number
 * }} intent  options 는 방 만들 때 서버로 그대로 보낸다. (digits/turnSeconds 는 숫자야구의 옛 형식)
 *            'watch' 는 관전으로 들어간다 (지뢰찾기만).
 */
export function createOnlineEngine(intent) {
  const listeners = new Set();
  const errorListeners = new Set();
  const messageListeners = new Set();   // state/joined/error 가 아닌 게임별 메시지
  const game = typeof intent.game === 'string' && intent.game ? intent.game : 'baseball';   // 'baseball' | 'minesweeper' | 'spot' …
  const options = intent.options ?? { digits: intent.digits, turnSeconds: intent.turnSeconds };
  let ws = null;
  let attempt = 0;
  let closedByUser = false;
  let code = intent.type !== 'create' ? String(intent.code || '').toUpperCase().trim() : null;
  let token = code ? loadToken(code, game) : null;
  let seat = null;
  let role = intent.type === 'watch' ? 'spectator' : 'player';
  let last = { view: null, chat: [], grace: null, ack: 0, code, role, you: null, people: null, swaps: [], mySwap: null, freeSeat: null, status: 'connecting' };

  const emit = (patch) => {
    last = { ...last, ...patch };
    for (const fn of listeners) fn(last);
  };

  const send = (msg) => {
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
      return true;
    }
    return false;
  };

  const handshake = () => {
    if (code && token) send({ t: 'rejoin', game, code, token });   // 역할(자리/관전)은 서버가 토큰으로 안다
    else if (intent.type === 'create') send({ t: 'create', game, name: intent.name, ...options });
    else if (intent.type === 'watch') send({ t: 'watch', game, code, name: intent.name });
    else send({ t: 'join', game, code, name: intent.name });
  };

  const connect = () => {
    if (closedByUser) return;
    emit({ status: attempt === 0 ? 'connecting' : 'reconnecting' });
    ws = new WebSocket(socketUrl());

    ws.addEventListener('open', () => {
      attempt = 0;
      emit({ status: 'online' });
      handshake();
    });

    ws.addEventListener('message', (event) => {
      let msg;
      try {
        msg = JSON.parse(event.data);
      } catch {
        return;
      }
      if (msg.t === 'joined') {
        code = msg.code;
        seat = msg.you ?? null;
        role = msg.role ?? 'player';
        token = msg.token;
        storeToken(code, token, game);
        emit({ code, role, you: seat, status: 'online' });
      } else if (msg.t === 'state') {
        emit({
          view: msg.view,
          chat: msg.chat,
          grace: msg.grace ?? null,
          ack: msg.ack ?? 0,
          code: msg.code,
          role: msg.role ?? 'player',
          you: msg.you ?? null,
          pid: msg.pid ?? null,
          people: msg.people ?? null,
          swaps: msg.swaps ?? [],
          mySwap: msg.mySwap ?? null,
          freeSeat: msg.freeSeat ?? null,
          status: 'online',
        });
      } else if (msg.t === 'error') {
        // 방이 사라졌는데 낡은 토큰으로 붙으려 한 경우엔 토큰을 버리고 처음부터
        if (msg.code === 'bad_token') token = null;
        for (const fn of errorListeners) fn(msg);
      } else {
        for (const fn of messageListeners) fn(msg);
      }
    });

    ws.addEventListener('close', () => {
      ws = null;
      if (closedByUser) return;
      const wait = RECONNECT_STEPS[Math.min(attempt, RECONNECT_STEPS.length - 1)];
      attempt++;
      emit({ status: 'reconnecting' });
      setTimeout(connect, wait);
    });

    ws.addEventListener('error', () => {
      if (ws) ws.close();
    });
  };

  connect();

  return {
    mode: 'online',
    game,
    get code() {
      return code;
    },
    get seat() {
      return seat;
    },
    get role() {
      return role;
    },

    subscribe(fn) {
      listeners.add(fn);
      fn(last);
      return () => listeners.delete(fn);
    },

    onError(fn) {
      errorListeners.add(fn);
      return () => errorListeners.delete(fn);
    },
    /** 게임별 메시지 (예: 틀린그림의 spot_result) */
    onMessage(fn) {
      messageListeners.add(fn);
      return () => messageListeners.delete(fn);
    },

    secret(value) {
      send({ t: 'secret', value });
    },
    guess(value) {
      send({ t: 'guess', value });
    },
    chat(text) {
      send({ t: 'chat', text });
    },
    rematch() {
      send({ t: 'rematch' });
    },
    surrender() {
      send({ t: 'surrender' });
    },
    /** 게임별 조작 메시지를 그대로 보낸다. 지뢰찾기의 {t:'ms', …} 가 이걸 쓴다. */
    action(msg) {
      return send(msg);
    },
    /* 관전 ↔ 자리 */
    sit() {
      send({ t: 'sit' });
    },
    stand() {
      send({ t: 'stand' });
    },
    swap(seatIndex) {
      send({ t: 'swap', seat: seatIndex });
    },
    swapAccept(pid) {
      send({ t: 'swap_accept', pid });
    },
    swapDecline(pid) {
      send({ t: 'swap_decline', pid });
    },
    leave() {
      closedByUser = true;
      send({ t: 'leave' });
      if (ws) ws.close();
      listeners.clear();
      errorListeners.clear();
      messageListeners.clear();
    },
  };
}
