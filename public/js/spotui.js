/**
 * 틀린그림찾기 화면.
 * 두 그림을 SVG 로 그리고, 누른 곳을 엔진에 넘기고, 찾은 곳·힌트·정답을 표시한다.
 * 배너·타이머·채팅·결과 버튼은 app.js 가 공통으로 다루고, 여기서는 그 안의 글자만 채운다.
 */
import { SpotPhase } from '/shared/spotengine.js';
import { renderScene, SCENE_W, SCENE_H } from '/shared/spotdiff.js';

const MISS_SHOW_MS = 700;
const BEST_KEY = (level) => `spot:best:${level}`;

export function createSpotUI({ $, toast, getEngine }) {
  let view = null;
  let drawnPuzzle = null; // 지금 그려 둔 그림의 id — 같은 그림이면 다시 그리지 않는다
  let recordedGame = null;
  let bestNote = '';

  const pics = { left: $('spot-left'), right: $('spot-right') };

  function loadBest(level) {
    try {
      const v = Number(localStorage.getItem(BEST_KEY(level)));
      return v > 0 ? v : null;
    } catch {
      return null;
    }
  }

  function saveBest(level, ms) {
    try {
      localStorage.setItem(BEST_KEY(level), String(ms));
    } catch { /* 저장 못 해도 진행 */ }
  }

  /* ───── 누르기 ───── */

  function scenePoint(svg, event) {
    const pt = svg.createSVGPoint();
    pt.x = event.clientX;
    pt.y = event.clientY;
    const p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 };
  }

  for (const svg of Object.values(pics)) {
    svg.addEventListener('pointerdown', (e) => {
      if (!view || view.phase !== SpotPhase.PLAYING) return;
      if (e.button !== undefined && e.button !== 0) return;
      e.preventDefault();
      if (Date.now() < view.me.lockUntil) {
        toast('잘못 눌렀어요 — 잠시만 기다리세요');
        return;
      }
      const { x, y } = scenePoint(svg, e);
      if (x < 0 || y < 0 || x > SCENE_W || y > SCENE_H) return;
      const out = getEngine()?.tap(x, y);
      if (out && out.ok === false && out.error === 'locked') toast('잘못 눌렀어요 — 잠시만 기다리세요');
    });
  }

  $('btn-hint').addEventListener('click', () => {
    const out = getEngine()?.hint();
    if (out && out.ok === false) {
      if (out.error === 'hint_active') toast('힌트를 보여주는 중이에요');
      else if (out.error === 'not_playing') toast('지금은 힌트를 쓸 수 없어요');
    }
  });

  /* ───── 그리기 ───── */

  function circle(x, y, r, cls) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    el.setAttribute('cx', x);
    el.setAttribute('cy', y);
    el.setAttribute('r', r);
    el.setAttribute('class', cls);
    return el;
  }

  function cross(x, y, cls) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    el.setAttribute('d', `M${x - 8},${y - 8} L${x + 8},${y + 8} M${x + 8},${y - 8} L${x - 8},${y + 8}`);
    el.setAttribute('class', cls);
    return el;
  }

  function drawScene() {
    const puzzle = view.puzzle;
    if (!puzzle) return;
    if (drawnPuzzle === puzzle.id) return;
    drawnPuzzle = puzzle.id;
    // 마크업은 숫자와 팔레트 색만으로 만들어지므로 innerHTML 로 넣어도 안전하다
    pics.left.querySelector('.scene').innerHTML = renderScene(puzzle.bg, puzzle.left, 'l');
    pics.right.querySelector('.scene').innerHTML = renderScene(puzzle.bg, puzzle.right, 'r');
  }

  function drawMarks() {
    const now = Date.now();
    for (const svg of Object.values(pics)) {
      const g = svg.querySelector('.marks');
      g.replaceChildren();
      for (const f of view.found) g.append(circle(f.x, f.y, f.r, `mark ${f.by === 'you' ? 'mine' : 'theirs'}`));
      if (view.answers) {
        for (const a of view.answers) if (!a.found) g.append(circle(a.x, a.y, a.r, 'mark missed'));
      }
      if (view.hint && now < view.hint.until) g.append(circle(view.hint.x, view.hint.y, view.hint.r, 'mark hint'));
      const miss = view.me.lastMiss;
      if (miss && now - miss.at < MISS_SHOW_MS) g.append(cross(miss.x, miss.y, 'mark miss'));
    }
  }

  function drawScore() {
    const total = view.total;
    const opp = view.opponent;
    $('spot-me-name').textContent = view.me.name;
    $('spot-me-count').textContent = view.me.found;
    $('spot-opp').hidden = !opp;
    if (opp) {
      $('spot-opp-name').textContent = opp.name;
      $('spot-opp-count').textContent = opp.found;
    }
    const pips = $('spot-pips');
    pips.replaceChildren();
    const order = [...view.found].sort((a, b) => a.at - b.at);
    for (let i = 0; i < total; i++) {
      const dot = document.createElement('i');
      const f = order[i];
      if (f) dot.className = f.by === 'you' ? 'mine' : 'theirs';
      pips.append(dot);
    }
  }

  /** 시간이 흐르며 바뀌는 것들 — 카운트다운, 잠금, 힌트·오답 표시. app.js 가 주기적으로 부른다. */
  function tick() {
    if (!view) return;
    const now = Date.now();
    const stage = $('spot-stage');
    const counting = view.phase === SpotPhase.COUNTDOWN;
    stage.classList.toggle('waiting', counting);
    $('spot-countdown').hidden = !counting;
    if (counting) $('spot-countdown').textContent = String(Math.max(1, Math.ceil((view.deadline - now) / 1000)));
    stage.classList.toggle('locked', view.phase === SpotPhase.PLAYING && now < view.me.lockUntil);
    const transient = (view.hint && now < view.hint.until + 100) || (view.me.lastMiss && now - view.me.lastMiss.at < MISS_SHOW_MS + 100);
    if (transient) drawMarks();
  }

  function resultTexts() {
    const total = view.total;
    if (view.solo) {
      const ms = view.endedAt - view.startedAt;
      if (view.overReason === 'cleared') {
        return ['성공 🎉', 'win', `${total}개를 ${(ms / 1000).toFixed(1)}초 만에 모두 찾았어요.`, bestNote];
      }
      if (view.overReason === 'forfeit') return ['그만두기', 'draw', `${total}개 중 ${view.me.found}개를 찾았어요.`, ''];
      return ['시간 초과', 'lose', `${total}개 중 ${view.me.found}개를 찾았어요.`, '못 찾은 곳은 점선으로 표시했어요.'];
    }
    const name = view.opponent.name;
    const score = `${view.me.found} : ${view.opponent.found}`;
    if (view.winner === 'draw') return ['무승부', 'draw', `${score} — 시간이 끝났을 때 똑같이 찾았어요.`, ''];
    if (view.winner === 'you') {
      const detail = {
        found: `${score} — 더 많이 찾았어요!`,
        time: `${score} — 시간이 끝났을 때 앞서 있었어요.`,
        forfeit: `${name}이(가) 나가서 승리했습니다.`,
      };
      return ['승리 🎉', 'win', detail[view.overReason] ?? '승리했습니다.', ''];
    }
    const detail = {
      found: `${score} — ${name}이(가) 더 많이 찾았어요.`,
      time: `${score} — 시간이 끝났을 때 뒤져 있었어요.`,
      forfeit: '기권했습니다.',
    };
    return ['패배', 'lose', detail[view.overReason] ?? '아쉽네요.', ''];
  }

  function recordBest() {
    if (!view.solo || view.overReason !== 'cleared' || recordedGame === view.puzzle.id) return;
    recordedGame = view.puzzle.id;
    const ms = view.endedAt - view.startedAt;
    const best = loadBest(view.level);
    if (!best || ms < best) {
      saveBest(view.level, ms);
      bestNote = best ? `새 기록! (이전 최고 ${(best / 1000).toFixed(1)}초)` : '첫 기록이에요!';
    } else {
      bestNote = `최고 기록 ${(best / 1000).toFixed(1)}초`;
    }
  }

  /**
   * @returns {{title:string, sub:string}} 배너에 쓸 글자
   */
  function render(nextView, code) {
    view = nextView;
    const { phase } = view;
    $('panel-spot').hidden = phase === SpotPhase.LOBBY;
    $('btn-hint').hidden = !view.solo;
    $('btn-hint').disabled = phase !== SpotPhase.PLAYING;

    let title = '';
    let sub = '';
    const remaining = view.total - view.found.length;

    if (phase === SpotPhase.LOBBY) {
      title = '상대를 기다리는 중';
      sub = '코드를 알려주면 바로 시작돼요';
      $('lobby-code').textContent = code ?? '····';
    } else if (phase === SpotPhase.COUNTDOWN) {
      title = '곧 시작!';
      sub = `${view.gameNo}번째 판 · ${view.levelLabel} · 틀린 곳 ${view.total}개 · ${view.seconds}초`;
    } else if (phase === SpotPhase.PLAYING) {
      title = view.solo ? '틀린 곳을 찾으세요' : '먼저 찾는 사람이 임자!';
      const notes = [`남은 곳 ${remaining}개`];
      if (view.opponent && !view.opponent.present) notes.push('상대 연결 끊김');
      sub = notes.join(' · ');
    } else {
      recordBest();
      const [badge, cls, detail, note] = resultTexts();
      title = badge;
      $('result-badge').textContent = badge;
      $('result-badge').className = `result ${cls}`;
      $('result-detail').textContent = detail;
      $('result-reveal').textContent = note;
      $('btn-rematch').textContent = view.solo ? '새 그림' : '재대결';
      $('btn-rematch').disabled = view.me.rematch;
      $('rematch-state').textContent = view.solo
        ? ''
        : view.me.rematch
          ? '재대결을 요청했어요. 상대 응답을 기다리는 중…'
          : view.opponent.rematch
            ? `${view.opponent.name}이(가) 재대결을 원해요!`
            : '';
    }

    if (phase !== SpotPhase.LOBBY) {
      drawScene();
      drawMarks();
      drawScore();
      $('spot-note').textContent = view.solo
        ? phase === SpotPhase.PLAYING
          ? '어느 쪽 그림을 눌러도 돼요. 틀린 곳을 누르면 1.5초 동안 못 눌러요.'
          : ''
        : phase === SpotPhase.PLAYING
          ? '초록은 내가, 분홍은 상대가 찾은 곳. 틀린 곳을 누르면 1.5초 동안 못 눌러요.'
          : '';
    }
    tick();
    return { title, sub };
  }

  function reset() {
    view = null;
    drawnPuzzle = null;
    recordedGame = null;
    bestNote = '';
    $('panel-spot').hidden = true;
  }

  return { render, tick, reset };
}
