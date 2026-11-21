// Vice Lines: the cover renderer. One function, renderCover(ctx, state), draws the whole poster at the context's own
// size, so the same code draws the live preview, the 1080 x 1080 and 1080 x 1350 posts and the exported PNG.
//
// A cover is a multi-panel layout over a sunset backdrop: irregular photo panels, each graded to a teal-shadow and
// warm-highlight duotone with a saturation lift, a sun disc and halation bloom behind the hero panel, a heavy caption
// in the shipped OFL display face drawn twice (a long drop shadow, then the letters in white inside a hard dark
// keyline and a pink outer glow), and poster furniture: a corner strip with a chevron, a rating plate, a title lockup
// and a scanned-film grain drawn once per render from a small noise tile.

/** The post sizes the app exports in. */
export const SIZES = [
  { id: 'portrait', label: '1080 x 1350', w: 1080, h: 1350 },
  { id: 'square', label: '1080 x 1080', w: 1080, h: 1080 },
  { id: 'wide', label: '1920 x 1080', w: 1920, h: 1080 },
];

/** The three layouts, in the order the picker shows them. */
export const LAYOUTS = [
  { id: 'split', label: '2-panel split', panels: 2 },
  { id: 'band', label: '3-panel band', panels: 3 },
  { id: 'grid', label: '6-panel grid', panels: 6 },
];

export const FONT_FAMILY = 'ViceDisplay';
const FONT_URL = new URL('../fonts/Anton-Regular.ttf', import.meta.url).href;

let fontReady = null;
/** Loads the shipped display face once; every export waits on it so the first PNG has the real lettering. */
export function loadDisplayFont() {
  if (fontReady === null) {
    const face = new FontFace(FONT_FAMILY, `url("${FONT_URL}")`);
    fontReady = face.load().then(
      (loaded) => {
        document.fonts.add(loaded);
        return loaded;
      },
      () => null,
    );
  }
  return fontReady;
}

const font = (size) => `${size}px "${FONT_FAMILY}", Impact, "Arial Black", sans-serif`;

/** The art's title lockup: one word under its initial, the way a game box wears its logo. */
export const TITLE_WORD = 'CHROME';
export const TITLE_INITIAL = 'C';

/**
 * The zoom a panel's crop is allowed, stated once here and read by the editor's slider, the wheel and the clamp alike:
 * 1.0 (the photo's own cover fit) up to 3.0, in steps of 0.05. cropBox reads these too, so no path can zoom past them.
 */
export const ZOOM = { min: 1, max: 3, step: 0.05 };

/** Rounds a zoom onto the step and into the range, so a wheel notch and the slider land on the same values. */
export function clampZoom(zoom) {
  const stepped = Math.round((zoom - ZOOM.min) / ZOOM.step) * ZOOM.step + ZOOM.min;
  return Math.max(ZOOM.min, Math.min(ZOOM.max, Number(stepped.toFixed(2))));
}

// ---------------------------------------------------------------- layout

/**
 * The panel rectangles, in fractions of the canvas, gutters cut in. Each layout has an upright form for a portrait
 * canvas and a landscape form for a wide one, so the panels read as a poster at both shapes:
 *   split  2 panels: a wide hero beside a narrower one (a low full-width hero over two tall ones when wide)
 *   band   3 panels: a tall hero, a narrow strip beside it, and a shorter panel under the strip
 *   grid   6 panels: 3 wide by 2 tall, columns and rows uneven
 */
export function panelRects(layout, wide = false) {
  const g = 0.012;
  const cols = (cuts) => cuts.slice(0, -1).map((x, i) => ({ x: x + (i === 0 ? 0 : g / 2), w: cuts[i + 1] - x - g }));
  if (layout === 'band') {
    if (wide) {
      const c = cols([0, 0.44, 0.66, 1]);
      return [
        { ...c[0], y: 0, h: 1 },
        { ...c[1], y: 0, h: 0.56 - g / 2 },
        { ...c[1], y: 0.56 + g / 2, h: 0.44 - g / 2 },
        { ...c[2], y: 0, h: 1 },
      ];
    }
    const c = cols([0, 0.34, 0.66, 1]);
    return [
      { ...c[0], y: 0, h: 1 },
      { ...c[1], y: 0, h: 0.47 - g / 2 },
      { ...c[1], y: 0.47 + g / 2, h: 0.53 - g / 2 },
      { ...c[2], y: 0, h: 1 },
    ];
  }
  if (layout === 'grid') {
    const c = cols(wide ? [0, 0.33, 0.67, 1] : [0, 0.34, 0.66, 1]);
    const r = wide ? [0, 0.52, 1] : [0, 0.6, 1];
    const out = [];
    for (let row = 0; row < 2; row++) {
      for (let col = 0; col < 3; col++) {
        out.push({ x: c[col].x, y: r[row] + (row === 0 ? 0 : g / 2), w: c[col].w, h: r[row + 1] - r[row] - g });
      }
    }
    return out;
  }
  if (wide) {
    const c = cols([0, 0.36, 0.64, 1]);
    return [
      { x: 0, y: 0, w: 1, h: 0.56 - g },
      { ...c[0], y: 0.56 + g / 2, h: 0.44 - g / 2 },
      { ...c[2], y: 0.56 + g / 2, h: 0.44 - g / 2 },
    ].slice(0, 3);
  }
  return [
    { x: 0, y: 0, w: 0.57 - g, h: 1 },
    { x: 0.57 + g / 2, y: 0, w: 1 - 0.57 - g / 2, h: 1 },
  ];
}

