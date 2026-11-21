// Vice Lines' entry: the app is this directory's app/ folder, plain static files a desktop browser loads offline
// (app/index.html and its ES modules, no library and no network request), and the program hands it in. It copies
// app/ and screenshots/ from beside this file to the output root and writes dossier.json, the summary the judge
// reads, with the vendored make.fun library.
//
// This is not the starter's plumbing. Before it writes anything it checks the entry against the scorer's own caps,
// so a bad build fails here, naming the number that broke it, instead of being refused at intake:
//
//   app/               more than 993 files and directories, more than 48 MiB of files, or a path over 1000 UTF-8 bytes
//   app/index.html     missing, not a regular file, or over 1 MiB
//   screenshots/       fewer than 3 or more than 4 images, one over 262144 bytes, one that is not a PNG or JPEG,
//                      one whose long side is over 1280, or whose short side is under 480 (read from the file's own
//                      header: a PNG's IHDR, a JPEG's SOF marker)
//   dossier.json       more than 1.5 MiB
//
// Node 22, the standard library only: no dependency, no build, no flags. The pixel sizes come from the bytes
// themselves, so no image decoder is involved.
//
// Serve it locally with `node serve.ts`, then open http://localhost:8080.
// Outside the grader's container, MAKEFUN_OUTPUT_DIR stands in for /output:
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts

