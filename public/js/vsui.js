/**
 * 1:1 대전 화면의 공통 부품 — 연결 표시, 채팅, 승수 스코어보드, 관전자 목록,
 * 관전자 패널(앉기·교대 요청), 플레이어에게 들어온 교대 요청.
 * 지뢰찾기와 틀린그림찾기가 같은 요소 id 를 쓰므로 그대로 공유한다.
 *
 * ctx: { $, engine(), state(), isPlayer(), seatL(view), seatR(view), span }
 */
export function createVersusChrome(ctx) {
  const { $, span } = ctx;

  function connectionChip() {
    const chip = $('conn');
    chip.className = 'chip';
    const status = ctx.state()?.status ?? 'connecting';
    if (status === 'online') {
      chip.textContent = ctx.isPlayer() ? '온라인' : '👀 관전';
      chip.classList.add('on');
    } else if (status === 'reconnecting') {
      chip.textContent = '재연결 중…';
      chip.classList.add('off');
    } else {
      chip.textContent = '연결 중…';
    }
  }

  function renderChat(chat) {
    const log = $('chat-log');
    log.replaceChildren();
    const vs = ctx.state();
    const myPid = ctx.isPlayer() ? ctx.seatL()?.pid : vs?.pid;
    for (const line of chat) {
      const li = document.createElement('li');
      if (line.pid && line.pid === myPid) li.className = 'me';
      li.append(span('who', line.player === null ? `👀 ${line.name}` : line.name), span('text', line.text));
      log.append(li);
    }
    log.scrollTop = log.scrollHeight;
  }

  /** 배너의 스코어보드 — 이 방에서 이긴 판 수. 두 자리가 다 찼을 때만. */
  function renderScore(view) {
    const box = $('vs-score');
    const L = ctx.seatL(view);
    const R = ctx.seatR(view);
    box.hidden = !(L?.joined && R?.joined);
    if (box.hidden) return;
    $('vs-score-me').textContent = L.wins;
    $('vs-score-opp').textContent = R.wins;
    $('vs-score-me-name').textContent = L.name;
    $('vs-score-opp-name').textContent = R.name;
    box.classList.toggle('lead', L.wins > R.wins);
    box.classList.toggle('behind', L.wins < R.wins);
  }

  function renderPeople() {
    const el = $('vs-people');
    const people = ctx.state()?.people;
    el.hidden = !people;
    if (!people) return;
    const specs = people.spectators;
    const names = specs.map((s) => (s.present ? s.name : `${s.name}(끊김)`)).join(', ');
    el.textContent = specs.length ? `👀 관전 ${specs.length}명 — ${names}` : '👀 관전자 없음';
  }

  /** 관전자 조작 패널: 빈 자리에 앉기 / 교대 요청·취소 */
  function renderSpectatorBar(view) {
    const box = $('vs-spec');
    const vs = ctx.state();
    box.hidden = ctx.isPlayer();
    if (box.hidden) return;
    const actions = $('vs-spec-actions');
    actions.replaceChildren();
    const note = $('vs-spec-note');
    if (vs.freeSeat !== null) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'primary';
      b.textContent = '🪑 빈 자리에 앉기';
      b.addEventListener('click', () => ctx.engine()?.sit());
      actions.append(b);
      note.textContent = '앉으면 바로 다음 판이 시작돼요.';
    } else {
      view.seats.forEach((seat, i) => {
        if (!seat.joined) return;
        const b = document.createElement('button');
        b.type = 'button';
        const mine = vs.mySwap === i;
        b.className = mine ? 'primary' : 'secondary';
        b.textContent = mine ? `${seat.name}와 교대 요청 중 · 취소` : `🔁 ${seat.name}와 교대 요청`;
        b.addEventListener('click', () => ctx.engine()?.swap(mine ? null : i));
        actions.append(b);
      });
      note.textContent = vs.mySwap !== null
        ? '상대가 수락하면 자리를 바꿔요. 판이 진행 중이면 끝난 뒤에 바꿀 수 있어요.'
        : '자리가 다 찼어요. 플레이어에게 교대를 요청할 수 있어요.';
    }
  }

  /** 플레이어에게 들어온 교대 요청 */
  function renderSwapRequests(view) {
    const box = $('vs-swaps');
    const vs = ctx.state();
    const swaps = ctx.isPlayer() ? vs.swaps ?? [] : [];
    box.hidden = swaps.length === 0;
    box.replaceChildren();
    if (box.hidden) return;
    const busy = view.phase === 'countdown' || view.phase === 'playing';
    for (const req of swaps) {
      const row = document.createElement('div');
      row.className = 'req';
      row.append(span('lead', `🔁 ${req.name}님이 내 자리와 교대를 요청했어요`));
      const ok = document.createElement('button');
      ok.type = 'button';
      ok.className = 'primary';
      ok.textContent = '수락';
      ok.disabled = busy;
      ok.addEventListener('click', () => ctx.engine()?.swapAccept(req.pid));
      const no = document.createElement('button');
      no.type = 'button';
      no.className = 'secondary';
      no.textContent = '거절';
      no.addEventListener('click', () => ctx.engine()?.swapDecline(req.pid));
      row.append(ok, no);
      if (busy) row.append(span('muted', '판이 끝난 뒤에 수락할 수 있어요.'));
      box.append(row);
    }
  }

  /** 자리 관련 버튼(관전으로 빠지기·재대결) 표시 여부 등 공통 토글 */
  function toggleRoleUi(me) {
    document.querySelectorAll('.stand-btn').forEach((b) => { b.hidden = !me; });
    const rematch = $('btn-rematch');
    if (rematch) rematch.hidden = !me;
  }

  return { connectionChip, renderChat, renderScore, renderPeople, renderSpectatorBar, renderSwapRequests, toggleRoleUi };
}

/** 방 코드 · 초대 링크 · 나가기 · 관전으로 빠지기 · 채팅 전송 같은 공통 입력. */
export function bindVersusChrome({ $, engine, state, isPlayer, isLive, onLeave, copy, toast }) {
  $('room-code').addEventListener('click', () => state()?.code && copy(state().code, '방 코드'));
  $('btn-copy-code').addEventListener('click', () => state()?.code && copy(state().code, '방 코드'));
  $('btn-copy-link').addEventListener('click', () => {
    if (!state()?.code) return;
    copy(`${location.origin}${location.pathname}?room=${state().code}`, '초대 링크');
  });

  const leave = () => {
    if (isLive() && !confirm('지금 나가면 기권 처리됩니다. 나갈까요?')) return;
    if (isLive() && engine()) engine().surrender();
    onLeave();
  };
  $('btn-leave').addEventListener('click', leave);
  $('btn-vs-home').addEventListener('click', leave);

  document.querySelectorAll('.stand-btn').forEach((b) => b.addEventListener('click', () => {
    if (!engine() || !isPlayer()) return;
    if (isLive()) {
      if (!confirm('지금 빠지면 기권 처리됩니다. 관전으로 빠질까요?')) return;
      engine().surrender();
    }
    engine().stand();
  }));

  $('btn-rematch').addEventListener('click', () => engine()?.rematch());

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('chat-input').value.trim();
    if (!text || !engine()) return;
    engine().chat(text);
    $('chat-input').value = '';
  });
  void toast;
}