/**
 * Where each layout sets its labels. The caption is a band across the low panel or a column down a side panel; the
 * title lockup sits over the hero's top corner, clear of both.
 */
function slotsOf(layout, wide) {
  if (wide) {
    if (layout === 'band') return { caption: { x: 0.68, y: 0.5, w: 0.3, h: 0.46 }, vertical: false, title: { x: 0.02, y: 0.06 }, place: 'bl', rating: 'tr' };
    if (layout === 'grid') return { caption: { x: 0.35, y: 0.58, w: 0.62, h: 0.38 }, vertical: false, title: { x: 0.02, y: 0.05 }, place: 'bl', rating: 'tr' };
    return { caption: { x: 0.03, y: 0.6, w: 0.5, h: 0.36 }, vertical: false, title: { x: 0.02, y: 0.05 }, place: 'br', rating: 'tr' };
  }
  if (layout === 'band') return { caption: { x: 0.36, y: 0.47, w: 0.63, h: 0.5 }, vertical: false, title: { x: 0.025, y: 0.025 }, place: 'bl', rating: 'tr' };
  if (layout === 'grid') return { caption: { x: 0.03, y: 0.6, w: 0.94, h: 0.39 }, vertical: false, title: { x: 0.03, y: 0.03 }, place: 'bl', rating: 'tr' };
  return { caption: { x: 0.02, y: 0.34, w: 0.52, h: 0.58 }, vertical: true, title: { x: 0.03, y: 0.03 }, place: 'br', rating: 'tr' };
}

/** The caption split into a headline (all caps) and a kicker; an explicit | in the caption starts a new line. */
export function splitCaption(caption) {
  const lines = String(caption ?? '')
    .split('|')
    .map((s) => s.trim().toUpperCase())
    .filter((s) => s.length > 0);
  const headline = lines.shift() ?? '';
  return { headline, kicker: lines.join(' ') };
}

/** A seeded random walk, so a render of the same state draws the same grain. */
function seeded(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 100000) / 100000;
  };
}

/** The state's seed: its caption, layout and panel count, so the grain changes when the art does. */
function seedOf(state) {
  const text = `${state.layout}|${state.caption}|${(state.panels ?? []).length}`;
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return h >>> 0;
}

// ---------------------------------------------------------------- drawing helpers

/** A canvas of its own, for the noise tile the grain is drawn from. */
function scratch(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return { c, x: c.getContext('2d') };
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The sunset backdrop: deep plum at the top, magenta through the middle, burning orange at the foot. */
function drawBackdrop(ctx, w, h) {
  const sky = ctx.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#15071f');
  sky.addColorStop(0.2, '#3a0a3e');
  sky.addColorStop(0.44, '#9a0f5a');
  sky.addColorStop(0.66, '#f0335f');
  sky.addColorStop(0.84, '#ff6a34');
  sky.addColorStop(1, '#ffc247');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  // A diagonal slice of hot pink over the ramp, so the backdrop is not one clean gradient.
  const diag = ctx.createLinearGradient(0, h * 0.15, w, h * 0.8);
  diag.addColorStop(0, 'rgba(255, 60, 150, 0)');
  diag.addColorStop(0.48, 'rgba(255, 60, 150, 0.26)');
  diag.addColorStop(1, 'rgba(255, 60, 150, 0)');
  ctx.fillStyle = diag;
  ctx.fillRect(0, 0, w, h);

  // Thin bands low in the sky, the way a printed sunset stratifies.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  for (let i = 0; i < 7; i++) {
    ctx.fillStyle = `rgba(255, ${140 + i * 12}, 120, ${0.05 + i * 0.012})`;
    ctx.fillRect(0, h * (0.55 + i * 0.062), w, h * 0.006);
  }
  ctx.restore();
}

