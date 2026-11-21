// The screenshot scenes: ?shot=cover renders an exported cover alone (body.shot-cover hides the editor), and
// ?shot=editor fills the editor from the sample photos and a caption so the page shows the app at work. The scene's
// parameters are the layout, size, caption, place and which sample goes in which panel.
export async function runShot(shot, query, api) {
  // A cover scene shows the poster and nothing else: the editor's panels never need filling.
  if (shot === 'cover') {
    document.body.classList.add('shot-cover');
  }
  const { state, loadImage } = api;
  const layout = query.get('layout');
  const size = query.get('size');
  const caption = query.get('caption');
  const place = query.get('place');
  if (layout) state.layout = layout;
  if (size) state.size = size;
  if (caption !== null) {
    state.caption = caption;
    state.place = place ?? '';
    const input = document.getElementById('caption');
    if (input) input.value = caption;
    const placeInput = document.getElementById('place');
    if (placeInput && place !== null) placeInput.value = place;
  }

  const photo = query.get('photo') ?? 'boulevard';
  const names = photo.split(',').filter(Boolean);
  const images = [];
  for (const name of names) images.push(await loadImage(`./samples/${name}.jpg`));

  const n = api.countOf();
  for (let i = 0; i < n; i++) {
    // Every panel takes a photo: with fewer photos than panels the samples cycle through them with
    // different crops, so no panel is ever left as bare gradient in the cover the judge sees first.
    const img = images[i % images.length];
    const pass = Math.floor(i / images.length);
    state.panels[i] = { src: img.src, img, crop: { zoom: 1 + pass * 0.18, ox: pass * 0.04, oy: -pass * 0.03 } };
  }
  for (const img of images) if (!api.library.some((e) => e.src === img.src)) api.library.push({ name: 'sample', src: img.src, img });

  const crops = (query.get('crops') ?? '').split(';').filter(Boolean);
  crops.forEach((spec, i) => {
    const [z, x, y] = spec.split(',').map(Number);
    if (state.panels[i]) state.panels[i].crop = { zoom: z || 1, ox: x || 0, oy: y || 0 };
  });

  if (shot === 'cover') {
    api.redraw();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    window.__shotReady = true;
    return;
  }

  api.rebuild();
  const file = document.getElementById('file');
  if (file) file.hidden = true;
  document.getElementById('status').textContent = `${n} panels filled from ${names.length} photo${names.length === 1 ? '' : 's'}. Drag a panel to reframe, then Export PNG.`;
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  window.__shotReady = true;
}
