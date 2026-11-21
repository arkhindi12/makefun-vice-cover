// Vice Lines: wires the editor. One screen: photos drop into a strip, each panel takes one with its own crop, the
// caption and place type live into a redrawn preview, the layout and size pickers restyle it, one export writes the
// PNG. Photos never leave the machine: they are read with createObjectURL and drawn on the canvas.
//
// A `?shot=` query opens a fixed scene for the maker's screenshots (./shots.js): ?shot=cover renders an exported
// cover and hides the editor, ?shot=editor fills the editor from the samples and paints it.
import {
  LAYOUTS,
  SIZES,
  clampCrop,
  cropBox,
  loadDisplayFont,
  panelRects,
  renderCover,
} from './cover.js';
import { runShot } from './shots.js';

const $ = (id) => document.getElementById(id);
const preview = $('preview');
const ctx = preview.getContext('2d');
const mask = $('mask');

/** The editor's whole state: the layout, size, caption, place and one entry per panel ({ src, img, crop }). */
const state = {
  layout: 'band',
  size: 'portrait',
  caption: 'SUNSET|HEIST',
  place: 'VICE CITY',
  panels: Array.from({ length: 6 }, () => ({ src: null, img: null, crop: { zoom: 1, ox: 0, oy: 0 } })),
  selected: 0,
};

/** Every photo the person has loaded, in the order they came in, as { name, img }. */
const library = [];

const sizeOf = () => SIZES.find((s) => s.id === state.size) ?? SIZES[0];
const countOf = () => panelRects(state.layout, state.size === 'wide').length;

/** Loads an image URL, resolving once it can be drawn. */
function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`could not read ${url}`));
    img.src = url;
  });
}

// ---------------------------------------------------------------- drawing

let pending = 0;
/** Draws the cover at the chosen size into the preview canvas; a change while a frame is pending coalesces. */
function draw() {
  if (pending) return;
  pending = requestAnimationFrame(() => {
    pending = 0;
    const size = sizeOf();
    if (preview.width !== size.w || preview.height !== size.h) {
      preview.width = size.w;
      preview.height = size.h;
    }
    renderCover(ctx, state);
    const dim = $('previewdim');
    if (dim) dim.textContent = `${preview.width} x ${preview.height}`;
    paintMask();
  });
}

/** The selection overlay: the chosen panel outlined, and each empty panel labelled. */
function paintMask() {
  const rects = panelRects(state.layout, preview.width > preview.height * 1.25);
  if (preview.style.display === 'none') return;
  const b = preview.getBoundingClientRect();
  const art = mask.getBoundingClientRect();
  const sc = b.width / preview.width;
  mask.innerHTML = '';
  rects.forEach((r, i) => {
    if (i === state.selected) {
      const el = document.createElement('div');
      el.className = 'sel';
      el.dataset.n = `Panel ${i + 1}`;
      el.style.cssText = `left:${b.left - art.left + r.x * b.width}px;top:${b.top - art.top + r.y * b.height}px;width:${r.w * b.width}px;height:${r.h * b.height}px;`;
      mask.appendChild(el);
    }
    if (!state.panels[i]?.img) {
      const el = document.createElement('div');
      el.className = 'empty';
      el.style.cssText = `left:${b.left - art.left + r.x * b.width}px;top:${b.top - art.top + r.y * b.height}px;width:${r.w * b.width}px;height:${r.h * b.height}px;`;
      el.textContent = `Panel ${i + 1}`;
      mask.appendChild(el);
    }
  });
  void sc;
}

// ---------------------------------------------------------------- the panel strip and crop controls

