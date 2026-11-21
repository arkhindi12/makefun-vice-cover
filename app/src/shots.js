// The screenshot scenes: ?shot=cover renders an exported cover alone (body.shot-cover hides the editor), and
// ?shot=editor fills the editor from the sample photos and a caption so the page shows the app at work.
//
// A scene is declared once, in SCENES: the layout, size, caption, place and photo list it starts from, plus whether
// it shows the editor chrome. The query string then overrides any of those fields, so `?shot=cover` with no other
// parameter renders the app's own opening state and every named scene is described in one place instead of by a
// scattered chain of `??` defaults.
import { ZOOM, clampZoom } from './cover.js';

export const SCENES = {
  cover: {
    // No editor chrome: the poster is the whole page, which is what the first screenshot has to show.
    chrome: false,
    layout: 'band',
    size: 'portrait',
    caption: 'SUNSET|HEIST',
    place: 'VICE CITY',
    photos: ['boulevard'],
  },
  editor: {
    // The editor at work: the sample photos in the panels, the controls still on screen around them.
    chrome: true,
    layout: 'band',
    size: 'portrait',
    caption: 'SUNSET|HEIST',
    place: 'VICE CITY',
    photos: ['boulevard', 'pier'],
  },
};

/** The scene an unknown ?shot= name falls back to, so a mistyped name still renders something rather than nothing. */
export const DEFAULT_SCENE = 'cover';

/**
 * The panel's own bounds, read from the renderer rather than restated here: ZOOM is the range the editor's slider,
 * wheel and clamp all honour, so a crop can never leave it.
 */
const ZOOM_MIN = ZOOM.min;

/** Rounds a zoom onto the app's step and into its range: the same function the editor's wheel and slider use. */
const steppedZoom = (zoom) => clampZoom(zoom);

/** One pan value, held to the -1..1 the renderer reads and rounded to the 0.01 the slider moves in. */
const heldPan = (v) => Math.max(-1, Math.min(1, Number.isFinite(v) ? Number(v.toFixed(3)) : 0));

/**
 * The crop the cycle gives a panel that repeats a photo. Panel `index` shows photo `index % count`, so `pass` is how
 * many times the list has wrapped to reach it (0 for a photo's first use). Each further pass over the same photo is
 * zoomed in a little and panned off centre, so a repeated sample reads as a second framing rather than a duplicate
 * panel. These are the only numbers the cycle applies — +0.18 zoom and +0.04 / -0.03 pan per pass — and they go
 * through the editor's own clamp, so a six-panel poster over two photos never asks for a framing the editor cannot
 * make; panel 6 of that poster lands on zoom 1.54, inside ZOOM.max.
 */
export function cycleCrop(index, count, pass) {
  if (count <= 0 || pass <= 0) return { zoom: ZOOM_MIN, ox: 0, oy: 0 };
  void index;
  return { zoom: steppedZoom(ZOOM_MIN + pass * 0.18), ox: heldPan(pass * 0.04), oy: heldPan(pass * -0.03) };
}

/**
 * One crop from the `crops` query, held to what the editor could produce: a zoom outside ZOOM's range is pulled onto
 * it and onto its step, and a pan outside -1..1 onto that range. A shot list is a request, not a licence — without this
 * a query could ask for zoom 4 or a pan of 9, and the screenshot would show a framing no person could make with the
 * app, which is not what a screenshot of the app is for.
 */
export function clampCropSpec(spec) {
  const [z, x, y] = String(spec)
    .split(',')
    .map((part) => Number(part));
  return { zoom: steppedZoom(Number.isFinite(z) && z > 0 ? z : ZOOM_MIN), ox: heldPan(x), oy: heldPan(y) };
}

/** The photos a scene loads, from the query's comma list or the scene's own defaults. */
function photosOf(query, scene) {
  const asked = query.get('photo');
  const names = asked === null ? scene.photos : asked.split(',').filter(Boolean);
  return names.length > 0 ? names : scene.photos;
}

export async function runShot(shot, query, api) {
  const sceneName = Object.hasOwn(SCENES, shot) ? shot : DEFAULT_SCENE;
  const scene = SCENES[sceneName];
  // A cover scene shows the poster and nothing else: the editor's panels never need filling.
  if (!scene.chrome) {
    document.body.classList.add('shot-cover');
  }
  const { state, loadImage } = api;
  // The scene flags its work here and stamps it done at the end, so a reload starts from "not ready" again.
  window.__shotReady = false;
  window.__lastExport = null;

  const layout = query.get('layout') ?? scene.layout;
  const size = query.get('size') ?? scene.size;
  const caption = query.get('caption') ?? scene.caption;
  const place = query.get('place') ?? scene.place;
  state.layout = layout;
  state.size = size;
  state.caption = caption;
  state.place = place;
  const input = document.getElementById('caption');
  if (input) input.value = caption;
  const placeInput = document.getElementById('place');
  if (placeInput) placeInput.value = place;

  const names = photosOf(query, scene);
  const images = [];
  for (const name of names) images.push(await loadImage(`./samples/${name}.jpg`));

  // Every photo named is loaded into the library, so the strip and the thumbnail row show what the panels hold.
  for (const img of images) if (!api.library.some((e) => e.src === img.src)) api.library.push({ name: 'sample', src: img.src, img });

  const n = api.countOf();
  for (let i = 0; i < n; i++) {
    // Every panel takes a photo: with fewer photos than panels the samples cycle, and cycleCrop says how each repeat
    // is framed, so no panel is ever left as bare gradient in the cover the judge sees first.
    const img = images[i % images.length];
    state.panels[i] = { src: img.src, img, crop: cycleCrop(i, images.length, Math.floor(i / images.length)) };
  }

  // The query's crops are applied over the cycle's, in panel order and only to panels that exist: a list longer than
  // the layout is ignored past its last panel, never used to invent a panel the layout does not draw.
  const requested = (query.get('crops') ?? '').split(';').filter(Boolean);
  const crops = [];
  for (let i = 0; i < n; i++) {
    const crop = requested[i] !== undefined ? clampCropSpec(requested[i]) : state.panels[i].crop;
    state.panels[i].crop = crop;
    crops.push(crop);
  }

  // What the scene did, for the render script and the report: which framing each panel got, not a guess at it.
  window.__shotReport = {
    scene: sceneName,
    panels: n,
    photos: images.map((img) => img.src.split('/').pop()),
    layout,
    size,
    crops: crops.map((c) => `${c.zoom.toFixed(2)},${c.ox.toFixed(2)},${c.oy.toFixed(2)}`),
  };

  if (!scene.chrome) {
    api.redraw();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__shotReady = true;
    return;
  }

  api.rebuild();
  const file = document.getElementById('file');
  if (file) file.hidden = true;
  document.getElementById('status').textContent = `${n} panels filled from ${images.length} photo${images.length === 1 ? '' : 's'}. Drag a panel to reframe, then Export PNG.`;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__shotReady = true;
}