/** The sun disc behind the hero panel: a hot core with a wide halo, plus a halation bloom on top of it. */
function drawSun(ctx, w, h, rect) {
  const cx = (rect.x + rect.w * 0.58) * w;
  const cy = (rect.y + rect.h * 0.3) * h;
  const r = Math.min(w, h) * 0.23;
  const halo = ctx.createRadialGradient(cx, cy, r * 0.5, cx, cy, r * 3);
  halo.addColorStop(0, 'rgba(255, 214, 120, 0.5)');
  halo.addColorStop(0.35, 'rgba(255, 140, 80, 0.28)');
  halo.addColorStop(1, 'rgba(255, 90, 140, 0)');
  ctx.fillStyle = halo;
  ctx.fillRect(0, 0, w, h);

  // Halation: a bright core and a wider, softened ring, screened over the scene as film does around a hot light.
  ctx.save();
  ctx.globalCompositeOperation = 'screen';
  const disc = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
  disc.addColorStop(0, 'rgba(255, 246, 200, 0.95)');
  disc.addColorStop(0.7, 'rgba(255, 196, 92, 0.78)');
  disc.addColorStop(1, 'rgba(255, 120, 96, 0)');
  ctx.fillStyle = disc;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 170, 120, 0.14)';
  ctx.beginPath();
  ctx.arc(cx, cy, r * 1.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  // Bands cut across the low half of the disc.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.fillStyle = 'rgba(120, 8, 62, 0.5)';
  for (let i = 0; i < 5; i++) ctx.fillRect(cx - r, cy + r * (0.02 + i * 0.2), r * 2, r * (0.05 + i * 0.014));
  ctx.restore();
}

/**
 * A photo's crop for one panel: a cover fit at `zoom`, panned by `ox`/`oy` in [-1, 1], kept inside the photo so no
 * empty edge shows. A tall panel takes the photo in a 1.22:1 band (inset from the top or bottom), so a landscape
 * phone photo is never squashed to a hairline in a narrow panel.
 */
export function cropBox(img, pw, ph, crop) {
  const split = pw / Math.max(1, ph);
  const minAspect = 1.22;
  let bw = pw;
  let bh = ph;
  if (split > minAspect) bh = pw / minAspect;
  else if (split < 1 / minAspect) bw = ph / minAspect;
  const zoom = clampZoom(crop?.zoom ?? ZOOM.min);
  const iw = img.naturalWidth || img.width;
  const ih = img.naturalHeight || img.height;
  const base = Math.max(bw / iw, bh / ih);
  const sw = Math.min(iw, bw / (base * zoom));
  const sh = Math.min(ih, bh / (base * zoom));
  const edge = (size, shown) => (size > shown + 0.5 ? 1 : 0);
  const ox = Math.max(-edge(iw, sw), Math.min(edge(iw, sw), crop?.ox ?? 0));
  const oy = Math.max(-edge(ih, sh), Math.min(edge(ih, sh), crop?.oy ?? 0));
  const sx = ((iw - sw) / 2) * (1 + ox);
  const sy = ((ih - sh) / 2) * (1 + oy);
  return { sx, sy, sw, sh, zoom, ox, oy };
}

/**
 * The clamp the editor shares with the renderer: a crop kept inside the photo, so the renderer never shows an empty
 * edge whatever the sliders or a drag say.
 */
export function clampCrop(img, pw, ph, crop) {
  const { zoom, ox, oy } = cropBox(img, pw, ph, crop);
  return { zoom, ox, oy };
}