function buildPickers() {
  const layouts = $('layouts');
  layouts.innerHTML = '';
  LAYOUTS.forEach((l) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-pressed', String(l.id === state.layout));
    b.innerHTML = `<b>${l.label.split(' ')[0]}</b><small>${l.panels} panels</small>`;
    b.title = l.label;
    b.addEventListener('click', () => {
      state.layout = l.id;
      buildPickers();
      buildPanelStrip();
      draw();
    });
    layouts.appendChild(b);
  });

  const sizes = $('sizes');
  sizes.innerHTML = '';
  SIZES.forEach((s) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-pressed', String(s.id === state.size));
    b.innerHTML = `<b>${s.label}</b><small>${s.w > s.h ? 'landscape post' : s.w === s.h ? 'square post' : 'portrait post'}</small>`;
    b.addEventListener('click', () => {
      state.size = s.id;
      buildPickers();
      $('previewdim').textContent = s.label;
      draw();
      $('sizefoot').textContent = `${s.label} pixels: ${s.w > s.h ? 'a landscape post' : s.w === s.h ? 'a square post' : 'the portrait post'}.`;
    });
    sizes.appendChild(b);
  });
}

function buildPanelStrip() {
  const strip = $('panels');
  strip.innerHTML = '';
  const n = countOf();
  for (let i = 0; i < n; i++) {
    const b = document.createElement('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(i === state.selected));
    b.classList.toggle('filled', Boolean(state.panels[i]?.img));
    b.textContent = String(i + 1);
    b.title = `Panel ${i + 1}`;
    b.addEventListener('click', () => select(i));
    strip.appendChild(b);
  }
  for (let i = n; i < state.panels.length; i++) state.panels.splice(i, 1);
  while (state.panels.length < n) state.panels.push({ src: null, img: null, crop: { zoom: 1, ox: 0, oy: 0 } });
  if (state.selected >= n) state.selected = 0;
  $('panellabel').textContent = `panel ${state.selected + 1} of ${n}`;
  syncCropControls();
}

function select(i) {
  state.selected = i;
  [...$('panels').children].forEach((b, k) => b.setAttribute('aria-pressed', String(k === i)));
  $('panellabel').textContent = `panel ${i + 1} of ${countOf()}`;
  syncCropControls();
  paintMask();
}

function syncCropControls() {
  const p = state.panels[state.selected];
  const crop = p?.crop ?? { zoom: 1, ox: 0, oy: 0 };
  $('zoom').value = String(crop.zoom);
  $('panx').value = String(crop.ox);
  $('pany').value = String(crop.oy);
  $('zoomout').textContent = `${crop.zoom.toFixed(2)}x`;
  $('panxout').textContent = crop.ox.toFixed(2);
  $('panyout').textContent = crop.oy.toFixed(2);
}

/** Sets the selected panel's crop, clamped so the photo always covers the panel. */
function setCrop(patch) {
  const p = state.panels[state.selected];
  if (!p?.img) return;
  const rect = panelRects(state.layout, preview.width > preview.height * 1.25)[state.selected];
  const pw = rect.w * preview.width;
  const ph = rect.h * preview.height;
  p.crop = clampCrop(p.img, pw, ph, { ...p.crop, ...patch });
  syncCropControls();
  draw();
}

// ---------------------------------------------------------------- photos

function refreshThumbs() {
  const box = $('thumbs');
  box.innerHTML = '';
  library.forEach((entry, i) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.title = `Put ${entry.name} in the next panel`;
    const img = document.createElement('img');
    img.src = entry.src;
    img.alt = entry.name;
    b.appendChild(img);
    const used = state.panels.findIndex((p) => p.src === entry.src);
    if (used >= 0) {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = String(used + 1);
      b.appendChild(tag);
    }
    b.addEventListener('click', () => assign(entry, i));
    box.appendChild(b);
  });
}

/** Puts a photo in the selected panel when that panel is empty or was asked for, else in the next empty one. */
function assign(entry, index) {
  const n = countOf();
  let target = state.selected;
  const selectedEmpty = !state.panels[target]?.img;
  if (!selectedEmpty && index === undefined) {
    target = state.panels.slice(0, n).findIndex((p) => !p.img);
    if (target < 0) target = state.selected;
  }
  state.panels[target] = { src: entry.src, img: entry.img, crop: { zoom: 1, ox: 0, oy: 0 } };
  select(target);
  buildPanelStrip();
  refreshThumbs();
  draw();
}