import { cpSync, lstatSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-app.ts';

/** The scorer's caps (reference/gate.json), the ones this program refuses an entry on. */
const CAPS = {
  app_max_files: 993,
  app_max_bytes: 48 * 1024 * 1024,
  app_path_max_bytes: 1000,
  index_max_bytes: 1024 * 1024,
  shots_min: 3,
  shots_max: 4,
  shot_max_bytes: 262144,
  shot_max_long: 1280,
  shot_min_short: 480,
  dossier_max_bytes: 1536 * 1024,
  text_max_bytes: 163840,
  screenshots: { max: 4, max_bytes: 262144 },
};

const here = fileURLToPath(new URL('.', import.meta.url));
const out = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

/** A refusal: the program ends with this message and a nonzero status, writing no entry. */
class Refused extends Error {}

/** A path's length in UTF-8 bytes, the gate's own measure. */
const utf8 = (s: string): number => Buffer.byteLength(s, 'utf8');

/** One file or directory under app/, walked once. */
interface Entry {
  path: string;
  bytes: number;
}

/**
 * Every file and directory under app/, by path relative to app/. Refuses a symbolic link or special file, more than
 * caps.app_max_files entries, more than caps.app_max_bytes of files, and a path over caps.app_path_max_bytes.
 */
function walkApp(appDir: string): { files: Entry[]; count: number; totalBytes: number } {
  let root;
  try {
    root = lstatSync(appDir);
  } catch {
    throw new Refused(`app/: no such directory (${appDir}): an app is a directory of static files, index.html at its root`);
  }
  if (!root.isDirectory()) throw new Refused(`app/: not a directory (${appDir})`);
  const files: Entry[] = [];
  const stack: string[] = [''];
  let count = 0;
  let totalBytes = 0;
  while (stack.length > 0) {
    const rel = stack.pop()!;
    let entries;
    try {
      entries = readdirSync(rel === '' ? appDir : join(appDir, rel), { withFileTypes: true });
    } catch (err) {
      throw new Refused(`app/${rel}: cannot be read (${(err as Error).message})`);
    }
    for (const e of entries) {
      const path = rel === '' ? e.name : `${rel}/${e.name}`;
      const pathBytes = utf8(path);
      if (pathBytes > CAPS.app_path_max_bytes) {
        throw new Refused(`app/${path}: a path of ${pathBytes} UTF-8 bytes, over the ${CAPS.app_path_max_bytes} allowed (app_path_max_bytes)`);
      }
      let st;
      try {
        st = lstatSync(join(appDir, path));
      } catch {
        throw new Refused(`app/${path}: cannot be read`);
      }
      count++;
      if (count > CAPS.app_max_files) {
        throw new Refused(`app/: holds more than the ${CAPS.app_max_files} files and directories allowed (app_max_files)`);
      }
      if (st.isDirectory()) {
        stack.push(path);
      } else if (st.isFile()) {
        totalBytes += st.size;
        if (totalBytes > CAPS.app_max_bytes) {
          throw new Refused(`app/: its files come to more than the ${CAPS.app_max_bytes} bytes allowed (app_max_bytes)`);
        }
        files.push({ path, bytes: st.size });
      } else {
        throw new Refused(`app/${path}: a symbolic link or special file (app/ holds plain files and directories only)`);
      }
    }
  }
  return { files, count, totalBytes };
}

/** Whether app/index.html is present as a regular file within the page cap; returns its bytes. */
function indexHtmlOf(appDir: string): number {
  const at = join(appDir, 'index.html');
  let st;
  try {
    st = lstatSync(at);
  } catch {
    throw new Refused('app/index.html: no such file: an app is a directory of static files, its index.html at its root');
  }
  if (!st.isFile()) throw new Refused('app/index.html: not a regular file (a link or a directory, not the page)');
  if (st.size > CAPS.index_max_bytes) {
    throw new Refused(`app/index.html: ${st.size} bytes, over the ${CAPS.index_max_bytes} a page may be`);
  }
  return st.size;
}

// ---------------------------------------------------------------- image headers: no decoder, no dependency

const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG_MAGIC = [0xff, 0xd8, 0xff];

const opensWith = (b: Uint8Array, magic: readonly number[], at = 0): boolean => b.length >= at + magic.length && magic.every((m, i) => b[at + i] === m);

/**
 * A PNG's size from its IHDR chunk: the 8-byte signature, then the chunk length and type at 8..16, then the width and
 * height as big-endian 32-bit integers at 16..24. Null when the bytes are not a PNG with an IHDR where it belongs.
 */
function pngSize(b: Uint8Array): { w: number; h: number } | null {
  if (!opensWith(b, PNG_MAGIC)) return null;
  if (b.length < 24) return null;
  const type = String.fromCharCode(b[12]!, b[13]!, b[14]!, b[15]!);
  if (type !== 'IHDR') return null;
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const w = view.getUint32(16);
  const h = view.getUint32(20);
  if (w === 0 || h === 0) return null;
  return { w, h };
}

/**
 * A JPEG's size from its first SOFn marker: after SOI, each segment starts 0xFF then a marker byte and a big-endian
 * 16-bit length covering the length itself; a start-of-frame (C0-CF except C4 DHT, C8 JPG, CC DAC) carries the
 * precision, then the height and width. Stuffed 0xFF fill bytes and standalone markers are stepped over. Null when no
 * frame marker is found.
 */
function jpegSize(b: Uint8Array): { w: number; h: number } | null {
  if (!opensWith(b, JPEG_MAGIC)) return null;
  let i = 2;
  while (i + 1 < b.length) {
    if (b[i] !== 0xff) return null;
    // A run of 0xFF bytes is fill: the marker is the first non-FF byte.
    while (i < b.length && b[i] === 0xff) i++;
    if (i >= b.length) return null;
    const marker = b[i]!;
    i++;
    // Standalone markers: TEM (01) and the restarts (D0-D7) carry no length.
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    if (marker === 0xd9 || marker === 0xda) return null; // EOI, or SOS before any frame: no size to read
    if (i + 1 >= b.length) return null;
    const length = (b[i]! << 8) | b[i + 1]!;
    if (length < 2) return null;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 6 >= b.length) return null;
      const h = (b[i + 3]! << 8) | b[i + 4]!;
      const w = (b[i + 5]! << 8) | b[i + 6]!;
      if (w === 0 || h === 0) return null;
      return { w, h };
    }
    i += length;
  }
  return null;
}