/** One panel: the photo cover-fitted, a saturation lift, then the teal-shadow/orange-highlight duotone pass. */
function drawPanel(ctx, panel, w, h) {
  const x = panel.x * w;
  const y = panel.y * h;
  const pw = panel.w * w;
  const ph = panel.h * h;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, pw, ph);
  ctx.clip();

  ctx.fillStyle = '#2a0a33';
  ctx.fillRect(x, y, pw, ph);
  if (panel.img) {
    const { sx, sy, sw, sh } = cropBox(panel.img, pw, ph, panel.crop);
    // The photograph comes back with punch before anything is tinted over it: a contrast and saturation lift through
    // ctx.filter, so the grade tints a photo that already reads, instead of laying a ramp over a flat one.
    ctx.save();
    ctx.filter = 'contrast(1.38) saturate(1.18)';
    ctx.drawImage(panel.img, sx, sy, sw, sh, x, y, pw, ph);
    ctx.restore();
  } else {
    drawSkyline(ctx, x, y, pw, ph);
  }

  const pass = (op, paint) => {
    ctx.save();
    ctx.globalCompositeOperation = op;
    paint();
    ctx.restore();
  };

  if (panel.img) {
    // The tint, after the lift: the backdrop's sunset ramp is carried into the photo at partial alpha, warm cream
    // lights and a teal shadow, so the panel belongs to the poster's palette without losing the photo's own contrast.
    // It is strong enough to pull a flat midday photo into the same warm hour as a dusk one, which is what makes a
    // collage of different photographs read as one poster instead of two.
    pass('soft-light', () => {
      const warm = ctx.createLinearGradient(x, y + ph, x + pw * 0.35, y);
      warm.addColorStop(0, 'rgba(255, 118, 160, 0.66)');
      warm.addColorStop(0.5, 'rgba(255, 168, 126, 0.56)');
      warm.addColorStop(1, 'rgba(150, 140, 240, 0.56)');
      ctx.fillStyle = warm;
      ctx.fillRect(x, y, pw, ph);
    });
    // Temperature lock: a warm multiply pass over the whole panel, so a photograph shot in flat daylight is graded
    // to the same golden hour as the sunset ones and the seams stop showing.
    pass('multiply', () => {
      const lock = ctx.createLinearGradient(x, y, x + pw * 0.5, y + ph);
      lock.addColorStop(0, 'rgba(255, 214, 196, 1)');
      lock.addColorStop(1, 'rgba(240, 206, 236, 1)');
      ctx.globalAlpha = 0.22;
      ctx.fillStyle = lock;
      ctx.fillRect(x, y, pw, ph);
    });
    // A rim of warm light down one edge, as if the sun sat just out of frame behind the panel.
    pass('overlay', () => {
      const rim = ctx.createLinearGradient(x, y, x + pw * 0.7, y + ph * 0.4);
      rim.addColorStop(0, 'rgba(255, 186, 128, 0.18)');
      rim.addColorStop(0.55, 'rgba(190, 150, 200, 0.04)');
      rim.addColorStop(1, 'rgba(40, 90, 170, 0.2)');
      ctx.fillStyle = rim;
      ctx.fillRect(x, y, pw, ph);
    });
  }

  // A sunset glow rising from the foot of the panel, as the sky would bleed through.
  pass('screen', () => {
    const foot = ctx.createLinearGradient(x, y + ph * 0.52, x, y + ph);
    foot.addColorStop(0, 'rgba(255, 120, 90, 0)');
    foot.addColorStop(1, 'rgba(255, 150, 110, 0.16)');
    ctx.fillStyle = foot;
    ctx.fillRect(x, y, pw, ph);
  });
  ctx.restore();
}

/**
 * An empty panel is not a hole: it gets the sunset sky with a skyline, palms and a car silhouette, so a cover reads
 * as cover art even before every panel holds a photo, and one photo can carry a whole poster.
 */
function drawSkyline(ctx, x, y, pw, ph) {
  const sky = ctx.createLinearGradient(0, y, 0, y + ph);
  sky.addColorStop(0, '#2a0b45');
  sky.addColorStop(0.45, '#a0185f');
  sky.addColorStop(0.72, '#ff5a5f');
  sky.addColorStop(0.86, '#ffb35c');
  sky.addColorStop(1, '#ffd9a0');
  ctx.fillStyle = sky;
  ctx.fillRect(x, y, pw, ph);

  const sun = ctx.createRadialGradient(x + pw * 0.5, y + ph * 0.66, 0, x + pw * 0.5, y + ph * 0.66, Math.min(pw, ph) * 0.3);
  sun.addColorStop(0, 'rgba(255, 240, 190, 0.9)');
  sun.addColorStop(1, 'rgba(255, 140, 90, 0)');
  ctx.fillStyle = sun;
  ctx.fillRect(x, y, pw, ph);

  // A skyline: block buildings of uneven height, then a few thin towers with roof lights.
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, pw, ph);
  ctx.clip();
  const horizon = y + ph * 0.74;
  const rand = seeded(Math.round(x * 7 + y * 13 + pw));
  ctx.fillStyle = 'rgba(26, 6, 32, 0.92)';
  let bx = x - 4;
  while (bx < x + pw) {
    const bw = pw * (0.06 + rand() * 0.13);
    const bh = ph * (0.07 + rand() * 0.2);
    ctx.fillRect(bx, horizon - bh, bw, ph);
    if (rand() > 0.6) ctx.fillRect(bx + bw * 0.4, horizon - bh - ph * 0.06, Math.max(2, bw * 0.08), ph * 0.06);
    bx += bw + pw * 0.008;
  }
  // Palm fronds on a leaning trunk, one at each side.
  const palm = (px, py, s) => {
    ctx.strokeStyle = 'rgba(20, 4, 24, 0.95)';
    ctx.lineWidth = Math.max(2, s * 0.035);
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.quadraticCurveTo(px + s * 0.15, py - s * 0.5, px + s * 0.05, py - s);
    ctx.stroke();
    for (let k = 0; k < 6; k++) {
      const a = -Math.PI / 2 + (k - 2.5) * 0.45;
      ctx.beginPath();
      ctx.moveTo(px + s * 0.05, py - s);
      ctx.quadraticCurveTo(px + Math.cos(a) * s * 0.5, py - s + Math.sin(a) * s * 0.4, px + Math.cos(a) * s * 0.8, py - s + Math.sin(a) * s * 0.15 + s * 0.1);
      ctx.stroke();
    }
  };
  palm(x + pw * 0.12, horizon + ph * 0.02, Math.min(pw, ph) * 0.42);
  palm(x + pw * 0.88, horizon + ph * 0.02, Math.min(pw, ph) * 0.34);

  // A low convertible in silhouette, headlights on, crossing the strip of road at the foot.
  const cy = y + ph * 0.86;
  const cs = Math.min(pw, ph) * 0.34;
  ctx.fillStyle = 'rgba(16, 3, 22, 0.96)';
  ctx.beginPath();
  ctx.moveTo(x + pw * 0.28, cy);
  ctx.lineTo(x + pw * 0.34, cy - cs * 0.26);
  ctx.lineTo(x + pw * 0.46, cy - cs * 0.4);
  ctx.lineTo(x + pw * 0.62, cy - cs * 0.4);
  ctx.lineTo(x + pw * 0.72, cy - cs * 0.2);
  ctx.lineTo(x + pw * 0.76, cy);
  ctx.closePath();
  ctx.fill();
  ctx.fillRect(x + pw * 0.26, cy, pw * 0.5, cs * 0.09);
  ctx.fillStyle = 'rgba(255, 240, 200, 0.85)';
  ctx.beginPath();
  ctx.arc(x + pw * 0.27, cy - cs * 0.02, cs * 0.05, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 60, 130, 0.9)';
  ctx.fillRect(x + pw * 0.755, cy - cs * 0.04, pw * 0.02, cs * 0.05);
  // A wet road: a few streaks of the sky reflected under the car.
  ctx.fillStyle = 'rgba(255, 120, 140, 0.16)';
  for (let k = 0; k < 5; k++) ctx.fillRect(x + pw * (0.2 + k * 0.16), cy + cs * 0.12, pw * 0.05, ph * 0.012);
  ctx.restore();
}

