/**
 * 화면 로직.
 * 온라인 엔진과 AI 엔진이 똑같은 모양의 상태(view)를 주기 때문에,
 * 여기서는 둘을 구분하지 않고 한 갈래로만 그린다.
 */
import { Phase, SETUP_SECONDS } from '/shared/engine.js';
import { isValidNumber, randomNumber } from '/shared/baseball.js';
import { createOnlineEngine, loadToken } from '/js/net.js';
import { createLocalEngine } from '/js/local.js';

const $ = (id) => document.getElementById(id);
const NAME_KEY = 'baseball:nickname';

let engine = null;
let unsubscribe = null;
let snapshot = null;

/* ───────── 공통 유틸 ───────── */

let toastTimer = null;
function toast(message) {
  const box = $('toast');
  box.textContent = message;
  box.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    box.hidden = true;
  }, 3000);
}

function span(cls, text) {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

function showScreen(which) {
  $('home').hidden = which !== 'home';
  $('play').hidden = which !== 'play';
  window.scrollTo(0, 0);
}

function nickname() {
  const value = $('nickname').value.trim();
  try {
    localStorage.setItem(NAME_KEY, value);
  } catch { /* 저장 못 해도 진행 */ }
  return value;
}

async function copy(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    toast(`${label}을(를) 복사했어요`);
  } catch {
    toast(`복사하지 못했어요 — ${text}`);
  }
}

/* ───────── 엔진 붙였다 떼기 ───────── */

function stopEngine({ keepUrl = false } = {}) {
  if (unsubscribe) unsubscribe();
  if (engine) engine.leave();
  unsubscribe = null;
  engine = null;
  snapshot = null;
  if (!keepUrl && location.search) history.replaceState(null, '', location.pathname);
}

function startEngine(next) {
  stopEngine();
  engine = next;
  if (engine.onError) {
    engine.onError((err) => {
      toast(err.message || '문제가 생겼어요.');
      const fatal = err.code === 'room_not_found' || err.code === 'bad_token' || err.code === 'room_full';
      if (fatal && !snapshot?.view) {
        stopEngine();
        showScreen('home');
      }
    });
  }
  unsubscribe = engine.subscribe((payload) => {
    snapshot = payload;
    render();
  });
  showScreen('play');
}

function startOnline(intent) {
  startEngine(createOnlineEngine(intent));
}

function startLocal() {
  const digits = Number($('ai-digits').value);
  startEngine(
    createLocalEngine({
      digits,
      turnSeconds: 0, // AI 연습은 제한시간 없이
      difficulty: $('ai-difficulty').value,
      name: nickname() || '나',
    }),
  );
}

/* ───────── 그리기 ───────── */

function connectionChip() {
  const chip = $('conn');
  chip.className = 'chip';
  if (!engine) return;
  if (engine.mode === 'ai') {
    chip.textContent = `AI 연습 · ${engine.aiProfile.label}`;
    return;
  }
  const status = snapshot?.status ?? 'connecting';
  if (status === 'online') {
    chip.textContent = '온라인';
    chip.classList.add('on');
  } else if (status === 'reconnecting') {
    chip.textContent = '재연결 중…';
    chip.classList.add('off');
  } else {
    chip.textContent = '연결 중…';
  }
}

function renderLog(list, guesses, digits) {
  list.replaceChildren();
  if (!guesses.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = '아직 기록이 없어요';
    list.append(li);
    return;
  }
  guesses.forEach((g, i) => {
    const li = document.createElement('li');
    if (g.timeout) li.classList.add('miss');
    if (g.strikes === digits) li.classList.add('win');
    const result = document.createElement('span');
    result.className = 'res';
    if (g.timeout) result.append(span('o', '시간 초과'));
    else if (g.out) result.append(span('o', '아웃'));
    else {
      if (g.strikes) result.append(span('s', `${g.strikes}S`));
      if (g.balls) result.append(span('b', `${g.balls}B`));
    }
    li.append(span('no', String(i + 1)), span('val', g.timeout ? '—' : g.value), result);
    list.append(li);
  });
  list.scrollTop = list.scrollHeight;
}

function renderChat(chat, you) {
  const log = $('chat-log');
  log.replaceChildren();
  for (const line of chat) {
    const li = document.createElement('li');
    if (line.player === you) li.className = 'me';
    li.append(span('who', line.name), span('text', line.text));
    log.append(li);
  }
  log.scrollTop = log.scrollHeight;
}

function resultTexts(view) {
  const name = view.opponent.name;
  if (view.winner === 'draw') {
    return ['무승부', 'draw', '같은 라운드에 둘 다 맞혔어요. 완벽한 무승부!'];
  }
  if (view.winner === 'you') {
    const detail = {
      strikes: '상대 숫자를 먼저 맞혔습니다!',
      timeout: `${name}이(가) 시간을 연속으로 넘겨 기권 처리됐어요.`,
      forfeit: `${name}이(가) 나가서 승리했습니다.`,
    };
    return ['승리 🎉', 'win', detail[view.overReason] ?? '승리했습니다.'];
  }
  const detail = {
    strikes: `${name}이(가) 내 숫자를 먼저 맞혔어요.`,
    timeout: '시간을 연속으로 넘겨 기권 처리됐어요.',
    forfeit: '기권했습니다.',
  };
  return ['패배', 'lose', detail[view.overReason] ?? '아쉽네요.'];
}