async function addFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/'));
  if (files.length === 0) return;
  const start = library.length;
  for (const file of files) {
    const src = URL.createObjectURL(file);
    try {
      const img = await loadImage(src);
      library.push({ name: file.name || 'photo', src, img });
    } catch {
      URL.revokeObjectURL(src);
    }
  }
  const added = library.slice(start);
  refreshThumbs();
  // Several photos in a row fill the panel they land on and the empty ones after it.
  let k = 0;
  for (const entry of added) {
    const n = countOf();
    let target = state.panels.slice(0, n).findIndex((p) => !p.img);
    if (target < 0) target = (state.selected + k) % n;
    state.panels[target] = { src: entry.src, img: entry.img, crop: { zoom: 1, ox: 0, oy: 0 } };
    k++;
  }
  buildPanelStrip();
  refreshThumbs();
  draw();
  $('status').textContent = `${added.length} photo${added.length === 1 ? '' : 's'} loaded, ${countOf()} panels on the cover.`;
}

async function addSample(name) {
  const src = `./samples/${name}.jpg`;
  const img = await loadImage(src);
  library.push({ name, src, img });
  const n = countOf();
  let target = state.panels.slice(0, n).findIndex((p) => !p.img);
  if (target < 0) target = state.selected;
  state.panels[target] = { src, img, crop: { zoom: 1, ox: 0, oy: 0 } };
  select(target);
  buildPanelStrip();
  refreshThumbs();
  draw();
}

// ---------------------------------------------------------------- export

function exportPng() {
  const size = sizeOf();
  const out = document.createElement('canvas');
  out.width = size.w;
  out.height = size.h;
  renderCover(out.getContext('2d'), state);
  out.toBlob((blob) => {
    if (!blob) return;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `vice-lines-${size.w}x${size.h}.png`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    $('status').textContent = `Saved ${a.download}`;
    $('exportinfo').textContent = `${size.w} x ${size.h} PNG, ${Math.round(blob.size / 1024)} KiB`;
    window.__lastExport = { name: a.download, size: blob.size };
  }, 'image/png');
}

// ---------------------------------------------------------------- the pointer: pan and zoom over the preview