/** The gutter along each panel's inner edge: a hairline of light over a bar of ink, so seams read as printing. */
function drawGutter(ctx, panel, w, h) {
  const x = panel.x * w;
  const y = panel.y * h;
  const pw = panel.w * w;
  const ph = panel.h * h;
  const t = Math.max(2, Math.round(Math.min(w, h) * 0.0035));
  ctx.save();
  ctx.strokeStyle = 'rgba(14, 3, 20, 0.96)';
  ctx.lineWidth = t;
  ctx.strokeRect(x + t / 2, y + t / 2, pw - t, ph - t);
  ctx.strokeStyle = 'rgba(255, 214, 180, 0.28)';
  ctx.lineWidth = Math.max(1, t * 0.42);
  ctx.strokeRect(x + t * 1.6, y + t * 1.6, pw - t * 3.2, ph - t * 3.2);
  ctx.restore();
}

// ---------------------------------------------------------------- lettering

/** Sets one word as big as the box allows: by width first, then by height with the weight the caller asks. */
function fitWord(ctx, text, boxW, boxH, heightWeight) {
  let size = boxH * heightWeight;
  ctx.font = font(size);
  const wide = ctx.measureText(text).width;
  if (wide > 0) size = Math.min(size, (size * boxW) / wide);
  return Math.max(4, size);
}

/**
 * Sets a caption into its box: the headline (all caps) broken at the words that fit the box, then the kicker a third
 * its size. Returns the lines with their sizes, the tight tracking and the block's height.
 */
export function setCaption(ctx, caption, boxW, boxH, weight = 0.62) {
  const { headline, kicker } = splitCaption(caption);
  const words = headline.split(/\s+/).filter(Boolean);
  const rows = [];
  let row = '';
  for (const word of words) {
    const next = row === '' ? word : `${row} ${word}`;
    ctx.font = font(boxH * weight);
    if (row !== '' && ctx.measureText(next).width > boxW * 1.08) {
      rows.push(row);
      row = word;
    } else {
      row = next;
    }
  }
  if (row) rows.push(row);
  const rowsHeight = boxH / (rows.length + (kicker ? 0.55 : 0));
  const longest = rows.reduce((a, b) => (a.length > b.length ? a : b), '');
  const size = fitWord(ctx, longest, boxW, rowsHeight, weight * 1.85);
  const lines = rows.map((text) => ({ text, size, kind: 'head' }));
  if (kicker) lines.push({ text: kicker, size: size * 0.3, kind: 'kicker' });
  const tracking = -size * 0.02;
  let total = 0;
  for (const ln of lines) total += ln.size * (ln.kind === 'kicker' ? 1.34 : 0.94);
  return { lines, size, tracking, total };
}