function render() {
  connectionChip();
  const view = snapshot?.view;
  const code = snapshot?.code;

  $('room-code').hidden = !code;
  if (code) {
    $('room-code').textContent = `방 ${code}`;
    // 새로고침해도 같은 방으로 돌아오도록 주소에 코드를 남긴다
    if (new URLSearchParams(location.search).get('room') !== code) {
      history.replaceState(null, '', `?room=${code}`);
    }
  }
  $('panel-chat').hidden = !(engine?.mode === 'online' && view);

  if (!view) {
    $('banner-title').textContent = '연결 중…';
    $('banner-sub').textContent = '';
    for (const id of ['panel-lobby', 'panel-setup', 'panel-board', 'panel-over']) $(id).hidden = true;
    return;
  }

  const { phase, digits } = view;
  $('panel-lobby').hidden = phase !== Phase.LOBBY;
  $('panel-setup').hidden = phase !== Phase.SETUP;
  $('panel-board').hidden = phase !== Phase.PLAYING && phase !== Phase.OVER;
  $('panel-over').hidden = phase !== Phase.OVER;

  // 배너
  const banner = $('banner');
  banner.classList.toggle('mine', phase === Phase.PLAYING && view.yourTurn);
  if (phase === Phase.LOBBY) {
    $('banner-title').textContent = '상대를 기다리는 중';
    $('banner-sub').textContent = '코드를 알려주면 바로 시작돼요';
    $('lobby-code').textContent = code ?? '····';
  } else if (phase === Phase.SETUP) {
    $('banner-title').textContent = view.me.ready ? '상대가 정하는 중…' : '비밀번호를 정하세요';
    $('banner-sub').textContent = `${view.gameNo}번째 판 · ${digits}자리`;
    $('setup-hint').textContent = `서로 다른 숫자 ${digits}개로 만드세요. 예: ${randomNumber(digits)}`;
    $('secret-input').maxLength = digits;
    $('secret-input').placeholder = '0'.repeat(digits);
    $('secret-input').disabled = view.me.ready;
    $('btn-random').disabled = view.me.ready;
    $('secret-form').querySelector('button[type=submit]').disabled = view.me.ready;
    $('setup-state').textContent = [
      view.me.ready ? '내 숫자 확정 완료' : '아직 정하지 않았어요',
      view.opponent.ready ? `${view.opponent.name} 확정 완료` : `${view.opponent.name} 준비 중`,
    ].join(' · ');
  } else if (phase === Phase.PLAYING) {
    $('banner-title').textContent = view.yourTurn ? '내 차례!' : `${view.opponent.name}의 차례`;
    const notes = [`${view.round}라운드`];
    if (view.lastChanceFor === view.you) notes.push('마지막 공격권 — 맞히면 무승부!');
    else if (view.lastChanceFor !== null) notes.push('상대에게 마지막 공격권이 넘어갔어요');
    if (!view.opponent.present) notes.push('상대 연결 끊김');
    $('banner-sub').textContent = notes.join(' · ');
  } else {
    const [badge, cls, detail] = resultTexts(view);
    $('banner-title').textContent = badge;
    $('banner-sub').textContent = '';
    $('result-badge').textContent = badge;
    $('result-badge').className = `result ${cls}`;
    $('result-detail').textContent = detail;
    $('result-reveal').textContent = view.opponent.secret
      ? `${view.opponent.name}의 숫자는 ${view.opponent.secret} 였습니다. 내 숫자는 ${view.me.secret}.`
      : '';
    $('rematch-state').textContent = view.me.rematch
      ? '재대결을 요청했어요. 상대 응답을 기다리는 중…'
      : view.opponent.rematch
        ? `${view.opponent.name}이(가) 재대결을 원해요!`
        : '';
    $('btn-rematch').disabled = view.me.rematch;
  }

  // 대전판
  if (!$('panel-board').hidden) {
    $('my-secret').textContent = view.me.secret ? `내 숫자 ${view.me.secret}` : '';
    $('opp-title').textContent = `${view.opponent.name}의 공격`;
    renderLog($('my-log'), view.me.guesses, digits);
    renderLog($('opp-log'), view.opponent.guesses, digits);

    const canGuess = phase === Phase.PLAYING && view.yourTurn;
    $('guess-form').hidden = phase !== Phase.PLAYING;
    $('guess-input').disabled = !canGuess;
    $('btn-guess').disabled = !canGuess;
    $('guess-input').maxLength = digits;
    $('guess-input').placeholder = '0'.repeat(digits);
    $('guess-hint').textContent = canGuess
      ? `서로 다른 숫자 ${digits}개를 입력하고 공격!`
      : phase === Phase.OVER
        ? ''
        : '상대가 공격하는 동안 기다려 주세요.';
  }

  if (engine?.mode === 'online') renderChat(snapshot.chat ?? [], view.you);
  updateTimer();
}

