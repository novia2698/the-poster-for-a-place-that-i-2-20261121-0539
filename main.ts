// VELDORIA — a travel poster for a place that isn't there.
// Entry for make.fun bounty "The Poster for a Place That Isn't There".
// Pure Node 22, zero dependencies, no network: the program draws the whole
// poster procedurally into a pixel buffer and writes /output/entry.png
// (1024x1024, under 1 MiB). Deterministic: same bytes on every run.

import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

// ---------------------------------------------------------------------------
// Canvas: a 1024x1024 RGB buffer rendered at 2x supersampling, then box
// downsampled. All drawing coordinates are in 1024-space; the canvas
// multiplies by SS internally so edges come out smooth.
// ---------------------------------------------------------------------------

const W = 1024;
const H = 1024;
const SS = 2; // supersampling factor
const BW = W * SS;
const BH = H * SS;

type RGB = [number, number, number];

const buf = new Uint8Array(BW * BH * 3);

function clamp255(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : v;
}

// Deterministic PRNG (mulberry32) so the poster is byte-identical every run.
let rngState = 0x9e3779b9;
function rnd(): number {
  rngState |= 0;
  rngState = (rngState + 0x6d2b79f5) | 0;
  let t = Math.imul(rngState ^ (rngState >>> 15), 1 | rngState);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
function hash2(x: number, y: number): number {
  // cheap deterministic 2D hash for dithering, in [0,1)
  let h = (x * 374761393 + y * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (((h ^ (h >>> 16)) >>> 0) % 1000) / 1000;
}

// Blend one supersampled pixel with source-over alpha (a in 0..1).
function setPx(sx: number, sy: number, r: number, g: number, b: number, a: number): void {
  if (sx < 0 || sy < 0 || sx >= BW || sy >= BH) return;
  const i = (sy * BW + sx) * 3;
  if (a >= 1) {
    buf[i] = r; buf[i + 1] = g; buf[i + 2] = b;
  } else if (a > 0) {
    const ia = 1 - a;
    buf[i] = clamp255(r * a + buf[i] * ia);
    buf[i + 1] = clamp255(g * a + buf[i + 1] * ia);
    buf[i + 2] = clamp255(b * a + buf[i + 2] * ia);
  }
}

// Fill an axis-aligned rect in 1024-space.
function fillRect(x0: number, y0: number, x1: number, y1: number, c: RGB, a = 1): void {
  const sx0 = Math.max(0, Math.floor(x0 * SS));
  const sy0 = Math.max(0, Math.floor(y0 * SS));
  const sx1 = Math.min(BW, Math.ceil(x1 * SS));
  const sy1 = Math.min(BH, Math.ceil(y1 * SS));
  for (let sy = sy0; sy < sy1; sy++) {
    for (let sx = sx0; sx < sx1; sx++) setPx(sx, sy, c[0], c[1], c[2], a);
  }
}

// Vertical gradient over a rect. stops: [position 0..1, color].
// A touch of deterministic dither keeps the gradient free of banding.
function vgrad(x0: number, y0: number, x1: number, y1: number, stops: [number, RGB][]): void {
  const sx0 = Math.max(0, Math.floor(x0 * SS));
  const sy0 = Math.max(0, Math.floor(y0 * SS));
  const sx1 = Math.min(BW, Math.ceil(x1 * SS));
  const sy1 = Math.min(BH, Math.ceil(y1 * SS));
  const span = y1 - y0;
  for (let sy = sy0; sy < sy1; sy++) {
    const t = (sy / SS - y0) / span;
    let lo = stops[0];
    let hi = stops[stops.length - 1];
    for (let k = 0; k < stops.length - 1; k++) {
      if (t >= stops[k][0] && t <= stops[k + 1][0]) { lo = stops[k]; hi = stops[k + 1]; break; }
    }
    const f = hi[0] === lo[0] ? 0 : (t - lo[0]) / (hi[0] - lo[0]);
    const r = lo[1][0] + (hi[1][0] - lo[1][0]) * f;
    const g = lo[1][1] + (hi[1][1] - lo[1][1]) * f;
    const b = lo[1][2] + (hi[1][2] - lo[1][2]) * f;
    for (let sx = sx0; sx < sx1; sx++) {
      const d = (hash2(sx, sy) - 0.5) * 5; // +-2.5 dither
      setPx(sx, sy, clamp255(r + d), clamp255(g + d), clamp255(b + d), 1);
    }
  }
}

// Precomputed disc offsets per radius (in supersampled pixels) for stamping.
const discCache = new Map<number, [number, number][]>();
function discOffsets(r: number): [number, number][] {
  const key = Math.round(r * 4) / 4;
  let list = discCache.get(key);
  if (list) return list;
  list = [];
  const ri = Math.ceil(r);
  for (let dy = -ri; dy <= ri; dy++) {
    for (let dx = -ri; dx <= ri; dx++) {
      if (dx * dx + dy * dy <= r * r + 0.5) list.push([dx, dy]);
    }
  }
  discCache.set(key, list);
  return list;
}

function stampDisc(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  const offs = discOffsets(r);
  const ix = Math.round(cx);
  const iy = Math.round(cy);
  for (const [dx, dy] of offs) setPx(ix + dx, iy + dy, c[0], c[1], c[2], a);
}

function fillCircle(cx: number, cy: number, r: number, c: RGB, a = 1): void {
  stampDisc(cx * SS, cy * SS, r * SS, c, a);
}

function fillEllipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
  const sx0 = Math.max(0, Math.floor((cx - rx) * SS));
  const sy0 = Math.max(0, Math.floor((cy - ry) * SS));
  const sx1 = Math.min(BW, Math.ceil((cx + rx) * SS));
  const sy1 = Math.min(BH, Math.ceil((cy + ry) * SS));
  const ccx = cx * SS;
  const ccy = cy * SS;
  const rrx = rx * SS;
  const rry = ry * SS;
  for (let sy = sy0; sy < sy1; sy++) {
    const ny = (sy + 0.5 - ccy) / rry;
    for (let sx = sx0; sx < sx1; sx++) {
      const nx = (sx + 0.5 - ccx) / rrx;
      if (nx * nx + ny * ny <= 1) setPx(sx, sy, c[0], c[1], c[2], a);
    }
  }
}

// Scanline polygon fill. pts in 1024-space, [x, y] pairs.
function fillPoly(pts: [number, number][], c: RGB, a = 1): void {
  const n = pts.length;
  if (n < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of pts) { if (y < minY) minY = y; if (y > maxY) maxY = y; }
  const sy0 = Math.max(0, Math.floor(minY * SS));
  const sy1 = Math.min(BH, Math.ceil(maxY * SS));
  for (let sy = sy0; sy < sy1; sy++) {
    const y = (sy + 0.5) / SS;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1] = pts[i];
      const [x2, y2] = pts[(i + 1) % n];
      if ((y1 <= y && y2 > y) || (y2 <= y && y1 > y)) {
        xs.push(x1 + ((y - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const sx0 = Math.max(0, Math.floor(xs[k] * SS));
      const sx1 = Math.min(BW, Math.ceil(xs[k + 1] * SS));
      for (let sx = sx0; sx < sx1; sx++) setPx(sx, sy, c[0], c[1], c[2], a);
    }
  }
}

// ---------------------------------------------------------------------------
// Thick strokes: a segment is drawn by stamping discs along it, which gives
// round caps and joins for free.
// ---------------------------------------------------------------------------

function thickLine(x0: number, y0: number, x1: number, y1: number, w: number, c: RGB, a = 1): void {
  const dx = (x1 - x0) * SS;
  const dy = (y1 - y0) * SS;
  const len = Math.hypot(dx, dy);
  const r = (w * SS) / 2;
  if (len < 0.001) { stampDisc(x0 * SS, y0 * SS, r, c, a); return; }
  const step = Math.max(1, r * 0.9);
  const n = Math.ceil(len / step);
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    stampDisc(x0 * SS + dx * t, y0 * SS + dy * t, r, c, a);
  }
}

function thickPolyline(pts: [number, number][], w: number, c: RGB, a = 1): void {
  for (let i = 0; i + 1 < pts.length; i++) {
    thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w, c, a);
  }
}

// Sample a quadratic bezier into a polyline.
function quadPoints(p0: [number, number], p1: [number, number], p2: [number, number], n = 24): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    out.push([
      u * u * p0[0] + 2 * u * t * p1[0] + t * t * p2[0],
      u * u * p0[1] + 2 * u * t * p1[1] + t * t * p2[1],
    ]);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Stroke font. Each glyph is a list of strokes on a 6-wide, 10-tall grid
// (y down). Letters are drawn as thick strokes, which reads as deliberate
// display type at poster scale instead of a pixel font.
// ---------------------------------------------------------------------------

type Glyph = [number, number][][];
const FONT: Record<string, Glyph> = {
  A: [[[0, 10], [3, 0], [6, 10]], [[1.5, 6.5], [4.5, 6.5]]],
  B: [[[0, 0], [0, 10]], [[0, 0], [3.5, 0], [5.5, 1.5], [5.5, 3.5], [3.8, 5], [0, 5]], [[0, 5], [3.8, 5], [5.5, 6.5], [5.5, 8.5], [3.5, 10], [0, 10]]],
  C: [[[5.5, 1.5], [3.5, 0], [1.2, 0.8], [0, 3], [0, 7], [1.2, 9.2], [3.5, 10], [5.5, 8.5]]],
  D: [[[0, 0], [0, 10]], [[0, 0], [3.5, 0], [5.5, 2], [5.5, 8], [3.5, 10], [0, 10]]],
  E: [[[0, 0], [0, 10]], [[0, 0], [5, 0]], [[0, 5], [4, 5]], [[0, 10], [5, 10]]],
  F: [[[0, 0], [0, 10]], [[0, 0], [5, 0]], [[0, 5], [4, 5]]],
  G: [[[5.5, 1.5], [3.5, 0], [1.2, 0.8], [0, 3], [0, 7], [1.2, 9.2], [3.5, 10], [5.5, 8.5], [5.5, 5], [3, 5]]],
  H: [[[0, 0], [0, 10]], [[6, 0], [6, 10]], [[0, 5], [6, 5]]],
  I: [[[0, 0], [6, 0]], [[3, 0], [3, 10]], [[0, 10], [6, 10]]],
  K: [[[0, 0], [0, 10]], [[5.5, 0], [0.8, 5]], [[1.8, 6], [5.5, 10]]],
  L: [[[0, 0], [0, 10]], [[0, 10], [5.5, 10]]],
  M: [[[0, 10], [0, 0], [3, 5], [6, 0], [6, 10]]],
  N: [[[0, 10], [0, 0], [6, 10], [6, 0]]],
  O: [[[1.2, 0.8], [3, 0], [4.8, 0.8], [6, 3], [6, 7], [4.8, 9.2], [3, 10], [1.2, 9.2], [0, 7], [0, 3], [1.2, 0.8]]],
  P: [[[0, 0], [0, 10]], [[0, 0], [3.5, 0], [5.5, 1.5], [5.5, 3.5], [3.5, 5], [0, 5]]],
  R: [[[0, 0], [0, 10]], [[0, 0], [3.5, 0], [5.5, 1.5], [5.5, 3.5], [3.5, 5], [0, 5]], [[3.5, 5], [6, 10]]],
  S: [[[5.5, 1.5], [3.8, 0.3], [1.5, 0.5], [0.3, 2], [0.8, 4], [2.5, 5], [4.5, 5.5], [5.7, 7], [5, 9.3], [3, 10], [1, 9.5]]],
  T: [[[0, 0], [6, 0]], [[3, 0], [3, 10]]],
  U: [[[0, 0], [0, 7], [1, 9.2], [3, 10], [5, 9.2], [6, 7], [6, 0]]],
  V: [[[0, 0], [3, 10], [6, 0]]],
  W: [[[0, 0], [1.5, 10], [3, 4.5], [4.5, 10], [6, 0]]],
  Y: [[[0, 0], [3, 5], [6, 0]], [[3, 5], [3, 10]]],
  "'": [[[4.2, 0], [3.4, 2.6]]],
};

// Draw centred text. height = cap height in 1024-space; tracking = extra
// space between glyphs as a fraction of height.
function drawText(str: string, cx: number, yTop: number, height: number, c: RGB, tracking = 0.18, a = 1): void {
  const scale = height / 10;
  const adv = 6 * scale;
  const gap = tracking * height;
  const widths = [...str].map((ch) => (ch === " " ? adv * 0.55 : adv));
  const total = widths.reduce((s, w) => s + w, 0) + gap * (str.length - 1);
  let x = cx - total / 2;
  const lw = Math.max(2.2, height * 0.105);
  for (let i = 0; i < str.length; i++) {
    const ch = str[i];
    if (ch === " ") { x += widths[i] + gap; continue; }
    if (ch === ".") {
      fillCircle(x + 3 * scale, yTop + 9.4 * scale, 0.9 * scale, c, a);
      x += widths[i] + gap;
      continue;
    }
    const glyph = FONT[ch];
    if (!glyph) { x += widths[i] + gap; continue; }
    for (const stroke of glyph) {
      const pts: [number, number][] = stroke.map(([gx, gy]) => [x + gx * scale, yTop + gy * scale]);
      thickPolyline(pts, lw, c, a);
    }
    x += widths[i] + gap;
  }
}

// ---------------------------------------------------------------------------
// The poster itself. Composition (1024x1024):
//   cream frame -> dusk sky gradient -> low sun -> stars -> distant islets
//   -> the floating island of VELDORIA with its lighthouse -> three ribbons
//   of water that rise UP from the cloud sea into the island (the place's
//   whole idea: here the sea falls upward) -> a sea of clouds -> the name,
//   set big across the sky, and one line of promise beneath it.
// ---------------------------------------------------------------------------

const CREAM: RGB = [246, 234, 210];
const INK: RGB = [30, 26, 61];
const GOLD: RGB = [214, 164, 92];

function drawSky(): void {
  vgrad(20, 20, 1004, 760, [
    [0.0, [20, 26, 61]],
    [0.32, [58, 47, 102]],
    [0.55, [138, 74, 114]],
    [0.74, [217, 106, 78]],
    [0.9, [242, 166, 90]],
    [1.0, [247, 196, 120]],
  ]);
}

function drawStars(): void {
  // Seeded scatter: fixed positions, only in the dark upper sky.
  for (let i = 0; i < 90; i++) {
    const x = 30 + rnd() * 964;
    const y = 30 + rnd() * 380;
    const r = 0.8 + rnd() * 1.6;
    const a = 0.35 + rnd() * 0.6;
    fillCircle(x, y, r, [255, 244, 214], a);
    if (rnd() < 0.12) {
      // a few four-point sparkles
      thickLine(x - 4, y, x + 4, y, 1, [255, 244, 214], a * 0.7);
      thickLine(x, y - 4, x, y + 4, 1, [255, 244, 214], a * 0.7);
    }
  }
}

function drawSun(): void {
  // Soft halo, then the disc.
  for (let r = 210; r > 84; r -= 6) {
    const a = 0.05 * (1 - (r - 84) / 126);
    fillCircle(712, 492, r, [255, 214, 140], a);
  }
  fillCircle(712, 492, 82, [255, 233, 168], 1);
  fillCircle(712, 492, 66, [255, 240, 196], 1);
}

function drawIslet(cx: number, cy: number, s: number): void {
  // A small far-off floating rock, violet silhouette.
  const rock: RGB = [74, 58, 110];
  fillPoly(
    [[cx - 52 * s, cy], [cx + 52 * s, cy], [cx + 26 * s, cy + 34 * s], [cx, cy + 58 * s], [cx - 26 * s, cy + 34 * s]],
    rock, 0.9,
  );
  fillEllipse(cx, cy - 4 * s, 56 * s, 12 * s, [96, 122, 90], 0.9);
  // a thread of water falling from it
  thickLine(cx + 18 * s, cy + 30 * s, cx + 14 * s, cy + 78 * s, 3 * s, [207, 238, 242], 0.75);
}

function drawClouds(): void {
  // Sea of clouds: layered ellipses, warm cream in front, mauve behind.
  const layers: [number, number, number, number, RGB, number][] = [
    [512, 856, 560, 92, [196, 138, 154], 0.9],
    [240, 890, 330, 96, [232, 178, 150], 0.95],
    [790, 892, 330, 96, [232, 178, 150], 0.95],
    [512, 930, 620, 110, [247, 227, 192], 1],
    [180, 962, 340, 96, [250, 236, 208], 1],
    [850, 964, 330, 96, [250, 236, 208], 1],
    [512, 1000, 660, 90, [255, 243, 214], 1],
  ];
  for (const [cx, cy, rx, ry, c, a] of layers) fillEllipse(cx, cy, rx, ry, c, a);
  // a few soft shadow strokes between the puffs
  fillEllipse(360, 930, 200, 26, [214, 164, 150], 0.5);
  fillEllipse(680, 934, 190, 24, [214, 164, 150], 0.5);
  // wisps drifting in the sky
  fillEllipse(210, 330, 90, 10, [255, 220, 190], 0.18);
  fillEllipse(830, 300, 70, 8, [255, 220, 190], 0.16);
}

function drawIsland(): void {
  // Rocky underside: an inverted cone with strata bands.
  const tip: [number, number] = [512, 872];
  const topL: [number, number] = [238, 648];
  const topR: [number, number] = [786, 648];
  const bands: [RGB, number, number][] = [
    [[107, 74, 53], 648, 690],
    [[125, 90, 64], 690, 730],
    [[84, 64, 46], 730, 776],
    [[107, 74, 53], 776, 822],
    [[72, 54, 40], 822, 872],
  ];
  for (const [c, y0, y1] of bands) {
    const f0 = (y0 - 648) / (872 - 648);
    const f1 = (y1 - 648) / (872 - 648);
    const xl0 = 238 + (512 - 238) * f0;
    const xr0 = 786 - (786 - 512) * f0;
    const xl1 = 238 + (512 - 238) * f1;
    const xr1 = 786 - (786 - 512) * f1;
    fillPoly([[xl0, y0], [xr0, y0], [xr1, y1], [xl1, y1]], c, 1);
  }
  // jagged rock edge highlights on the left flank
  fillPoly([[300, 700], [330, 706], [306, 742], [288, 716]], [140, 104, 74], 1);
  fillPoly([[700, 712], [726, 720], [706, 756], [690, 726]], [140, 104, 74], 1);
  // hanging shard below the tip
  fillPoly([[500, 872], [524, 872], [514, 906], [506, 884]], [84, 64, 46], 1);

  // Green plateau top.
  fillEllipse(512, 650, 276, 34, [79, 122, 74], 1);
  fillEllipse(512, 644, 276, 26, [123, 160, 91], 1);
  fillEllipse(430, 640, 150, 16, [140, 176, 104], 1);

  // Two cypress trees.
  for (const [tx, th] of [[300, 46], [700, 38]] as [number, number][]) {
    fillEllipse(tx, 640 - th / 2, 9, th / 2, [38, 74, 52], 1);
    fillRect(tx - 2, 640 - 4, tx + 2, 640, [84, 64, 46], 1);
  }

  // White houses with terracotta roofs.
  for (const [hx, hw] of [[596, 44], [652, 38]] as [number, number][]) {
    fillRect(hx, 640 - 26, hx + hw, 640, [250, 240, 220], 1);
    fillPoly([[hx - 4, 640 - 26], [hx + hw / 2, 640 - 42], [hx + hw + 4, 640 - 26]], [196, 96, 58], 1);
    fillRect(hx + hw / 2 - 4, 640 - 14, hx + hw / 2 + 4, 640, [60, 48, 70], 1);
  }

  // Lighthouse on the left of the plateau.
  const lx = 392;
  fillRect(lx - 4, 640 - 12, lx + 4, 640, [60, 48, 70], 1);
  fillPoly([[lx - 16, 640], [lx - 11, 640 - 92], [lx + 11, 640 - 92], [lx + 16, 640]], [250, 242, 230], 1);
  fillPoly([[lx - 14, 640 - 34], [lx + 14, 640 - 34], [lx + 13, 640 - 52], [lx - 13, 640 - 52]], [178, 52, 44], 1);
  fillPoly([[lx - 12, 640 - 70], [lx + 12, 640 - 70], [lx + 11, 640 - 84], [lx - 11, 640 - 84]], [178, 52, 44], 1);
  fillRect(lx - 13, 640 - 102, lx + 13, 640 - 92, [40, 36, 54], 1);
  fillCircle(lx, 640 - 97, 7, [255, 240, 170], 1);
  fillCircle(lx, 640 - 97, 12, [255, 240, 170], 0.35);
  // its beam, sweeping up into the dusk
  fillPoly([[lx + 8, 640 - 97], [lx + 260, 640 - 190], [lx + 260, 640 - 150], [lx + 8, 640 - 90]], [255, 240, 170], 0.16);
}

function drawRisingWater(): void {
  // Three ribbons of water that rise from the cloud sea UP and spill over
  // the island's rim onto the plateau: the poster's one impossible thing,
  // and the reason the place is worth visiting. They leave the clouds
  // narrow, climb, and burst over the edge — water flowing uphill.
  // Pale aqua with a white core, plus spray where they arrive.
  const ribbons: [[number, number], [number, number], [number, number], number][] = [
    [[330, 884], [268, 770], [306, 656], 13],
    [[512, 900], [540, 780], [512, 652], 16],
    [[694, 884], [756, 770], [718, 656], 13],
  ];
  // Tapered strokes: the ribbons narrow as they climb, the way a jet of
  // water thins as it rises — the visual cue that the flow goes UP.
  // Two passes on purpose: every segment's outer aqua first, then every
  // segment's white core. (Drawing core right after each outer would let
  // the next segment's outer erase the core's end and chop it into dashes.)
  const allPts = ribbons.map(([p0, p1, p2]) => quadPoints(p0, p1, p2, 28));
  for (let s = 0; s < ribbons.length; s++) {
    const pts = allPts[s];
    const w = ribbons[s][3];
    for (let i = 0; i + 1 < pts.length; i++) {
      const f = 1 - (i / (pts.length - 1)) * 0.45; // 1.0 at the clouds -> 0.55 at the rim
      thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w * f, [168, 214, 224], 0.95);
    }
  }
  for (let s = 0; s < ribbons.length; s++) {
    const pts = allPts[s];
    const w = ribbons[s][3];
    for (let i = 0; i + 1 < pts.length; i++) {
      const f = 1 - (i / (pts.length - 1)) * 0.45;
      thickLine(pts[i][0], pts[i][1], pts[i + 1][0], pts[i + 1][1], w * f * 0.45, [232, 247, 248], 0.95);
    }
  }
  // droplets climbing the ribbons
  const drops: [number, number, number][] = [
    [290, 800, 4], [276, 730, 3], [512, 820, 4], [526, 730, 3], [734, 800, 4], [748, 730, 3],
  ];
  for (const [x, y, r] of drops) fillCircle(x, y, r, [232, 247, 248], 0.9);
  // spray where the water bursts over the rim onto the plateau
  fillEllipse(306, 656, 30, 10, [232, 247, 248], 0.9);
  fillEllipse(512, 652, 36, 11, [232, 247, 248], 0.9);
  fillEllipse(718, 656, 30, 10, [232, 247, 248], 0.9);
  // droplets thrown up over the rim, landing on the plateau: the water
  // arrives from below and keeps going up before it falls back.
  const over: [number, number, number][] = [
    [322, 640, 4], [338, 630, 3], [498, 634, 4], [516, 624, 3], [702, 640, 4], [686, 630, 3],
  ];
  for (const [x, y, r] of over) fillCircle(x, y, r, [232, 247, 248], 0.9);
}