/** An image's type and pixel size, from its own header alone. */
function imageSize(b: Uint8Array): { type: 'png' | 'jpeg'; w: number; h: number } | null {
  const png = pngSize(b);
  if (png !== null) return { type: 'png', ...png };
  const jpeg = jpegSize(b);
  if (jpeg !== null) return { type: 'jpeg', ...jpeg };
  return null;
}

/** The screenshots, in name order, each checked against the caps: count, bytes, type and pixel dimensions. */
interface Shot {
  name: string;
  bytes: number;
  type: 'png' | 'jpeg';
  w: number;
  h: number;
}

function checkScreenshots(dir: string): Shot[] {
  let st;
  try {
    st = lstatSync(dir);
  } catch {
    throw new Refused('screenshots/: no such directory: an entry hands in 3 or 4 renders of its app, the first by name the cover');
  }
  if (!st.isDirectory()) throw new Refused('screenshots/: not a directory');
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort();
  if (names.length < CAPS.shots_min) {
    throw new Refused(`screenshots/: holds ${names.length} image${names.length === 1 ? '' : 's'}, fewer than the ${CAPS.shots_min} required`);
  }
  if (names.length > CAPS.shots_max) {
    throw new Refused(`screenshots/: holds ${names.length} images, more than the ${CAPS.shots_max} allowed`);
  }
  return names.map((name) => {
    const at = join(dir, name);
    const bytes = readFileSync(at);
    if (bytes.length > CAPS.shot_max_bytes) {
      throw new Refused(`screenshots/${name}: ${bytes.length} bytes, over the ${CAPS.shot_max_bytes} allowed (screenshots.max_bytes)`);
    }
    const size = imageSize(new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength));
    if (size === null) throw new Refused(`screenshots/${name}: neither a PNG nor a JPEG (or its header is unreadable)`);
    const long = Math.max(size.w, size.h);
    const short = Math.min(size.w, size.h);
    if (long > CAPS.shot_max_long) {
      throw new Refused(`screenshots/${name}: ${size.w} x ${size.h}, its long side ${long} over the ${CAPS.shot_max_long} allowed`);
    }
    if (short < CAPS.shot_min_short) {
      throw new Refused(`screenshots/${name}: ${size.w} x ${size.h}, its short side ${short} under the ${CAPS.shot_min_short} required`);
    }
    return { name, bytes: bytes.length, type: size.type, w: size.w, h: size.h };
  });
}

// ---------------------------------------------------------------- the entry

function main(): void {
  const appDir = join(here, 'app');
  const shotsDir = join(here, 'screenshots');

  const app = walkApp(appDir);
  indexHtmlOf(appDir);
  const shots = checkScreenshots(shotsDir);

  mkdirSync(out, { recursive: true });
  cpSync(appDir, join(out, 'app'), { recursive: true });
  mkdirSync(join(out, 'screenshots'), { recursive: true });
  cpSync(shotsDir, join(out, 'screenshots'), { recursive: true });

  const dossier = buildDossier(out, {
    text_max_bytes: CAPS.text_max_bytes,
    screenshots: { max: CAPS.screenshots.max, max_bytes: CAPS.screenshots.max_bytes },
    app_max_files: CAPS.app_max_files,
    app_max_bytes: CAPS.app_max_bytes,
    app_path_max_bytes: CAPS.app_path_max_bytes,
  });
  if (dossier.length > CAPS.dossier_max_bytes) {
    throw new Refused(`dossier.json: ${dossier.length} bytes, over the ${CAPS.dossier_max_bytes} allowed`);
  }
  writeFileSync(join(out, 'dossier.json'), dossier);

  const dims = shots.map((s) => `${s.name} ${s.w} x ${s.h}`).join(', ');
  process.stdout.write(`Vice Lines: app/ ${app.count} files and directories (${app.totalBytes} bytes), screenshots/ ${shots.length} images (${dims}), dossier.json ${dossier.length} bytes\n`);
}

try {
  main();
} catch (err) {
  if (err instanceof Refused) {
    process.stderr.write(`main.ts: refused: ${err.message}\n`);
    process.exitCode = 1;
  } else {
    throw err;
  }
}
