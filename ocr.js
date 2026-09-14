/* Finds the Connections tile grid in a screenshot and reads each tile's word with Tesseract.js. */
(() => {
  'use strict';

  const LOAD_ERROR = "The text reader couldn't load. Check your internet connection and try again.";
  const WORD_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 '-&.!";
  const COLOR_TOLERANCE = 14;

  let workerPromise = null;
  let logHandler = null;

  function getWorker() {
    if (!window.Tesseract) return Promise.reject(new Error(LOAD_ERROR));
    if (!workerPromise) {
      workerPromise = Tesseract.createWorker('eng', 1, {
        logger: (m) => logHandler && logHandler(m),
      }).catch((err) => {
        console.error(err);
        workerPromise = null;
        throw new Error(LOAD_ERROR);
      });
    }
    return workerPromise;
  }

  // ---- Grid detection ----

  // Average colors of the most common color buckets; one of them should be the tile color.
  function colorCandidates(data, pixelCount) {
    const counts = new Uint32Array(4096);
    const sums = new Float64Array(4096 * 3);
    for (let p = 0, i = 0; p < pixelCount; p++, i += 4) {
      const key = ((data[i] >> 4) << 8) | ((data[i + 1] >> 4) << 4) | (data[i + 2] >> 4);
      counts[key]++;
      sums[key * 3] += data[i];
      sums[key * 3 + 1] += data[i + 1];
      sums[key * 3 + 2] += data[i + 2];
    }
    const keys = [];
    for (let k = 0; k < 4096; k++) if (counts[k] > pixelCount * 0.02) keys.push(k);
    return keys
      .sort((a, b) => counts[b] - counts[a])
      .slice(0, 5)
      .map((k) => [sums[k * 3] / counts[k], sums[k * 3 + 1] / counts[k], sums[k * 3 + 2] / counts[k]]);
  }

  function buildMask(data, width, height, [r, g, b]) {
    const mask = new Uint8Array(width * height);
    for (let p = 0, i = 0; p < mask.length; p++, i += 4) {
      mask[p] = Math.abs(data[i] - r) <= COLOR_TOLERANCE
        && Math.abs(data[i + 1] - g) <= COLOR_TOLERANCE
        && Math.abs(data[i + 2] - b) <= COLOR_TOLERANCE ? 1 : 0;
    }
    return mask;
  }

  // [start, end) ranges where isOn(i) holds, bridging gaps of up to maxGap.
  function findRuns(length, isOn, maxGap, minLength) {
    const runs = [];
    let start = -1;
    let lastOn = -1;
    for (let i = 0; i < length; i++) {
      if (!isOn(i)) continue;
      if (start === -1) {
        start = i;
      } else if (i - lastOn - 1 > maxGap) {
        runs.push([start, lastOn + 1]);
        start = i;
      }
      lastOn = i;
    }
    if (start !== -1) runs.push([start, lastOn + 1]);
    return runs.filter(([s, e]) => e - s >= minLength);
  }

  function gridFromMask(mask, width, height) {
    const minRun = Math.max(8, Math.round(Math.min(width, height) * 0.02));

    const rowCounts = new Uint32Array(height);
    for (let y = 0; y < height; y++) {
      let count = 0;
      for (let x = 0, off = y * width; x < width; x++) count += mask[off + x];
      rowCounts[y] = count;
    }
    const bands = findRuns(height, (y) => rowCounts[y] > width * 0.15, 2, minRun);

    // A tile row is a band that splits into 4 similar-sized, closely spaced tiles.
    // Solved groups (one full-width bar) and other page elements fail this test.
    const rows = [];
    for (const [y0, y1] of bands) {
      const bandHeight = y1 - y0;
      const colCounts = new Uint32Array(width);
      for (let y = y0; y < y1; y++) {
        for (let x = 0, off = y * width; x < width; x++) colCounts[x] += mask[off + x];
      }
      const cols = findRuns(width, (x) => colCounts[x] > bandHeight * 0.5, 2, minRun);
      if (cols.length !== 4) continue;
      const widths = cols.map(([s, e]) => e - s);
      const maxWidth = Math.max(...widths);
      if (Math.min(...widths) < maxWidth * 0.75) continue;
      const ratio = bandHeight / maxWidth;
      if (ratio < 0.25 || ratio > 1.2) continue;
      if (cols.some((c, i) => i > 0 && c[0] - cols[i - 1][1] > maxWidth * 0.5)) continue;
      rows.push({ y0, y1, cols });
    }

    // Keep the largest set of rows that line up with each other.
    const tolerance = width * 0.02;
    let best = [];
    for (const ref of rows) {
      const refHeight = ref.y1 - ref.y0;
      const aligned = rows.filter((r) =>
        Math.abs(r.y1 - r.y0 - refHeight) <= refHeight * 0.25
        && r.cols.every((c, i) =>
          Math.abs(c[0] - ref.cols[i][0]) <= tolerance && Math.abs(c[1] - ref.cols[i][1]) <= tolerance));
      if (aligned.length > best.length) best = aligned;
    }

    return best.slice(0, 4).flatMap((r) =>
      r.cols.map(([x0, x1]) => ({ x: x0, y: r.y0, width: x1 - x0, height: r.y1 - r.y0 })));
  }

  function findTileRects(canvas) {
    const { width, height } = canvas;
    const { data } = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height);
    let best = [];
    for (const color of colorCandidates(data, width * height)) {
      const rects = gridFromMask(buildMask(data, width, height, color), width, height);
      if (rects.length > best.length) best = rects;
    }
    return best;
  }

  // ---- Tile preprocessing ----

  function otsuThreshold(hist, total) {
    let sum = 0;
    for (let i = 0; i < 256; i++) sum += i * hist[i];
    let sumBack = 0;
    let weightBack = 0;
    let bestVariance = 0;
    let threshold = 127;
    for (let t = 0; t < 256; t++) {
      weightBack += hist[t];
      if (!weightBack) continue;
      const weightFore = total - weightBack;
      if (!weightFore) break;
      sumBack += t * hist[t];
      const meanBack = sumBack / weightBack;
      const meanFore = (sum - sumBack) / weightFore;
      const variance = weightBack * weightFore * (meanBack - meanFore) ** 2;
      if (variance > bestVariance) {
        bestVariance = variance;
        threshold = t;
      }
    }
    return threshold;
  }

  // Converts a region to black text on white, inverting if the text is lighter than the tile.
  function binarize(ctx, x, y, w, h) {
    const image = ctx.getImageData(x, y, w, h);
    const d = image.data;
    const gray = new Uint8Array(w * h);
    const hist = new Uint32Array(256);
    for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
      gray[p] = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      hist[gray[p]]++;
    }
    const threshold = otsuThreshold(hist, gray.length);
    let dark = 0;
    for (let p = 0; p < gray.length; p++) if (gray[p] <= threshold) dark++;
    const invert = dark > gray.length / 2;
    for (let p = 0, i = 0; p < gray.length; p++, i += 4) {
      const ink = invert ? gray[p] > threshold : gray[p] <= threshold;
      d[i] = d[i + 1] = d[i + 2] = ink ? 0 : 255;
      d[i + 3] = 255;
    }
    ctx.putImageData(image, x, y);
  }

  function tileImage(source, rect) {
    const insetX = rect.width * 0.05;
    const insetY = rect.height * 0.12;
    const sw = rect.width - 2 * insetX;
    const sh = rect.height - 2 * insetY;
    const scale = Math.min(4, Math.max(0.5, 180 / rect.height));
    const w = Math.round(sw * scale);
    const h = Math.round(sh * scale);
    const pad = 20;

    const out = document.createElement('canvas');
    out.width = w + 2 * pad;
    out.height = h + 2 * pad;
    const ctx = out.getContext('2d', { willReadFrequently: true });
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, out.width, out.height);
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, rect.x + insetX, rect.y + insetY, sw, sh, pad, pad, w, h);
    binarize(ctx, pad, pad, w, h);
    return out;
  }

  // ---- Reading ----

  function cleanWord(text) {
    return text.toUpperCase().replace(/\s+/g, ' ').trim() || '?';
  }

  function collectWords(data) {
    if (Array.isArray(data.words)) return data.words;
    return (data.blocks || []).flatMap((b) => b.paragraphs.flatMap((p) => p.lines.flatMap((l) => l.words)));
  }

  // Fallback when no tile grid is found: read everything and keep uppercase words in reading order.
  async function readWholeImage(worker, canvas, onProgress) {
    onProgress('Reading the whole screenshot…', 0.3);
    await worker.setParameters({
      tessedit_pageseg_mode: '11',
      tessedit_char_whitelist: '',
      preserve_interword_spaces: '0',
    });
    const { data } = await worker.recognize(canvas, {}, { blocks: true });
    const found = collectWords(data)
      .filter((w) => w.confidence >= 60 && /^[A-Z0-9][A-Z0-9'&.!-]+$/.test(w.text))
      .sort((a, b) => a.bbox.y0 - b.bbox.y0);

    const rows = [];
    for (const word of found) {
      const centerY = (word.bbox.y0 + word.bbox.y1) / 2;
      const lineHeight = word.bbox.y1 - word.bbox.y0;
      const row = rows.find((r) => Math.abs(r.centerY - centerY) < lineHeight * 0.6);
      if (row) row.words.push(word);
      else rows.push({ centerY, words: [word] });
    }
    const words = rows
      .flatMap((r) => r.words.sort((a, b) => a.bbox.x0 - b.bbox.x0).map((w) => w.text))
      .slice(0, 16);
    onProgress('Done', 1);
    return { words, rects: [] };
  }

  async function readPuzzle(canvas, onProgress = () => {}) {
    onProgress('Loading the text reader…', 0);
    logHandler = (m) => {
      if (typeof m.progress === 'number') onProgress('Loading the text reader…', m.progress * 0.1);
    };
    let worker;
    try {
      worker = await getWorker();
    } finally {
      logHandler = null;
    }

    onProgress('Finding the tiles…', 0.1);
    const rects = findTileRects(canvas);
    if (!rects.length) return readWholeImage(worker, canvas, onProgress);

    await worker.setParameters({
      tessedit_pageseg_mode: '7',
      tessedit_char_whitelist: WORD_CHARS,
      preserve_interword_spaces: '1',
    });
    const words = [];
    for (let i = 0; i < rects.length; i++) {
      onProgress(`Reading tile ${i + 1} of ${rects.length}…`, 0.1 + 0.9 * (i / rects.length));
      const { data } = await worker.recognize(tileImage(canvas, rects[i]));
      words.push(cleanWord(data.text));
    }
    onProgress('Done', 1);
    return { words, rects };
  }

  window.ConnectionsOCR = { readPuzzle, findTileRects };
})();
