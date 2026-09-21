/**
 * 온라인 대전 엔진 — 서버와의 WebSocket 연결을 감싼다.
 * 연결이 끊기면 자동으로 다시 붙고, 저장해 둔 토큰으로 원래 자리에 복귀한다.
 */
const RECONNECT_STEPS = [500, 1000, 2000, 4000, 8000];

function socketUrl() {
  const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${scheme}//${location.host}/ws`;
}

function storeToken(code, token) {
  try {
    sessionStorage.setItem(`baseball:${code}`, token);
  } catch { /* 시크릿 모드 등 — 없어도 게임은 돌아간다 */ }
}

export function loadToken(code) {
  try {
    return sessionStorage.getItem(`baseball:${code}`);
  } catch {
    return null;
  }
}

/**
 * @param {{type:'create'|'join', name:string, code?:string, digits?:number, turnSeconds?:number}} intent
 */
export function createOnlineEngine(intent) {
  const listeners = new Set();
  const errorListeners = new Set();
  let ws = null;
  let attempt = 0;
  let closedByUser = false;
  let code = intent.type === 'join' ? String(intent.code || '').toUpperCase().trim() : null;
  let token = code ? loadToken(code) : null;
  let seat = null;
  let last = { view: null, chat: [], grace: null, code, status: 'connecting' };

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
    if (code && token) send({ t: 'rejoin', code, token });
    else if (intent.type === 'create') send({ t: 'create', name: intent.name, digits: intent.digits, turnSeconds: intent.turnSeconds });
    else send({ t: 'join', code, name: intent.name });
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
        seat = msg.you;
        token = msg.token;
        storeToken(code, token);
        emit({ code, status: 'online' });
      } else if (msg.t === 'state') {
        emit({ view: msg.view, chat: msg.chat, grace: msg.grace, code: msg.code, status: 'online' });
      } else if (msg.t === 'error') {
        // 방이 사라졌는데 낡은 토큰으로 붙으려 한 경우엔 토큰을 버리고 처음부터
        if (msg.code === 'bad_token') token = null;
        for (const fn of errorListeners) fn(msg);
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
    get code() {
      return code;
    },
    get seat() {
      return seat;
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
    leave() {
      closedByUser = true;
      send({ t: 'leave' });
      if (ws) ws.close();
      listeners.clear();
      errorListeners.clear();
    },
  };
}