/**
 * Draws a caption block. Horizontal: centred on x, running down from y. Vertical: a column of single letters centred
 * on x, running up from y, one glyph a line, the way a box sets a rail of type down a poster edge.
 */
export function paintCaption(ctx, block, x, y, boxW, vertical) {
  const strokeW = (s) => Math.max(2, s * 0.075);
  if (vertical) {
    let cursor = y;
    for (const ln of block.lines) {
      const step = ln.size * (ln.kind === 'kicker' ? 0.62 : 0.98);
      ctx.save();
      ctx.font = font(ln.size);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      for (const ch of [...ln.text]) {
        if (ch !== ' ') paintGlyph(ctx, ch, x, cursor - ln.size * 0.46, ln.size, strokeW(ln.size));
        cursor -= step;
      }
      cursor -= ln.size * 0.4;
      ctx.restore();
    }
    return;
  }
  let cursor = y;
  for (const ln of block.lines) {
    const lineH = ln.size * (ln.kind === 'kicker' ? 1.34 : 0.94);
    const cy = cursor + lineH / 2;
    ctx.save();
    ctx.font = font(ln.size);
    const width = ctx.measureText(ln.text).width + block.tracking * Math.max(0, ln.text.length - 1);
    const scale = width > boxW ? boxW / width : 1;
    ctx.translate(x, 0);
    ctx.scale(scale, 1);
    if ('letterSpacing' in ctx) ctx.letterSpacing = `${block.tracking}px`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    paintGlyph(ctx, ln.text, 0, cy, ln.size, strokeW(ln.size));
    ctx.restore();
    cursor += lineH;
  }
}

/**
 * One run of letters: the long drop shadow first (offset down and right, blurred, in near-black), then a pink outer
 * glow, a hard dark keyline, and the letters in warm white on top.
 */
function paintGlyph(ctx, text, x, cy, size, stroke) {
  ctx.save();
  ctx.globalAlpha = 0.6;
  ctx.fillStyle = '#120309';
  ctx.filter = `blur(${Math.max(1, Math.round(size * 0.06))}px)`;
  ctx.fillText(text, x + size * 0.07, cy + size * 0.085);
  ctx.filter = 'none';
  ctx.globalAlpha = 1;

  ctx.lineJoin = 'miter';
  ctx.miterLimit = 3;
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = '#ff3688';
  ctx.lineWidth = stroke * 3.2;
  ctx.strokeText(text, x, cy);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = '#0b0208';
  ctx.lineWidth = stroke * 2;
  ctx.strokeText(text, x, cy);

  const fill = ctx.createLinearGradient(0, cy - size * 0.5, 0, cy + size * 0.5);
  fill.addColorStop(0, '#ffffff');
  fill.addColorStop(0.6, '#fff6e8');
  fill.addColorStop(1, '#ffd8bd');
  ctx.fillStyle = fill;
  ctx.fillText(text, x, cy);
  ctx.restore();
}

