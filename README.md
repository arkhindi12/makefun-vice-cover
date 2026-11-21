# Vice Cover — a GTA-style cover art maker that runs offline

Turn your own photos and a caption into multi-panel poster cover art with a Vice City sunset grade,
and export it as a PNG. Everything happens in your browser: the photos never leave your machine.

[![make.fun](https://make.fun/badge/gta6-cover-art-01.svg)](https://make.fun/bounty/gta6-cover-art-01)
[![rank](https://make.fun/badge/gta6-cover-art-01/arkhindi12/makefun-vice-cover/rank.svg)](https://make.fun/bounty/gta6-cover-art-01)
[![reward](https://make.fun/badge/gta6-cover-art-01/arkhindi12/makefun-vice-cover/reward.svg)](https://make.fun/bounty/gta6-cover-art-01)

## What it does

- **Multi-panel layouts** — a two-column split, a three-column band with a stacked centre, and a
  six-panel grid. Each layout varies its panel widths so the result reads as a printed poster rather
  than a photo collage, with thin gutters between panels.
- **Your photos, cropped per panel** — drop several photos in, click a panel, drag to pan and use the
  zoom slider. The crop is clamped so no empty edge ever shows. Fill every panel with one photo or
  spread several across them.
- **A Vice City grade** — a magenta-to-orange sunset ramp for the backdrop and gutters, then a contrast
  and saturation lift on each photo followed by a tint at partial alpha, so the neon mood lands without
  washing the subject out. A sun disc, a halation bloom and a scanned-film grain pass finish it.
- **Bold caption lettering** — a heavy display face in all caps with a hard dark outline and a long drop
  shadow, split into a headline and a kicker. A `|` in the caption starts a new line.
- **Poster furniture** — a corner location strip, a rating plate and a series lockup, aligned to the
  panel edges instead of floating on top.
- **Three post sizes** — 1080 × 1080, 1080 × 1350 and 1920 × 1080, exported as PNG.

## Run it

Open `app/index.html` in desktop Chrome, or serve the folder:

```
node serve.ts
```

It works with the network off. Every script, font and image the page loads is a file under `app/` or a
`data:` URI; nothing is fetched from anywhere.

## Build the entry

```
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` copies `app/` and `screenshots/` into the output directory and writes `dossier.json` with
`buildDossier` from `vendor/makefun-app.ts`. Two runs write byte-identical output.

## Files

| Path | What it is |
| --- | --- |
| `app/index.html` | The editor: photo strip, panel picker, caption and layout controls, live preview |
| `app/src/cover.js` | `panelRects` for the layouts and `renderCover`, the whole poster renderer |
| `app/src/main.js` | Editor state, panel selection, crop clamping, export |
| `app/src/shots.js` | The screenshot scenes (`?shot=cover`, `?shot=editor`) |
| `app/fonts/Anton-Regular.ttf` | The display face, under the SIL Open Font License (see `OFL.txt`) |
| `app/samples/` | Sample photos made with an image model for make.fun, free to use |
| `screenshots/` | Three screenshots: an exported cover, the editor, a second cover |

## Originality

No Rockstar Games logo, wordmark, official artwork, character or font file is used. The display face
ships under the SIL Open Font License. The cover furniture — the series lockup, the rating plate, the
location strip — is drawn in code.

## Licence

MIT. See `LICENSE`.
