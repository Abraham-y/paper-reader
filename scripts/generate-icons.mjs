// Generates the PWA icons with zero dependencies (Node's built-in zlib only).
// Draws a cream "page" with text lines + a folded corner on the accent-red
// background, writes a 512px master PNG, and emits a matching favicon.svg.
// Smaller PNG sizes are produced from the master by `sips` (see package.json /
// the build step); this script only needs to make the 512 master + svg.
import zlib from "node:zlib";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public");

const C = {
  bg: [193, 67, 42, 255], // accent red
  page: [255, 253, 247, 255], // cream
  line: [193, 67, 42, 255], // text lines (red on the page)
  fold: [232, 214, 207, 255], // folded-corner shade
};

function makeIcon(size) {
  const px = (x, y) => (y * size + x) * 4;
  const buf = Buffer.alloc(size * size * 4);
  const set = (x, y, c) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = px(x, y);
    buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = c[3];
  };

  // Background.
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) set(x, y, C.bg);

  // Page rectangle, centered, with a folded top-right corner.
  const m = Math.round(size * 0.2); // margin
  const x0 = m, y0 = m, x1 = size - m, y1 = size - m;
  const fold = Math.round(size * 0.16); // size of the folded corner
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const inFold = x > x1 - fold && y < y0 + fold && x - (x1 - fold) > y - y0;
      if (x > x1 - fold && y < y0 + fold) {
        // upper-right square: either blank (cut away) or the fold shade
        if (x - (x1 - fold) + (y - y0) < fold) set(x, y, C.bg);
        else set(x, y, C.page);
      } else {
        set(x, y, C.page);
      }
    }
  }
  // Fold shadow triangle.
  for (let y = y0; y < y0 + fold; y++) {
    for (let x = x1 - fold; x < x1; x++) {
      if (x - (x1 - fold) + (y - y0) === fold || x - (x1 - fold) + (y - y0) === fold - 1)
        set(x, y, C.fold);
    }
  }

  // Text lines on the page.
  const lh = Math.round(size * 0.085); // line spacing
  const th = Math.max(2, Math.round(size * 0.022)); // line thickness
  const lx0 = x0 + Math.round(size * 0.07);
  const lx1 = x1 - Math.round(size * 0.07);
  let ly = y0 + Math.round(size * 0.16);
  let row = 0;
  while (ly < y1 - lh) {
    const short = row % 3 === 2; // every third line is shorter
    const end = short ? lx0 + Math.round((lx1 - lx0) * 0.55) : lx1;
    const skip = row < 2 && true; // keep top lines clear of the fold
    const top = skip ? Math.max(lx0, lx0) : lx0;
    for (let y = ly; y < ly + th; y++)
      for (let x = top; x < (row < 1 ? Math.min(end, x1 - fold - 6) : end); x++)
        set(x, y, C.line);
    ly += lh;
    row++;
  }

  return encodePNG(buf, size, size);
}

// ---- minimal PNG encoder (RGBA, 8-bit, filter 0) ----
function encodePNG(rgba, w, h) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  // 10,11,12 = compression/filter/interlace = 0
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter type 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])) >>> 0, 0);
  return Buffer.concat([len, t, data, crc]);
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

// SVG favicon mirroring the PNG look.
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="#c1432a"/>
  <path d="M102 102 H360 L410 152 V410 H102 Z" fill="#fffdf7"/>
  <path d="M360 102 L410 152 H360 Z" fill="#e8d6cf"/>
  <g fill="#c1432a">
    <rect x="138" y="170" width="180" height="11" rx="3"/>
    <rect x="138" y="212" width="234" height="11" rx="3"/>
    <rect x="138" y="254" width="130" height="11" rx="3"/>
    <rect x="138" y="296" width="234" height="11" rx="3"/>
    <rect x="138" y="338" width="180" height="11" rx="3"/>
  </g>
</svg>`;

writeFileSync(join(OUT, "icon-512.png"), makeIcon(512));
writeFileSync(join(OUT, "favicon.svg"), svg);
console.log("wrote public/icon-512.png and public/favicon.svg");
