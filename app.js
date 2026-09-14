/* Board UI: loads a screenshot, shows the tiles, handles drag-to-swap and tap-to-tag. */
(() => {
  'use strict';

  const STORAGE_KEY = 'connections-helper-board-v1';
  const COLORS = [null, 'yellow', 'green', 'blue', 'purple'];
  const DRAG_THRESHOLD = 8;
  const MAX_IMAGE_SIDE = 3000;

  const $ = (id) => document.getElementById(id);
  const loadScreen = $('load-screen');
  const boardScreen = $('board-screen');
  const board = $('board');
  const fileInput = $('file-input');
  const loadButton = $('load-button');
  const backButton = $('back-button');
  const statusBox = $('status');
  const statusText = $('status-text');
  const progressBar = $('progress-bar');
  const errorBox = $('error');

  let tiles = []; // [{ id, word, color }] in grid order
  const tileEls = new Map();
  let drag = null;
  let busy = false;

  // ---- Persistence ----

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ tiles }));
    } catch {
      // Storage unavailable (e.g. private browsing); the board still works for this session.
    }
  }

  function restore() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!Array.isArray(saved?.tiles) || !saved.tiles.length) return null;
      return saved.tiles.map((t, i) => ({
        id: String(t.id ?? `t${i}`),
        word: String(t.word ?? '?'),
        color: COLORS.includes(t.color) ? t.color : null,
      }));
    } catch {
      return null;
    }
  }

  // ---- Screens and status ----

  function showScreen(name) {
    loadScreen.hidden = name !== 'load';
    boardScreen.hidden = name !== 'board';
    document.body.classList.toggle('board-mode', name === 'board');
    backButton.hidden = busy || tiles.length === 0;
  }

  function setBusy(value) {
    busy = value;
    loadButton.classList.toggle('busy', value);
    fileInput.disabled = value;
    statusBox.hidden = !value;
    backButton.hidden = value || tiles.length === 0;
  }

  function setStatus(message, progress) {
    statusText.textContent = message;
    progressBar.style.width = `${Math.round(Math.max(0, Math.min(1, progress)) * 100)}%`;
  }

  function showError(message) {
    errorBox.textContent = message;
    errorBox.hidden = false;
  }

  // ---- Loading a screenshot ----

  async function blobToCanvas(blob) {
    const url = URL.createObjectURL(blob);
    try {
      const img = await new Promise((resolve, reject) => {
        const image = new Image();
        image.onload = () => resolve(image);
        image.onerror = () => reject(new Error("Couldn't open that image."));
        image.src = url;
      });
      const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.naturalWidth * scale);
      canvas.height = Math.round(img.naturalHeight * scale);
      canvas.getContext('2d', { willReadFrequently: true }).drawImage(img, 0, 0, canvas.width, canvas.height);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function loadImage(blob) {
    if (busy) return;
    if (!blob || !blob.type.startsWith('image/')) {
      showScreen('load');
      showError("That file isn't an image.");
      return;
    }
    errorBox.hidden = true;
    setBusy(true);
    showScreen('load');
    setStatus('Opening screenshot…', 0);
    try {
      const canvas = await blobToCanvas(blob);
      const { words } = await window.ConnectionsOCR.readPuzzle(canvas, setStatus);
      if (!words.length) {
        throw new Error("Couldn't find any puzzle words in that image. Try a screenshot that shows the whole grid.");
      }
      tiles = words.map((word, i) => ({ id: `t${i}`, word, color: null }));
      save();
      setBusy(false);
      showScreen('board');
      buildBoard();
    } catch (err) {
      console.error(err);
      setBusy(false);
      showScreen('load');
      showError(err.message || String(err));
    }
  }

  // ---- Board rendering ----

  function paintTile(tile) {
    const el = tileEls.get(tile.id);
    if (!el) return;
    if (tile.color) el.dataset.color = tile.color;
    else delete el.dataset.color;
    el.setAttribute('aria-label', tile.color ? `${tile.word}, ${tile.color}` : tile.word);
  }

  function buildBoard() {
    tileEls.clear();
    board.replaceChildren();
    for (const tile of tiles) {
      const el = document.createElement('div');
      el.className = 'tile';
      el.dataset.id = tile.id;
      const label = document.createElement('span');
      label.className = 'tile-label';
      label.textContent = tile.word;
      el.append(label);
      el.addEventListener('pointerdown', onPointerDown);
      el.addEventListener('pointermove', onPointerMove);
      el.addEventListener('pointerup', onPointerUp);
      el.addEventListener('pointercancel', onPointerCancel);
      board.append(el);
      tileEls.set(tile.id, el);
      paintTile(tile);
    }
    fitAllLabels();
  }

  // Shrinks a label's font until the word fits inside its tile.
  function fitLabel(el) {
    const label = el.firstElementChild;
    const maxWidth = el.clientWidth - 16;
    const maxHeight = el.clientHeight - 8;
    if (maxWidth <= 0) return;
    let size = Math.min(28, Math.max(10, el.clientWidth * 0.12));
    label.style.fontSize = `${size}px`;
    while (size > 8 && (label.offsetWidth > maxWidth || label.offsetHeight > maxHeight)) {
      size -= 1;
      label.style.fontSize = `${size}px`;
    }
  }

  function fitAllLabels() {
    for (const el of tileEls.values()) fitLabel(el);
  }

  // Briefly keeps a released tile above its neighbours while it animates into place.
  function settle(el) {
    el.classList.add('settling');
    setTimeout(() => el.classList.remove('settling'), 250);
  }

  function cycleColor(id) {
    const tile = tiles.find((t) => t.id === id);
    tile.color = COLORS[(COLORS.indexOf(tile.color) + 1) % COLORS.length];
    paintTile(tile);
    save();
  }

  function swapTiles(draggedEl, targetEl) {
    const first = new Map();
    for (const [id, el] of tileEls) first.set(id, el.getBoundingClientRect());

    const a = tiles.findIndex((t) => t.id === draggedEl.dataset.id);
    const b = tiles.findIndex((t) => t.id === targetEl.dataset.id);
    [tiles[a], tiles[b]] = [tiles[b], tiles[a]];
    draggedEl.classList.remove('dragging');
    board.append(...tiles.map((t) => tileEls.get(t.id)));

    // FLIP: jump each tile back to where it was, then animate to its new cell.
    for (const [id, el] of tileEls) {
      el.style.transition = 'none';
      el.style.transform = '';
      const last = el.getBoundingClientRect();
      const from = first.get(id);
      const dx = from.left - last.left;
      const dy = from.top - last.top;
      if (dx || dy) el.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    void board.offsetWidth;
    settle(draggedEl);
    for (const el of tileEls.values()) {
      el.style.transition = '';
      el.style.transform = '';
    }
    save();
  }

  function snapBack(el) {
    settle(el);
    el.classList.remove('dragging');
    el.style.transform = '';
  }

  // ---- Touch handling ----

  function setDropTarget(el) {
    if (drag.target === el) return;
    drag.target?.classList.remove('drop-target');
    drag.target = el;
    el?.classList.add('drop-target');
  }

  function onPointerDown(e) {
    if (drag || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    drag = {
      el,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      active: false,
      target: null,
      others: null,
    };
  }

  function onPointerMove(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    if (!drag.active) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      drag.active = true;
      drag.el.classList.add('dragging');
      drag.others = [...tileEls.values()]
        .filter((el) => el !== drag.el)
        .map((el) => ({ el, rect: el.getBoundingClientRect() }));
    }
    drag.el.style.transform = `translate(${dx}px, ${dy}px) scale(1.06)`;
    const hit = drag.others.find(({ rect }) =>
      e.clientX >= rect.left && e.clientX <= rect.right && e.clientY >= rect.top && e.clientY <= rect.bottom);
    setDropTarget(hit ? hit.el : null);
  }

  function onPointerUp(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { el, active, target } = drag;
    if (active) setDropTarget(null);
    drag = null;
    if (!active) cycleColor(el.dataset.id);
    else if (target) swapTiles(el, target);
    else snapBack(el);
  }

  function onPointerCancel(e) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { el, active } = drag;
    if (active) setDropTarget(null);
    drag = null;
    if (active) snapBack(el);
  }

  // ---- Wiring ----

  fileInput.addEventListener('change', () => {
    const file = fileInput.files[0];
    fileInput.value = '';
    if (file) loadImage(file);
  });

  backButton.addEventListener('click', () => {
    errorBox.hidden = true;
    showScreen('board');
    fitAllLabels();
  });

  $('new-button').addEventListener('click', () => {
    errorBox.hidden = true;
    showScreen('load');
  });

  $('clear-button').addEventListener('click', () => {
    for (const tile of tiles) {
      tile.color = null;
      paintTile(tile);
    }
    save();
  });

  document.addEventListener('paste', (e) => {
    const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    loadImage(item.getAsFile());
  });

  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    const file = [...(e.dataTransfer?.files || [])].find((f) => f.type.startsWith('image/'));
    if (file) loadImage(file);
  });

  board.addEventListener('contextmenu', (e) => e.preventDefault());
  board.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });

  let resizeFrame = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(fitAllLabels);
  });

  // ---- Start ----

  if (new URLSearchParams(location.search).has('demo')) {
    fetch('samples/example.png')
      .then((res) => {
        if (!res.ok) throw new Error("Couldn't load the demo screenshot.");
        return res.blob();
      })
      .then(loadImage)
      .catch((err) => showError(err.message));
  } else {
    const saved = restore();
    if (saved) {
      tiles = saved;
      showScreen('board');
      buildBoard();
    } else {
      showScreen('load');
    }
  }
})();