/* ───────── 타이머 ───────── */

function updateTimer() {
  const view = snapshot?.view;
  const box = $('timer');
  if (!view || !view.deadline) {
    box.hidden = true;
    return;
  }
  const total = (view.phase === Phase.SETUP ? SETUP_SECONDS : view.turnSeconds) * 1000;
  const left = Math.max(0, view.deadline - Date.now());
  box.hidden = false;
  box.classList.toggle('low', left <= 10_000);
  $('timer-text').textContent = `${Math.ceil(left / 1000)}초`;
  $('timer-fill').style.width = `${total ? Math.min(100, (left / total) * 100) : 0}%`;
}

setInterval(() => {
  if (!snapshot?.view) return;
  updateTimer();
  // 상대가 끊겼을 때 남은 복귀 시간을 배너에 흘려보낸다
  if (snapshot.grace && snapshot.view.phase !== Phase.OVER) {
    const left = Math.max(0, Math.ceil((snapshot.grace - Date.now()) / 1000));
    $('banner-sub').textContent = `상대 연결 끊김 — ${left}초 안에 돌아오지 않으면 기권 처리`;
  }
}, 250);

/* ───────── 입력 처리 ───────── */

function readNumber(input, digits) {
  const value = input.value.replace(/\D/g, '');
  if (value.length !== digits) {
    toast(`${digits}자리로 입력해 주세요`);
    return null;
  }
  if (!isValidNumber(value, digits)) {
    toast('숫자가 겹치지 않게 입력해 주세요');
    return null;
  }
  return value;
}

$('btn-create').addEventListener('click', () => {
  startOnline({
    type: 'create',
    name: nickname(),
    digits: Number($('create-digits').value),
    turnSeconds: Number($('create-time').value),
  });
});

$('btn-join').addEventListener('click', () => {
  const code = $('join-code').value.trim().toUpperCase();
  if (code.length !== 4) {
    toast('방 코드는 4글자예요');
    return;
  }
  startOnline({ type: 'join', name: nickname(), code });
});

$('join-code').addEventListener('input', (e) => {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
});

$('btn-ai').addEventListener('click', startLocal);

$('secret-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const digits = snapshot?.view?.digits;
  if (!digits) return;
  const value = readNumber($('secret-input'), digits);
  if (!value) return;
  engine.secret(value);
  $('secret-input').value = value;
});

$('btn-random').addEventListener('click', () => {
  const digits = snapshot?.view?.digits;
  if (digits) $('secret-input').value = randomNumber(digits);
});

$('guess-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const digits = snapshot?.view?.digits;
  if (!digits) return;
  const value = readNumber($('guess-input'), digits);
  if (!value) return;
  const out = engine.guess(value);
  if (out && out.ok === false) {
    toast(out.error === 'duplicate_guess' ? '이미 해 본 숫자예요' : '지금은 공격할 수 없어요');
    return;
  }
  $('guess-input').value = '';
  $('guess-input').focus();
});

$('chat-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('chat-input').value.trim();
  if (!text) return;
  engine.chat(text);
  $('chat-input').value = '';
});

$('btn-rematch').addEventListener('click', () => engine.rematch());

$('btn-home').addEventListener('click', () => {
  stopEngine();
  showScreen('home');
});

$('btn-leave').addEventListener('click', () => {
  const phase = snapshot?.view?.phase;
  const live = phase === Phase.SETUP || phase === Phase.PLAYING;
  if (live && !confirm('지금 나가면 기권 처리됩니다. 나갈까요?')) return;
  if (live && engine) engine.surrender();
  stopEngine();
  showScreen('home');
});

$('room-code').addEventListener('click', () => snapshot?.code && copy(snapshot.code, '방 코드'));
$('btn-copy-code').addEventListener('click', () => snapshot?.code && copy(snapshot.code, '방 코드'));
$('btn-copy-link').addEventListener('click', () => {
  if (!snapshot?.code) return;
  copy(`${location.origin}${location.pathname}?room=${snapshot.code}`, '초대 링크');
});

for (const id of ['secret-input', 'guess-input']) {
  $(id).addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');
  });
}

/* ───────── 시작 ───────── */

try {
  $('nickname').value = localStorage.getItem(NAME_KEY) ?? '';
} catch { /* 무시 */ }

const roomParam = new URLSearchParams(location.search).get('room');
if (roomParam) {
  const code = roomParam.toUpperCase().slice(0, 4);
  $('join-code').value = code;
  if (loadToken(code)) {
    // 새로고침 전에 있던 방 — 토큰이 있으면 그대로 복귀
    startOnline({ type: 'join', name: nickname(), code });
  } else {
    toast(`방 ${code} — 닉네임을 넣고 참가하기를 누르세요`);
    $('nickname').focus();
  }
}

window.addEventListener('beforeunload', () => {
  if (engine?.mode === 'online') return; // 온라인은 재접속 유예가 있으니 그대로 둔다
  if (engine) engine.leave();
});