let drag = null;
preview.addEventListener('pointerdown', (e) => {
  const b = preview.getBoundingClientRect();
  const x = (e.clientX - b.left) / b.width;
  const y = (e.clientY - b.top) / b.height;
  const rects = panelRects(state.layout, preview.width > preview.height * 1.25);
  const hit = rects.findIndex((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
  if (hit >= 0) select(hit);
  if (hit >= 0 && state.panels[hit]?.img) {
    drag = { x: e.clientX, y: e.clientY, crop: { ...state.panels[hit].crop }, panel: hit, w: b.width, h: b.height, rect: rects[hit] };
    preview.classList.add('dragging');
    preview.setPointerCapture(e.pointerId);
  }
});

preview.addEventListener('pointermove', (e) => {
  if (!drag) return;
  const p = state.panels[drag.panel];
  const pw = drag.rect.w * drag.w;
  const ph = drag.rect.h * drag.h;
  const img = p.img;
  const base = Math.max(pw / img.naturalWidth, ph / img.naturalHeight) * p.crop.zoom;
  const sw = pw / base;
  const sh = ph / base;
  const travelX = Math.max(1, img.naturalWidth - sw);
  const travelY = Math.max(1, img.naturalHeight - sh);
  const dx = ((e.clientX - drag.x) / drag.w / drag.rect.w) * pw;
  const dy = ((e.clientY - drag.y) / drag.h / drag.rect.h) * ph;
  const ox = drag.crop.ox - (dx / (sw / 2)) * Math.min(1, sw / travelX);
  const oy = drag.crop.oy - (dy / (sh / 2)) * Math.min(1, sh / travelY);
  p.crop = clampCrop(img, pw, ph, { ...p.crop, ox, oy });
  syncCropControls();
  draw();
});

const endDrag = () => {
  drag = null;
  preview.classList.remove('dragging');
};
preview.addEventListener('pointerup', endDrag);
preview.addEventListener('pointercancel', endDrag);

preview.addEventListener(
  'wheel',
  (e) => {
    if (!state.panels[state.selected]?.img) return;
    e.preventDefault();
    const p = state.panels[state.selected];
    setCrop({ zoom: p.crop.zoom * (e.deltaY < 0 ? 1.06 : 0.94) });
  },
  { passive: false },
);

// ---------------------------------------------------------------- controls

function wireControls() {
  const file = $('file');
  const drop = $('drop');
  drop.addEventListener('click', () => file.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') file.click();
  });
  file.addEventListener('change', async () => {
    await addFiles(file.files);
    file.value = '';
  });
  ['dragenter', 'dragover'].forEach((t) =>
    drop.addEventListener(t, (e) => {
      e.preventDefault();
      drop.classList.add('over');
    }),
  );
  ['dragleave', 'drop'].forEach((t) =>
    drop.addEventListener(t, (e) => {
      e.preventDefault();
      drop.classList.remove('over');
    }),
  );
  drop.addEventListener('drop', (e) => {
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });
  // A photo dropped anywhere on the page lands in the strip.
  document.addEventListener('dragover', (e) => e.preventDefault());
  document.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
  });

  $('caption').addEventListener('input', (e) => {
    state.caption = e.target.value;
    draw();
  });
  $('place').addEventListener('input', (e) => {
    state.place = e.target.value;
    draw();
  });
  $('zoom').addEventListener('input', (e) => setCrop({ zoom: Number(e.target.value) }));
  $('panx').addEventListener('input', (e) => setCrop({ ox: Number(e.target.value) }));
  $('pany').addEventListener('input', (e) => setCrop({ oy: Number(e.target.value) }));
  $('resetpanel').addEventListener('click', () => {
    const p = state.panels[state.selected];
    if (!p) return;
    p.crop = { zoom: 1, ox: 0, oy: 0 };
    syncCropControls();
    draw();
  });
  $('fillall').addEventListener('click', () => {
    const first = state.panels.find((p) => p.img);
    if (!first) return;
    const n = countOf();
    for (let i = 0; i < n; i++) state.panels[i] = { src: first.src, img: first.img, crop: { zoom: state.panels[i]?.crop?.zoom ?? 1, ox: 0, oy: 0 } };
    buildPanelStrip();
    refreshThumbs();
    draw();
  });
  $('samples').addEventListener('click', (e) => {
    const b = e.target.closest('[data-sample]');
    if (b) addSample(b.dataset.sample);
  });
  $('export').addEventListener('click', exportPng);
  window.addEventListener('resize', () => paintMask());
}

// ---------------------------------------------------------------- boot

async function boot() {
  wireControls();
  buildPickers();
  buildPanelStrip();
  draw();
  const face = await loadDisplayFont();
  const chip = $('fontstate');
  chip.textContent = face ? 'Anton, OFL' : 'System lettering';
  chip.classList.toggle('ok', Boolean(face));
  draw();

  const shot = new URLSearchParams(location.search).get('shot');
  if (shot) {
    await runShot(shot, new URLSearchParams(location.search), {
      state,
      library,
      countOf,
      loadImage,
      addFiles,
      addSample,
      redraw: draw,
      exportPng,
      rebuild: () => {
        buildPickers();
        buildPanelStrip();
        refreshThumbs();
        draw();
      },
    });
  }
}

boot();