function drawBirds(): void {
  const birds: [number, number, number][] = [
    [268, 300, 10], [312, 282, 8], [640, 252, 9], [688, 276, 7], [180, 430, 8],
  ];
  for (const [x, y, s] of birds) {
    thickLine(x - s, y, x, y + s * 0.45, 2.4, INK, 0.85);
    thickLine(x, y + s * 0.45, x + s, y, 2.4, INK, 0.85);
  }
}

// ---------------------------------------------------------------------------
// Frame, type, PNG encoding, entry point.
// ---------------------------------------------------------------------------

function drawFrameAndType(): void {
  // Cream frame + thin gold inner rule, drawn as border strips only, so the
  // scene underneath stays visible.
  fillRect(20, 20, 1004, 28, INK, 1);
  fillRect(20, 996, 1004, 1004, INK, 1);
  fillRect(20, 20, 28, 1004, INK, 1);
  fillRect(996, 20, 1004, 1004, INK, 1);
  fillRect(30, 30, 994, 32, GOLD, 1);
  fillRect(30, 992, 994, 994, GOLD, 1);
  fillRect(30, 30, 32, 994, GOLD, 1);
  fillRect(992, 30, 994, 994, GOLD, 1);

  // The name, big across the sky, with a soft indigo shadow so it lifts.
  drawText("VELDORIA", 514, 100, 92, [18, 20, 52], 0.16, 0.55);
  drawText("VELDORIA", 512, 96, 92, [255, 243, 210], 0.16, 1);

  // One line of promise beneath the name.
  drawText("WHERE THE SEA FALLS UPWARD", 514, 212, 30, [18, 20, 52], 0.3, 0.5);
  drawText("WHERE THE SEA FALLS UPWARD", 512, 210, 30, [255, 233, 184], 0.3, 1);

  // Small gold ornament under the tagline.
  thickLine(452, 258, 506, 258, 2.5, GOLD, 1);
  thickLine(518, 258, 572, 258, 2.5, GOLD, 1);
  fillPoly([[512, 250], [520, 258], [512, 266], [504, 258]], GOLD, 1);

  // Footer on the cloud sea.
  drawText("THE SKY ISLES", 512, 948, 26, [67, 48, 94], 0.34, 1);
}

