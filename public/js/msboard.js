/**
 * 지뢰판 하나를 그리고 입력을 받는다. 규칙은 모른다 — 어느 칸을 어떻게 눌렀는지만 알려준다.
 * 혼자 하기(내 판)와 1:1 대전(내 판 + 실시간 상대 판)이 같이 쓴다.
 *
 * handlers:
 *   onPrimary(i)    왼쪽 클릭 · 탭 · Enter/Space
 *   onSecondary(i)  오른쪽 클릭 · 길게 누르기 · F 키
 *   onChord(i)      가운데 클릭
 *   onPress(bool)   누르는 중인지 (얼굴 표정용)
 * handlers 가 없으면 보기 전용(상대 판)이다.
 */
import * as M from '/shared/minesweeper.js';

const LONG_PRESS_MS = 350;   // 모바일에서 이만큼 누르고 있으면 깃발

export function createBoard(root, handlers = {}) {
  const interactive = typeof handlers.onPrimary === 'function';
  let game = null;
  let cells = [];
  let painted = [];   // 마지막으로 그린 모습 — 바뀐 칸만 다시 칠하려고
  let rows = 0;
  let cols = 0;
  let focusIndex = 0;
  let cellSize = 0;

  root.classList.toggle('readonly', !interactive);
  root.setAttribute('role', 'grid');

  function build() {
    rows = game.rows;
    cols = game.cols;
    root.replaceChildren();
    root.style.setProperty('--cols', cols);
    cells = [];
    painted = [];
    focusIndex = 0;
    const frag = document.createDocumentFragment();
    for (let i = 0; i < rows * cols; i++) {
      const el = document.createElement(interactive ? 'button' : 'div');
      if (interactive) {
        el.type = 'button';
        el.tabIndex = i === 0 ? 0 : -1;   // roving tabindex — Tab 은 한 번만 멈춘다
      }
      el.className = 'cell';
      el.dataset.i = i;
      el.setAttribute('role', 'gridcell');
      frag.appendChild(el);
      cells.push(el);
      painted.push('');
    }
    root.appendChild(frag);
  }

  function paint(el, v, i) {
    const r = Math.floor(i / cols) + 1;
    const c = (i % cols) + 1;
    let cls = 'cell';
    let text = '';
    let label;
    if (v.exploded) {
      cls += ' mine boom';
      text = '💥';
      label = '터진 지뢰';
    } else if (v.mine) {
      cls += ' mine';
      text = '💣';
      label = '지뢰';
    } else if (v.wrongFlag) {
      cls += ' wrong';
      text = '🚩';
      label = '잘못 꽂은 깃발';
    } else if (v.open) {
      cls += ' open';
      if (v.count) {
        cls += ` n n${v.count}`;
        text = String(v.count);
        label = `주변 지뢰 ${v.count}개`;
      } else {
        label = '빈 칸';
      }
    } else if (v.mark === M.Mark.FLAG) {
      cls += ' flag';
      text = '🚩';
      label = '깃발';
    } else if (v.mark === M.Mark.QUESTION) {
      cls += ' q';
      text = '?';
      label = '물음표';
    } else {
      label = '닫힘';
    }
    el.className = cls;
    el.textContent = text;
    el.setAttribute('aria-label', `${r}행 ${c}열 ${label}`);
  }

  function render() {
    if (!game) return;
    if (rows !== game.rows || cols !== game.cols || cells.length === 0) build();
    root.classList.toggle('over', M.isOver(game));
    for (let i = 0; i < cells.length; i++) {
      const v = M.cellView(game, i);
      const key = `${v.open ? 1 : 0}${v.count}${v.mark}${v.mine ? 1 : 0}${v.exploded ? 1 : 0}${v.wrongFlag ? 1 : 0}`;
      if (key === painted[i]) continue;
      painted[i] = key;
      paint(cells[i], v, i);
    }
  }

  /**
   * 주어진 너비·높이 안에 판이 들어가도록 칸 크기를 정한다.
   * 칸이 작아지면 틈도 1px 로 줄인다. 돌려주는 값은 정해진 칸 크기(px).
   */
  function fit({ width, height = Infinity, minCell = 12, maxCell = 36 }) {
    if (!game) return 0;
    const gapFor = (c) => (c < 18 ? 1 : 2);
    let cell = maxCell;
    for (let pass = 0; pass < 2; pass++) {   // 틈이 칸 크기에 따라 달라지므로 두 번
      const gap = gapFor(cell);
      const byW = Math.floor((width - (cols - 1) * gap) / cols);
      const byH = Number.isFinite(height) ? Math.floor((height - (rows - 1) * gap) / rows) : Infinity;
      cell = Math.max(minCell, Math.min(maxCell, byW, byH));
    }
    root.style.setProperty('--cell', `${cell}px`);
    root.style.setProperty('--gap', `${gapFor(cell)}px`);
    cellSize = cell;
    return cell;
  }

  function cellIndexOf(ev) {
    const el = ev.target.closest?.('.cell');
    return el ? Number(el.dataset.i) : -1;
  }

  function moveFocus(i) {
    if (!game || !M.inBoard(game, i)) return;
    cells[focusIndex].tabIndex = -1;
    focusIndex = i;
    cells[i].tabIndex = 0;
    cells[i].focus({ preventScroll: false });
  }

  function bindInput() {
    let pressTimer = null;
    let pressStart = null;
    let longPressed = false;      // 이번 터치에서 길게 눌러 깃발을 꽂았나
    let suppressUntil = 0;        // 그 뒤 따라오는 click 을 이 시각까지 무시
    let lastPointerType = 'mouse';

    const cancelPress = () => {
      clearTimeout(pressTimer);
      pressTimer = null;
      pressStart = null;
    };

    // 손을 뗀 뒤에만 짧게 막는다. 브라우저가 click 을 아예 안 보내는 경우(안드로이드 크롬)에도
    // 다음 탭이 삼켜지지 않도록 플래그 대신 시간창을 쓴다.
    const releasePress = () => {
      cancelPress();
      if (longPressed) {
        longPressed = false;
        suppressUntil = performance.now() + 400;
      }
    };

    root.addEventListener('pointerdown', (ev) => {
      lastPointerType = ev.pointerType;
      const i = cellIndexOf(ev);
      if (i < 0 || !game || M.isOver(game)) return;
      if (ev.button === 0 && !game.open[i]) handlers.onPress?.(true);
      if (ev.pointerType !== 'touch') return;
      cancelPress();
      longPressed = false;
      pressStart = { x: ev.clientX, y: ev.clientY };
      pressTimer = setTimeout(() => {
        pressTimer = null;
        longPressed = true;
        handlers.onSecondary?.(i);
      }, LONG_PRESS_MS);
    });

    root.addEventListener('pointermove', (ev) => {
      if (!pressStart) return;
      if (Math.hypot(ev.clientX - pressStart.x, ev.clientY - pressStart.y) > 10) cancelPress();
    });

    for (const type of ['pointerup', 'pointercancel', 'pointerleave']) {
      root.addEventListener(type, releasePress);
    }
    window.addEventListener('pointerup', () => handlers.onPress?.(false));

    root.addEventListener('click', (ev) => {
      const i = cellIndexOf(ev);
      if (i < 0) return;
      if (performance.now() < suppressUntil) {
        suppressUntil = 0;
        return;
      }
      moveFocus(i);
      handlers.onPrimary(i);
    });

    root.addEventListener('contextmenu', (ev) => {
      ev.preventDefault();
      const i = cellIndexOf(ev);
      if (i < 0 || lastPointerType === 'touch') return;   // 터치는 길게 누르기로 처리했다
      moveFocus(i);
      handlers.onSecondary?.(i);
    });

    root.addEventListener('auxclick', (ev) => {
      if (ev.button !== 1) return;   // 가운데 버튼 = 주변 열기
      ev.preventDefault();
      const i = cellIndexOf(ev);
      if (i >= 0) handlers.onChord?.(i);
    });

    root.addEventListener('focusin', (ev) => {
      const i = cellIndexOf(ev);
      if (i >= 0 && i !== focusIndex) {
        cells[focusIndex].tabIndex = -1;
        focusIndex = i;
        cells[i].tabIndex = 0;
      }
    });

    root.addEventListener('keydown', (ev) => {
      if (!game) return;
      const r = Math.floor(focusIndex / cols);
      const c = focusIndex % cols;
      let next = null;
      switch (ev.key) {
        case 'ArrowLeft': next = c > 0 ? focusIndex - 1 : null; break;
        case 'ArrowRight': next = c < cols - 1 ? focusIndex + 1 : null; break;
        case 'ArrowUp': next = r > 0 ? focusIndex - cols : null; break;
        case 'ArrowDown': next = r < rows - 1 ? focusIndex + cols : null; break;
        case 'Home': next = focusIndex - c; break;
        case 'End': next = focusIndex - c + cols - 1; break;
        case 'f': case 'F':
          ev.preventDefault();
          handlers.onSecondary?.(focusIndex);
          return;
        default: return;
      }
      ev.preventDefault();
      if (next !== null) moveFocus(next);
    });
  }

  if (interactive) bindInput();

  return {
    /** 그릴 게임(또는 fromSnapshot 으로 되살린 상대 판)을 바꾼다. 크기가 바뀌면 칸을 다시 만든다. */
    setGame(next) {
      game = next;
      render();
    },
    render,
    fit,
    get game() {
      return game;
    },
    get cellSize() {
      return cellSize;
    },
    get rows() {
      return rows;
    },
    get cols() {
      return cols;
    },
  };
}