/** The title lockup: a hot pink disc with the initial over it, the word under it, set over the hero's top corner. */
function drawTitleLockup(ctx, w, h, at) {
  const scale = Math.min(w, h);
  const cx = w * at.x;
  const cy = h * at.y;
  const r = scale * 0.042;
  ctx.save();
  ctx.fillStyle = '#ff2e88';
  ctx.beginPath();
  ctx.arc(cx + r, cy + r, r, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
  ctx.lineWidth = Math.max(2, r * 0.06);
  ctx.beginPath();
  ctx.arc(cx + r, cy + r, r * 0.84, 0, Math.PI * 2);
  ctx.stroke();
  ctx.font = font(r * 1.45);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  paintGlyph(ctx, TITLE_INITIAL, cx + r, cy + r + r * 0.04, r * 1.45, Math.max(2, r * 0.1));

  // The word and its series line sit beside the disc, so the lockup clears the caption below it.
  const size = scale * 0.032;
  ctx.font = font(size);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${size * 0.06}px`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const tx = cx + r * 2.5;
  const ty = cy + r * 0.85;
  paintGlyph(ctx, TITLE_WORD, tx, ty, size, Math.max(2, size * 0.07));
  const sub = size * 0.3;
  ctx.font = font(sub);
  if ('letterSpacing' in ctx) ctx.letterSpacing = `${sub * 0.18}px`;
  ctx.fillStyle = 'rgba(255, 232, 214, 0.95)';
  ctx.fillText('SERIES 01 | SUNSET CITY', tx + sub * 0.2, ty + size * 0.7);
  ctx.restore();
}

/** The location strip: a hot pink tab with a chevron, the place in heavy caps, a district line under it. */
function drawLocationStrip(ctx, w, h, place, corner) {
  const scale = Math.min(w, h);
  const size = scale * 0.027;
  const pad = scale * 0.035;
  const label = String(place || 'VICE CITY').toUpperCase();
  ctx.save();
  ctx.font = font(size);
  const hgt = size * 1.75;
  const tabW = hgt * 0.95;
  const x = corner.includes('r') ? w - pad - tabW : pad;
  const y = corner.includes('t') ? pad : h - pad - hgt;
  ctx.fillStyle = '#ff2e88';
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + tabW, y);
  ctx.lineTo(x + tabW - hgt * 0.3, y + hgt / 2);
  ctx.lineTo(x + tabW, y + hgt);
  ctx.lineTo(x, y + hgt);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = '#0b0208';
  ctx.lineWidth = Math.max(2, hgt * 0.05);
  ctx.stroke();
  ctx.fillStyle = '#0b0208';
  ctx.beginPath();
  ctx.moveTo(x + tabW + hgt * 0.22, y + hgt * 0.22);
  ctx.lineTo(x + tabW + hgt * 0.48, y + hgt / 2);
  ctx.lineTo(x + tabW + hgt * 0.22, y + hgt * 0.78);
  ctx.lineTo(x + tabW + hgt * 0.4, y + hgt / 2);
  ctx.closePath();
  ctx.fill();

  const tx = x + tabW + hgt * 0.72;
  const align = corner.includes('r') ? 'right' : 'left';
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  if (align === 'right') {
    // A right-hand strip runs leftwards from the tab: the text is laid out to the left of the arrow.
    ctx.textAlign = 'right';
    paintGlyph(ctx, label, x - hgt * 0.3, y + hgt * 0.4, size, Math.max(2, size * 0.06));
    const sub = size * 0.42;
    ctx.font = font(sub);
    const under = 'SUNSET DISTRICT | OPEN ALL NIGHT';
    ctx.fillStyle = 'rgba(20, 4, 18, 0.8)';
    ctx.fillRect(x - hgt * 0.3 - ctx.measureText(under).width - sub * 0.4, y + hgt * 0.6, ctx.measureText(under).width + sub * 0.8, sub * 1.6);
    ctx.fillStyle = 'rgba(255, 226, 206, 0.98)';
    ctx.fillText(under, x - hgt * 0.3, y + hgt * 0.64);
    ctx.restore();
    return;
  }
  paintGlyph(ctx, label, tx, y + hgt * 0.4, size, Math.max(2, size * 0.06));
  const sub = size * 0.42;
  ctx.font = font(sub);
  const under = 'SUNSET DISTRICT | OPEN ALL NIGHT';
  ctx.fillStyle = 'rgba(20, 4, 18, 0.8)';
  ctx.fillRect(tx - sub * 0.3, y + hgt * 0.6, ctx.measureText(under).width + sub * 0.6, sub * 1.6);
  ctx.fillStyle = 'rgba(255, 226, 206, 0.98)';
  ctx.fillText(under, tx, y + hgt * 0.64);
  ctx.restore();
}

/** The rating plate: an outlined square with a heavy numeral and a few lines under it. */
function drawRatingPlate(ctx, w, h, corner) {
  const scale = Math.min(w, h);
  const pad = scale * 0.035;
  const s = scale * 0.07;
  const x = corner.includes('r') ? w - pad - s : pad;
  const y = corner.includes('t') ? pad : h - pad - s;
  ctx.save();
  ctx.fillStyle = 'rgba(14, 3, 20, 0.5)';
  roundRect(ctx, x, y, s, s, s * 0.08);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 236, 226, 0.92)';
  ctx.lineWidth = Math.max(2, s * 0.05);
  roundRect(ctx, x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, s * 0.06);
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if ('letterSpacing' in ctx) ctx.letterSpacing = '0px';
  ctx.font = font(s * 0.44);
  ctx.fillText('19+', x + s / 2, y + s * 0.36);
  ctx.font = font(s * 0.115);
  ctx.fillText('MATURE', x + s / 2, y + s * 0.6);
  ctx.fillText('CONTENT', x + s / 2, y + s * 0.71);
  ctx.fillText('SUNSET CITY', x + s / 2, y + s * 0.86);
  ctx.restore();
}

/** Scanned-film grain: noise generated once into a small offscreen tile, then tiled over the cover. */
function drawGrain(ctx, w, h, seed) {
  // The tile is coarse enough that the grain stays a printed texture rather than per-pixel static: a
  // finer tile costs megabytes in a PNG export at the sizes this app writes.
  const tileSize = 256;
  const { c, x } = scratch(tileSize, tileSize);
  const data = x.createImageData(tileSize, tileSize);
  const rand = seeded(seed);
  const block = 2;
  for (let by = 0; by < tileSize; by += block) {
    for (let bx = 0; bx < tileSize; bx += block) {
      const v = 72 + Math.round(rand() * 116);
      for (let dy = 0; dy < block; dy++) {
        for (let dx = 0; dx < block; dx++) {
          const i = ((by + dy) * tileSize + (bx + dx)) * 4;
          data.data[i] = v;
          data.data[i + 1] = v;
          data.data[i + 2] = v;
          data.data[i + 3] = 255;
        }
      }
    }
  }
  x.putImageData(data, 0, 0);
  ctx.save();
  ctx.globalCompositeOperation = 'overlay';
  ctx.globalAlpha = 0.13;
  // The browser repeats the small tile: the app writes 256 x 256 pixels, never one per pixel of the cover.
  for (let ty = 0; ty < h; ty += tileSize) for (let tx = 0; tx < w; tx += tileSize) ctx.drawImage(c, tx, ty);
  // A few hundred brighter specks, as dust on a scan.
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = 1;
  for (let i = 0; i < 320; i++) {
    ctx.fillStyle = `rgba(255, 250, 240, ${0.06 + rand() * 0.22})`;
    ctx.fillRect(rand() * w, rand() * h, 1 + rand() * 2, 1 + rand() * 2);
  }
  ctx.restore();
}

/** The last pass: a vignette and a thin printed border, so the art reads as a printed sheet. */
function drawFinish(ctx, w, h) {
  const vig = ctx.createRadialGradient(w / 2, h * 0.46, Math.min(w, h) * 0.28, w / 2, h * 0.46, Math.max(w, h) * 0.8);
  vig.addColorStop(0, 'rgba(10, 0, 14, 0)');
  vig.addColorStop(1, 'rgba(10, 0, 14, 0.5)');
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = 'rgba(255, 220, 200, 0.14)';
  ctx.lineWidth = Math.max(1, Math.min(w, h) * 0.002);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, w - ctx.lineWidth, h - ctx.lineWidth);
}

// ---------------------------------------------------------------- the render

/**
 * Draws the whole cover onto ctx, at the context's own size. state: { layout, caption, place, panels: [{img, crop}] }
 * where each crop is { zoom, ox, oy } (cover fit, 1..4 and -1..1); a panel with no image draws the graded backdrop.
 */
export function renderCover(ctx, state) {
  const canvas = ctx.canvas;
  const w = canvas.width;
  const h = canvas.height;
  const layout = LAYOUTS.some((l) => l.id === state.layout) ? state.layout : 'split';
  const wide = w > h * 1.25;
  const rects = panelRects(layout, wide);
  const slot = slotsOf(layout, wide);
  const panels = state.panels ?? [];

  drawBackdrop(ctx, w, h);
  const hero = rects.reduce((a, b) => (a.w * a.h > b.w * b.h ? a : b), rects[0]);
  drawSun(ctx, w, h, hero);

  rects.forEach((rect, i) => {
    const panel = panels[i] ?? {};
    drawPanel(ctx, { ...rect, img: panel.img ?? null, crop: panel.crop }, w, h);
  });
  rects.forEach((rect) => drawGutter(ctx, rect, w, h));

  drawTitleLockup(ctx, w, h, slot.title);

  const boxW = slot.caption.w * w;
  const boxH = slot.caption.h * h;
  // A vertical caption is a column of letters, so its size is the column's width (one glyph across), not the height.
  const block = slot.vertical
    ? setCaption(ctx, state.caption ?? '', boxW, boxW * 1.4, 0.74)
    : setCaption(ctx, state.caption ?? '', boxW, boxH, 0.62);
  // A column that would run past the canvas is scaled down to the room it has, so no glyph is ever cut off.
  if (slot.vertical && block.lines.length > 0) {
    const glyphs = block.lines.reduce((n, ln) => n + ln.text.replace(/\s/g, '').length + 0.4, 0);
    const step = block.size * 0.98;
    const room = boxH;
    if (glyphs * step > room) {
      const k = room / (glyphs * step);
      for (const ln of block.lines) ln.size *= k;
      block.size *= k;
      block.total *= k;
    }
  }
  if (block.lines.length > 0 && block.lines[0].text) {
    const bx = (slot.caption.x + slot.caption.w / 2) * w;
    // A band caption is set to its box's foot, so whatever its size it stands on the same baseline.
    const by = slot.caption.y * h + boxH - block.total;
    if (slot.vertical) {
      const left = (slot.caption.x + slot.caption.w * 0.3) * w;
      paintCaption(ctx, block, left, Math.min(by + Math.min(boxH, block.total), slot.caption.y * h + boxH), boxW, true);
    } else {
      paintCaption(ctx, block, bx, Math.max(slot.caption.y * h, by), boxW, false);
    }
  }

  drawLocationStrip(ctx, w, h, state.place, slot.place);
  drawRatingPlate(ctx, w, h, slot.rating);
  drawGrain(ctx, w, h, seedOf(state));
  drawFinish(ctx, w, h);
}