function drawPoster(): void {
  fillRect(0, 0, W, H, CREAM, 1);
  drawSky();
  drawStars();
  drawSun();
  drawIslet(196, 556, 0.9);
  drawIslet(852, 596, 0.7);
  drawIsland();
  drawClouds();
  drawRisingWater();
  drawBirds();
  drawFrameAndType();
}

// --- Minimal PNG encoder (truecolor, filter 0 per row) ----------------------

const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePNG(w: number, h: number, rgb: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type: truecolor
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    Buffer.from(rgb.buffer, y * w * 3, w * 3).copy(raw, y * (1 + w * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function main(): void {
  drawPoster();
  // Box-downsample the 2x buffer to 1024x1024.
  const rgb = new Uint8Array(W * H * 3);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const di = (y * W + x) * 3;
      let r = 0, g = 0, b = 0;
      for (let dy = 0; dy < SS; dy++) {
        for (let dx = 0; dx < SS; dx++) {
          const si = (((y * SS + dy) * BW) + (x * SS + dx)) * 3;
          r += buf[si]; g += buf[si + 1]; b += buf[si + 2];
        }
      }
      const n = SS * SS;
      rgb[di] = Math.round(r / n);
      rgb[di + 1] = Math.round(g / n);
      rgb[di + 2] = Math.round(b / n);
    }
  }
  const png = encodePNG(W, H, rgb);
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? "/output";
  mkdirSync(outDir, { recursive: true });
  const outPath = `${outDir}/entry.png`;
  writeFileSync(outPath, png);
  console.log(`wrote ${outPath} (${W}x${H}, ${png.length} bytes)`);
}

main();
