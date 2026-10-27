#!/usr/bin/env node
/**
 * Screen Studio style polish for a docs screen recording. Usage, options and
 * format: README.md next to this file. Read the guide first:
 * https://nexus.langwatch.ai/wiki/recording-video-for-docs
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// --------------------------------------------------------------------- easing

const clamp = (v, lo, hi) => {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
};
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => x * x * (3 - 2 * x);

/** Slow at both ends, quick through the middle. The default for everything. */
const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

/** Quick start, long settle. Used for the click dip and the ripple. */
const easeOutCubic = (x) => 1 - Math.pow(1 - x, 3);

// ------------------------------------------------------------- child processes

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
    const out = [];
    const err = [];
    p.stdout.on("data", (c) => out.push(c));
    p.stderr.on("data", (c) => err.push(c));
    p.on("error", (e) =>
      reject(
        new Error(
          `${cmd} could not start: ${e.message}. ` +
            (cmd === "rsvg-convert"
              ? "Install it with `brew install librsvg`."
              : "Install it with `brew install ffmpeg`."),
        ),
      ),
    );
    p.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`${cmd} exited ${code}\n${Buffer.concat(err).toString("utf8")}`));
        return;
      }
      resolve(Buffer.concat(out));
    });
  });
}

async function probe(file) {
  const raw = await run("ffprobe", [
    "-v",
    "error",
    "-select_streams",
    "v:0",
    "-show_entries",
    "stream=width,height,r_frame_rate:format=duration",
    "-of",
    "json",
    file,
  ]);
  const j = JSON.parse(raw.toString());
  const s = j.streams[0];
  const [num, den] = s.r_frame_rate.split("/").map(Number);
  return {
    width: s.width,
    height: s.height,
    fps: num / (den || 1),
    duration: Number(j.format.duration),
  };
}

/** Decodes any still image ffmpeg can read into an RGBA buffer of exactly w x h. */
async function loadImageCover(file, w, h) {
  const data = await run("ffmpeg", [
    "-v",
    "error",
    "-i",
    file,
    "-vf",
    `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`,
    "-frames:v",
    "1",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-",
  ]);
  if (data.length !== w * h * 4) {
    throw new Error(`background decoded to ${data.length} bytes, expected ${w * h * 4}`);
  }
  return data;
}

// ------------------------------------------------------------------- cursors

/**
 * Renders an SVG to an RGBA bitmap of the requested height. rsvg-convert
 * writes PNG, and node can't decode PNG on its own, so ffmpeg turns that PNG
 * into raw RGBA — both already required elsewhere, hence two processes not a library.
 */
async function rasterize(svgPath, height) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polish-cursor-"));
  const tmp = path.join(dir, "c.png");
  await run("rsvg-convert", ["-h", String(Math.round(height)), svgPath, "-o", tmp]);
  const meta = await probe(tmp);
  const rgba = await run("ffmpeg", [
    "-v",
    "error",
    "-i",
    tmp,
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-",
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
  return { width: meta.width, height: meta.height, data: rgba };
}

/** One box pass along each row of `src` into `dst`. */
function boxBlurRows({ src, dst, w, h, radius }) {
  const norm = 1 / (radius * 2 + 1);
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let x = -radius; x <= radius; x++) sum += src[row + clamp(x, 0, w - 1)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum * norm;
      sum += src[row + clamp(x + radius + 1, 0, w - 1)];
      sum -= src[row + clamp(x - radius, 0, w - 1)];
    }
  }
}

/** One box pass down each column of `src` into `dst`. */
function boxBlurColumns({ src, dst, w, h, radius }) {
  const norm = 1 / (radius * 2 + 1);
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let y = -radius; y <= radius; y++) sum += src[clamp(y, 0, h - 1) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum * norm;
      sum += src[clamp(y + radius + 1, 0, h - 1) * w + x];
      sum -= src[clamp(y - radius, 0, h - 1) * w + x];
    }
  }
}

/** Three box passes approximate a Gaussian closely enough for a drop shadow. */
function blurAlpha(src, w, h, radius) {
  if (radius < 1) return src;
  let a = src;
  let b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    boxBlurRows({ src: a, dst: b, w, h, radius });
    const t = a;
    a = new Float32Array(w * h);
    boxBlurColumns({ src: b, dst: a, w, h, radius });
    b = t;
  }
  return a;
}

/**
 * Builds the drawable cursor: a blurred black copy of its own alpha channel
 * underneath the cursor itself, on a canvas padded enough to hold the blur.
 * Premultiplied, so bilinear sampling does not bleed through the soft edges.
 */
function buildSprite(bitmap, hotspot, shadow) {
  const { width: cw, height: ch, data } = bitmap;
  const pad =
    Math.ceil(shadow.blur * 2) + Math.ceil(Math.abs(shadow.offsetX) + Math.abs(shadow.offsetY)) + 2;
  const w = cw + pad * 2;
  const h = ch + pad * 2;

  const shadowAlpha = new Float32Array(w * h);
  const ox = Math.round(pad + shadow.offsetX);
  const oy = Math.round(pad + shadow.offsetY);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const ty = y + oy;
      const tx = x + ox;
      if (ty < 0 || ty >= h || tx < 0 || tx >= w) continue;
      shadowAlpha[ty * w + tx] = data[(y * cw + x) * 4 + 3] / 255;
    }
  }
  const blurred = blurAlpha(shadowAlpha, w, h, Math.max(1, Math.round(shadow.blur / 2)));

  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) out[i * 4 + 3] = clamp(blurred[i] * shadow.opacity, 0, 1);
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const s = (y * cw + x) * 4;
      const ca = data[s + 3] / 255;
      if (ca === 0) continue;
      const d = ((y + pad) * w + (x + pad)) * 4;
      out[d + 0] = data[s + 0] * ca + out[d + 0] * (1 - ca);
      out[d + 1] = data[s + 1] * ca + out[d + 1] * (1 - ca);
      out[d + 2] = data[s + 2] * ca + out[d + 2] * (1 - ca);
      out[d + 3] = ca + out[d + 3] * (1 - ca);
    }
  }

  return { w, h, data: out, hotX: pad + hotspot.x * cw, hotY: pad + hotspot.y * ch };
}

function drawSprite(dst, dw, dh, sprite, px, py, scale, alpha) {
  if (alpha <= 0.002) return;
  const left = px - sprite.hotX * scale;
  const top = py - sprite.hotY * scale;
  const x0 = Math.max(0, Math.floor(left));
  const y0 = Math.max(0, Math.floor(top));
  const x1 = Math.min(dw, Math.ceil(left + sprite.w * scale));
  const y1 = Math.min(dh, Math.ceil(top + sprite.h * scale));
  const inv = 1 / scale;
  const sw = sprite.w;
  const sh = sprite.h;
  const s = sprite.data;

  for (let y = y0; y < y1; y++) {
    const v = (y + 0.5 - top) * inv - 0.5;
    const vy = Math.floor(v);
    const fy = v - vy;
    const ra = clamp(vy, 0, sh - 1) * sw;
    const rb = clamp(vy + 1, 0, sh - 1) * sw;
    for (let x = x0; x < x1; x++) {
      const u = (x + 0.5 - left) * inv - 0.5;
      const ux = Math.floor(u);
      const fx = u - ux;
      const ca = clamp(ux, 0, sw - 1);
      const cb = clamp(ux + 1, 0, sw - 1);

      const iA = (ra + ca) * 4;
      const iB = (ra + cb) * 4;
      const iC = (rb + ca) * 4;
      const iD = (rb + cb) * 4;
      const wA = (1 - fx) * (1 - fy);
      const wB = fx * (1 - fy);
      const wC = (1 - fx) * fy;
      const wD = fx * fy;

      const sa = (s[iA + 3] * wA + s[iB + 3] * wB + s[iC + 3] * wC + s[iD + 3] * wD) * alpha;
      if (sa <= 0.002) continue;
      const sr = (s[iA] * wA + s[iB] * wB + s[iC] * wC + s[iD] * wD) * alpha;
      const sg = (s[iA + 1] * wA + s[iB + 1] * wB + s[iC + 1] * wC + s[iD + 1] * wD) * alpha;
      const sb = (s[iA + 2] * wA + s[iB + 2] * wB + s[iC + 2] * wC + s[iD + 2] * wD) * alpha;

      const d = (y * dw + x) * 4;
      const keep = 1 - sa;
      dst[d + 0] = clamp(sr + dst[d + 0] * keep, 0, 255);
      dst[d + 1] = clamp(sg + dst[d + 1] * keep, 0, 255);
      dst[d + 2] = clamp(sb + dst[d + 2] * keep, 0, 255);
    }
  }
}

// ------------------------------------------------------------------ resampling

/** Catmull-Rom. Slightly sharper than bilinear, which matters when zoomed in. */
function kernel(x) {
  const a = Math.abs(x);
  if (a < 1) return 1.5 * a * a * a - 2.5 * a * a + 1;
  if (a < 2) return -0.5 * a * a * a + 2.5 * a * a - 4 * a + 2;
  return 0;
}

/**
 * Precomputes tap indices and weights for one axis. The filter widens when the
 * image is being made smaller, which keeps a downscale from aliasing.
 */
function planAxis(outN, srcStart, srcStep, srcLimit) {
  const support = Math.max(1, srcStep) * 2;
  const taps = Math.ceil(support) * 2;
  const idx = new Int32Array(outN * taps);
  const wgt = new Float32Array(outN * taps);
  const invSupport = 1 / Math.max(1, srcStep);

  for (let i = 0; i < outN; i++) {
    const center = srcStart + (i + 0.5) * srcStep - 0.5;
    const first = Math.floor(center - support + 0.5);
    let sum = 0;
    for (let k = 0; k < taps; k++) {
      const j = first + k;
      const w = kernel((j - center) * invSupport);
      idx[i * taps + k] = clamp(j, 0, srcLimit - 1);
      wgt[i * taps + k] = w;
      sum += w;
    }
    if (sum !== 0) {
      const n = 1 / sum;
      for (let k = 0; k < taps; k++) wgt[i * taps + k] *= n;
    }
  }
  return { idx, wgt, taps };
}

// --------------------------------------------------------------- window shape

/** Signed distance to a rounded rectangle. Negative inside. */
function sdRoundRect(px, py, cx, cy, hw, hh, r) {
  const qx = Math.abs(px - cx) - (hw - r);
  const qy = Math.abs(py - cy) - (hh - r);
  const ax = qx > 0 ? qx : 0;
  const ay = qy > 0 ? qy : 0;
  const outside = Math.sqrt(ax * ax + ay * ay);
  const inside = Math.min(Math.max(qx, qy), 0);
  return outside + inside - r;
}

/**
 * The horizontal span of a row that the window covers completely. The shadow
 * pass skips it, because an opaque window hides whatever is behind it.
 */
function opaqueSpan(y, cy, cx, hw, hh, r) {
  const dy = Math.abs(y - cy);
  if (dy >= hh) return null;
  if (dy <= hh - r) return [cx - hw, cx + hw];
  const k = dy - (hh - r);
  const inset = r - Math.sqrt(Math.max(0, r * r - k * k));
  return [cx - hw + inset, cx + hw - inset];
}

/** A soft shadow behind the window, drawn straight from the distance field. */
function drawShadow(dst, dw, dh, win, cfg) {
  const cx = win.cx + cfg.offsetX;
  const cy = win.cy + cfg.offsetY;
  const hw = win.hw + cfg.spread;
  const hh = win.hh + cfg.spread;
  const r = win.r + cfg.spread;
  const reach = cfg.blur + 2;

  const y0 = Math.max(0, Math.floor(cy - hh - reach));
  const y1 = Math.min(dh, Math.ceil(cy + hh + reach));
  const x0 = Math.max(0, Math.floor(cx - hw - reach));
  const x1 = Math.min(dw, Math.ceil(cx + hw + reach));
  const inv = 1 / (2 * cfg.blur);

  const shape = { cx, cy, hw, hh, r };
  for (let y = y0; y < y1; y++) shadeShadowRow({ dst, dw, y, x0, x1, win, shape, cfg, inv });
}

/** Darkens one row of the shadow, skipping the span the opaque window covers anyway. */
function shadeShadowRow({ dst, dw, y, x0, x1, win, shape: { cx, cy, hw, hh, r }, cfg, inv }) {
  const py = y + 0.5;
  const skip = opaqueSpan(py, win.cy, win.cx, win.hw, win.hh, win.r);
  const sk0 = skip ? Math.ceil(skip[0]) + 1 : Infinity;
  const sk1 = skip ? Math.floor(skip[1]) - 1 : -Infinity;
  for (let x = x0; x < x1; x++) {
    if (x >= sk0 && x <= sk1) {
      x = sk1;
      continue;
    }
    const sd = sdRoundRect(x + 0.5, py, cx, cy, hw, hh, r);
    if (sd >= cfg.blur) continue;
    const u = sd <= -cfg.blur ? 1 : smooth(clamp((cfg.blur - sd) * inv, 0, 1));
    const a = cfg.opacity * u;
    if (a <= 0.002) continue;
    const d = (y * dw + x) * 4;
    const keep = 1 - a;
    dst[d + 0] *= keep;
    dst[d + 1] *= keep;
    dst[d + 2] *= keep;
  }
}

/**
 * Resamples the recording into the window rectangle, masks it to rounded
 * corners and lays a hairline on the edge. Separable: rows first into a float
 * scratch buffer, then columns straight into the destination.
 */
function drawWindow(dst, dw, dh, src, sw, sh, win, border, scratchRef) {
  const step = 1 / win.scale;
  const x0 = Math.max(0, Math.floor(win.left));
  const y0 = Math.max(0, Math.floor(win.top));
  const x1 = Math.min(dw, Math.ceil(win.left + sw * win.scale));
  const y1 = Math.min(dh, Math.ceil(win.top + sh * win.scale));
  if (x1 <= x0 || y1 <= y0) return;

  const outW = x1 - x0;
  const outH = y1 - y0;
  const xs = planAxis(outW, (x0 - win.left) * step, step, sw);
  const ys = planAxis(outH, (y0 - win.top) * step, step, sh);

  const { rowMin, rows } = sourceRowSpan(ys.idx, sh);
  const need = rows * outW * 3;
  if (scratchRef.buf.length < need) scratchRef.buf = new Float32Array(need);
  const scratch = scratchRef.buf;

  resampleRows({ scratch, src, sw, xs, rowMin, rows, outW });
  compositeColumns({ dst, dw, scratch, ys, rowMin, outW, outH, x0, y0, win, border });
}

/** The first source row any output row reads, and how many rows it spans. */
function sourceRowSpan(idx, sh) {
  let rowMin = sh;
  let rowMax = 0;
  for (let i = 0; i < idx.length; i++) {
    const r = idx[i];
    if (r < rowMin) rowMin = r;
    if (r > rowMax) rowMax = r;
  }
  return { rowMin, rows: rowMax - rowMin + 1 };
}

/** The horizontal pass: each source row resampled to the window's width. */
function resampleRows({ scratch, src, sw, xs, rowMin, rows, outW }) {
  const xt = xs.taps;
  for (let r = 0; r < rows; r++) {
    const srow = (rowMin + r) * sw * 4;
    const drow = r * outW * 3;
    for (let x = 0; x < outW; x++) {
      let a = 0;
      let b = 0;
      let c = 0;
      const base = x * xt;
      for (let k = 0; k < xt; k++) {
        const w = xs.wgt[base + k];
        if (w === 0) continue;
        const p = srow + xs.idx[base + k] * 4;
        a += src[p] * w;
        b += src[p + 1] * w;
        c += src[p + 2] * w;
      }
      const d = drow + x * 3;
      scratch[d] = a;
      scratch[d + 1] = b;
      scratch[d + 2] = c;
    }
  }
}

/** One output pixel's colour, reused across pixels so the hot loop allocates nothing. */
const pixel = new Float64Array(3);

/** The vertical pass for one pixel, read out of the row-resampled scratch into `pixel`. */
function sampleColumn(scratch, ys, base, rowMin, outW, x) {
  let a = 0;
  let b = 0;
  let c = 0;
  for (let k = 0; k < ys.taps; k++) {
    const w = ys.wgt[base + k];
    if (w === 0) continue;
    const p = (ys.idx[base + k] - rowMin) * outW * 3 + x * 3;
    a += scratch[p] * w;
    b += scratch[p + 1] * w;
    c += scratch[p + 2] * w;
  }
  pixel[0] = a;
  pixel[1] = b;
  pixel[2] = c;
}

/** Tints `pixel` toward the hairline where it falls on the window's edge. */
function tintEdge(cov, sd, border) {
  const ring = (cov - clamp(0.5 - (sd + border.width), 0, 1)) * border.opacity;
  if (ring <= 0.002) return;
  pixel[0] = lerp(pixel[0], border.color[0], ring);
  pixel[1] = lerp(pixel[1], border.color[1], ring);
  pixel[2] = lerp(pixel[2], border.color[2], ring);
}

/** The vertical pass, masked to the rounded window and blended over `dst`. */
function compositeColumns({ dst, dw, scratch, ys, rowMin, outW, outH, x0, y0, win, border }) {
  const hasEdge = border ? border.width > 0 : false;
  for (let y = 0; y < outH; y++) {
    const base = y * ys.taps;
    const py = y0 + y + 0.5;
    const drow = (y0 + y) * dw;
    for (let x = 0; x < outW; x++) {
      const px = x0 + x + 0.5;
      const sd = sdRoundRect(px, py, win.cx, win.cy, win.hw, win.hh, win.r);
      const cov = clamp(0.5 - sd, 0, 1);
      if (cov <= 0.002) continue;

      sampleColumn(scratch, ys, base, rowMin, outW, x);
      if (hasEdge) tintEdge(cov, sd, border);

      const d = (drow + x0 + x) * 4;
      const keep = 1 - cov;
      dst[d + 0] = clamp(clamp(pixel[0], 0, 255) * cov + dst[d + 0] * keep, 0, 255);
      dst[d + 1] = clamp(clamp(pixel[1], 0, 255) * cov + dst[d + 1] * keep, 0, 255);
      dst[d + 2] = clamp(clamp(pixel[2], 0, 255) * cov + dst[d + 2] * keep, 0, 255);
    }
  }
}

/** The expanding ring a click leaves behind: faint fill, visible edge, fades. */
function drawRipple(dst, dw, dh, px, py, radius, fillA, strokeA, strokeW, color) {
  const reach = radius + strokeW + 2;
  const x0 = Math.max(0, Math.floor(px - reach));
  const y0 = Math.max(0, Math.floor(py - reach));
  const x1 = Math.min(dw, Math.ceil(px + reach));
  const y1 = Math.min(dh, Math.ceil(py + reach));
  const half = strokeW / 2;

  for (let y = y0; y < y1; y++) {
    const ddy = y + 0.5 - py;
    for (let x = x0; x < x1; x++) {
      const ddx = x + 0.5 - px;
      const dist = Math.sqrt(ddx * ddx + ddy * ddy);
      const inside = clamp(0.5 - (dist - radius), 0, 1);
      const ring = clamp(0.5 - (Math.abs(dist - radius) - half), 0, 1);
      const a = inside * fillA + ring * strokeA * (1 - inside * fillA);
      if (a <= 0.002) continue;
      const d = (y * dw + x) * 4;
      const keep = 1 - a;
      dst[d + 0] = clamp(color[0] * a + dst[d + 0] * keep, 0, 255);
      dst[d + 1] = clamp(color[1] * a + dst[d + 1] * keep, 0, 255);
      dst[d + 2] = clamp(color[2] * a + dst[d + 2] * keep, 0, 255);
    }
  }
}

// -------------------------------------------------------------------- tracks

/** The four-keyframe zoom one beat asks for, or none when it does not zoom. */
function zoomGroupsFor(b, cfg) {
  if (b.x == null || b.y == null) return [];
  const z = b.zoom == null ? cfg.default : b.zoom;
  if (!(z > 1.0001)) return [];
  const lead = b.lead == null ? cfg.lead : b.lead;
  // Every zoom travels at the same rate: the ease lasts as long as the zoom
  // is deep. A 1.4x and a 1.9x on the same video then read as one camera.
  const rate = Math.log(z) / Math.log(Math.max(1.0001, cfg.default));
  const rampIn = (b.in == null ? cfg.in : b.in) * rate;
  const peak = b.t - lead;
  const holdEnd = b.t + (b.hold == null ? cfg.hold : b.hold);
  return [
    {
      rampIn: peak - rampIn,
      peak,
      holdEnd,
      rampOut: holdEnd + (b.out == null ? cfg.out : b.out) * rate,
      z,
      cx: b.zoomAt ? b.zoomAt.x : b.x,
      cy: b.zoomAt ? b.zoomAt.y : b.y,
    },
  ];
}

/** When two zooms overlap before the first returns, both 1x keyframes drop. */
function zoomKeyframes(groups, midX, midY) {
  const kf = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const prev = groups[i - 1];
    const next = groups[i + 1];
    const joinBefore = prev && prev.rampOut > g.rampIn;
    const joinAfter = next && g.rampOut > next.rampIn;
    const holdEnd = joinAfter ? Math.min(g.holdEnd, next.peak - 0.08) : g.holdEnd;

    if (!joinBefore) kf.push({ t: g.rampIn, z: 1, cx: midX, cy: midY });
    kf.push({ t: g.peak, z: g.z, cx: g.cx, cy: g.cy });
    kf.push({ t: Math.max(holdEnd, g.peak + 0.02), z: g.z, cx: g.cx, cy: g.cy });
    if (!joinAfter) kf.push({ t: g.rampOut, z: 1, cx: midX, cy: midY });
  }
  return kf;
}

/**
 * Turns the beats into camera keyframes. Each zoomed beat contributes four:
 * leave 1x, reach the target zoom, hold, return to 1x. When two beats overlap
 * before the first returns, both 1x keyframes drop and the camera pans straight between them.
 */
function buildCameraTrack(beats, cfg, duration, midX, midY) {
  const groups = beats.flatMap((b) => zoomGroupsFor(b, cfg));
  const kf = zoomKeyframes(groups, midX, midY);
  if (kf.length === 0) return () => ({ z: 1, cx: midX, cy: midY });

  kf.sort((a, b) => a.t - b.t);
  for (let i = 1; i < kf.length; i++) {
    if (kf[i].t <= kf[i - 1].t) kf[i].t = kf[i - 1].t + 0.001;
  }
  kf.unshift({ t: Math.min(-1, kf[0].t - 1), z: 1, cx: midX, cy: midY });
  const last = kf[kf.length - 1];
  kf.push({ t: Math.max(duration + 1, last.t + 1), z: 1, cx: midX, cy: midY });

  let cursor = 0;
  return (t) => {
    while (cursor > 0 && t < kf[cursor].t) cursor--;
    while (cursor < kf.length - 2 && t >= kf[cursor + 1].t) cursor++;
    const a = kf[cursor];
    const b = kf[cursor + 1];
    const u = clamp((t - a.t) / (b.t - a.t), 0, 1);
    const e = easeInOutCubic(u);
    return {
      // Zoom reads as constant speed when interpolated in log space.
      z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), e)),
      cx: lerp(a.cx, b.cx, e),
      cy: lerp(a.cy, b.cy, e),
    };
  };
}

/** Seconds the source is held before this beat's click, 0 for most beats. */
const pauseBefore = (b) => (typeof b.pause === "number" ? b.pause : (b.pause?.before ?? 0));

/**
 * One cursor move to a beat. Travel time comes from the distance, so the
 * cursor keeps one speed. A beat with a `pause` has the cursor on target for
 * the whole pause; every other beat arrives `settle` early and no earlier.
 */
function cursorMoveTo({ b, at, freeFrom, cfg }) {
  const dist = Math.hypot(b.x - at.x, b.y - at.y);
  const travel =
    b.travel != null ? b.travel : clamp(dist / cfg.speed, cfg.minTravel, cfg.maxTravel);
  const latest = b.t - cfg.settle;
  const wanted = latest - pauseBefore(b);
  const arrive = clamp(wanted, Math.min(freeFrom + travel, latest), latest);
  const depart = Math.min(Math.max(arrive - travel, freeFrom), arrive);
  // The hand only appears where there is something to click.
  const handAfter = b.click !== false;
  const arc = b.arc == null ? cfg.arc : b.arc;
  return { depart, arrive, from: at, to: { x: b.x, y: b.y }, handAfter, arc };
}

/** The cursor's moves, clicks and visibility keys, in beat order. */
function planCursor(beats, cfg) {
  const moves = [];
  const clicks = [];
  const vis = [{ t: -1, a: cfg.start.hidden ? 0 : 1 }];
  let at = { x: cfg.start.x, y: cfg.start.y };
  let freeFrom = 0;

  for (const b of beats) {
    if (b.hide || b.show) {
      vis.push({ t: b.t, a: b.hide ? 0 : 1 });
      continue;
    }
    if (b.x == null || b.y == null || b.cursor === false) continue;
    const move = cursorMoveTo({ b, at, freeFrom, cfg });
    moves.push(move);
    if (move.handAfter) clicks.push({ t: b.t, x: b.x, y: b.y });
    at = move.to;
    // The hand stays down for the whole press. Leaving earlier turns it back
    // into an arrow while the ripple is still expanding under it.
    freeFrom = b.t + (move.handAfter ? cfg.press.duration : 0);
  }
  vis.sort((a, b) => a.t - b.t);
  return { moves, clicks, vis };
}

/**
 * A point along a move. A slight perpendicular bow keeps the path from looking
 * mechanical; a beat sets `arc: 0` when it wants a ruled line.
 */
function pointAlong(m, t) {
  const span = m.arrive - m.depart;
  const u = span <= 0 ? 1 : easeInOutCubic((t - m.depart) / span);
  const dx = m.to.x - m.from.x;
  const dy = m.to.y - m.from.y;
  const len = Math.hypot(dx, dy) || 1;
  const bow = m.arc * len;
  const mx = (m.from.x + m.to.x) / 2 - (dy / len) * bow;
  const my = (m.from.y + m.to.y) / 2 + (dx / len) * bow;
  const iu = 1 - u;
  return {
    x: iu * iu * m.from.x + 2 * iu * u * mx + u * u * m.to.x,
    y: iu * iu * m.from.y + 2 * iu * u * my + u * u * m.to.y,
  };
}

function cursorPositionAt({ moves, start, t }) {
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (t < m.depart) {
      const prev = moves[i - 1];
      return { p: m.from, hand: prev ? prev.handAfter : false };
    }
    if (t <= m.arrive) return { p: pointAlong(m, t), hand: false };
  }
  const lastMove = moves[moves.length - 1];
  return { p: lastMove ? lastMove.to : start, hand: lastMove ? lastMove.handAfter : false };
}

function cursorAlphaAt({ vis, fade, t }) {
  let a = vis[0].a;
  for (let i = 1; i < vis.length; i++) {
    const k = vis[i];
    if (t >= k.t) {
      a = k.a;
      continue;
    }
    const u = clamp((t - (k.t - fade)) / fade, 0, 1);
    return lerp(vis[i - 1].a, k.a, easeInOutCubic(u));
  }
  return a;
}

/** The click dip: in fast, back gently. */
function pressScaleAt({ clicks, press, t }) {
  const c = clicks.find((click) => t >= click.t && t <= click.t + press.duration);
  if (!c) return 1;
  const u = (t - c.t) / press.duration;
  return 1 - (1 - press.scale) * Math.sin(Math.PI * easeOutCubic(u));
}

function ripplesAt({ clicks, t, cfg2 }) {
  const out = [];
  for (const c of clicks) {
    const u = (t - c.t) / cfg2.duration;
    if (u < 0 || u > 1) continue;
    const e = easeOutCubic(u);
    out.push({
      x: c.x,
      y: c.y,
      radius: lerp(cfg2.radius[0], cfg2.radius[1], e),
      fill: cfg2.fill * (1 - u),
      stroke: cfg2.stroke * (1 - u),
    });
  }
  return out;
}

/**
 * Turns the beats into the cursor's path, its arrow-or-hand state, the click
 * dip, the click ripples and its visibility.
 */
function buildCursorTrack(beats, cfg) {
  const { moves, clicks, vis } = planCursor(beats, cfg);
  return {
    at: (t) => {
      const { p, hand } = cursorPositionAt({ moves, start: cfg.start, t });
      const scale = pressScaleAt({ clicks, press: cfg.press, t });
      return { x: p.x, y: p.y, hand, scale, alpha: cursorAlphaAt({ vis, fade: cfg.fade, t }) };
    },
    ripples: (t, cfg2) => ripplesAt({ clicks, t, cfg2 }),
  };
}

const pauseOf = (b) => ({
  before: pauseBefore(b),
  after: typeof b.pause === "number" ? 0 : (b.pause?.after ?? 0),
});

/** Adds a freeze at source time `c`; negative is a skip, so the guard is on magnitude. */
function insertFreeze(freezes, c, d) {
  if (!(Math.abs(d) > 0.005)) return;
  const hit = freezes.find((f) => Math.abs(f.c - c) < 1e-6);
  if (hit) {
    hit.d += d;
    return;
  }
  freezes.push({ c, d });
  freezes.sort((a, b) => a.c - b.c);
}

function outputTimeOf(freezes, c) {
  let acc = 0;
  for (const f of freezes) {
    if (!(f.c < c - 1e-9)) break;
    acc += f.d;
  }
  return c + acc;
}

function sourceTimeOf(freezes, o) {
  let acc = 0;
  for (const f of freezes) {
    const start = f.c + acc;
    if (o < start) return o - acc;
    if (f.d > 0 && o < start + f.d) return f.c;
    acc += f.d;
  }
  return o - acc;
}

/**
 * The click lands at the end of its own `before` freeze, so the frame the
 * viewer waits on is the one before anything happened.
 */
const beatOutputTime = (freezes, b) =>
  outputTimeOf(freezes, b.t) + (b.x == null ? 0 : pauseOf(b).before);

/** Freezes the source wherever the cursor would have to move faster than `pace.speed`. */
function autoPace({ beats, pace, cursorCfg, freezes }) {
  const path = beats.filter((b) => b.x != null && b.cursor !== false);
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const b = path[i];
    const press = a.click === false ? 0 : cursorCfg.press.duration;
    const travel = Math.hypot(b.x - a.x, b.y - a.y) / pace.speed;
    const need = travel + cursorCfg.settle + pauseBefore(b) + press + pace.dwell;
    const short = need - (beatOutputTime(freezes, b) - beatOutputTime(freezes, a));
    if (short > 0.005) insertFreeze(freezes, Math.min(a.t + pace.afterDelay, b.t - 0.05), short);
  }
}

/**
 * Freezes the source frame wherever the cursor would move faster than a
 * viewer can follow, mapping source and output clocks — `pause: { before,
 * after }` asks for one; `skip: 1.2` drops dead air before a beat instead.
 */
function buildPacing(beats, pace, cursorCfg) {
  const freezes = [];
  for (const b of beats) {
    if (b.x == null) continue;
    const { before, after } = pauseOf(b);
    // A skip is a freeze of negative length: the source jumps forward instead
    // of standing still, and every clock below already handles the sign.
    if (b.skip > 0) insertFreeze(freezes, b.t - b.skip, -b.skip);
    insertFreeze(freezes, b.t, before);
    insertFreeze(freezes, b.t + pace.afterDelay, after);
  }
  if (pace.auto) autoPace({ beats, pace, cursorCfg, freezes });

  const total = freezes.reduce((sum, f) => sum + f.d, 0);
  return {
    total,
    freezes,
    outOf: (c) => outputTimeOf(freezes, c),
    srcOf: (o) => sourceTimeOf(freezes, o),
    timeOf: (b) => beatOutputTime(freezes, b),
  };
}

// ------------------------------------------------------------------ raw frames

async function* readFrames(stream, bytes) {
  const parts = [];
  let have = 0;
  for await (const chunk of stream) {
    parts.push(chunk);
    have += chunk.length;
    while (have >= bytes) {
      const all = parts.length === 1 ? parts[0] : Buffer.concat(parts, have);
      parts.length = 0;
      yield all.subarray(0, bytes);
      const rest = all.subarray(bytes);
      have = rest.length;
      if (have) parts.push(rest);
    }
  }
}

/**
 * Rebuilds the raw take's cut list as a filter, so the polish is one pass and
 * the video is encoded once. Trims use the `trim` filter rather than input
 * seeking, which is only accurate on a keyframe.
 */
function cutFilter(cut) {
  const parts = [];
  let labels = "";
  cut.segments.forEach((seg, i) => {
    const [start, end] = seg;
    parts.push(
      `[0:v]trim=start=${start}:end=${end},setpts=(PTS-STARTPTS)/${segmentSpeed(cut, seg)}[c${i}];`,
    );
    labels += `[c${i}]`;
  });
  parts.push(`${labels}concat=n=${cut.segments.length}:v=1:a=0[cat];`);
  parts.push(`[cat]setpts=PTS[s];`);
  return parts.join("");
}

/**
 * How fast one segment runs. A third number on a segment overrides `speed` for
 * that stretch, which is how a beat opens at 2x and then follows a long live
 * run at 3x without a second encode.
 */
function segmentSpeed(cut, [, , speed]) {
  return speed || cut.speed || 1;
}

/** Seconds one segment lasts in the cut result. */
function segmentDuration(cut, seg) {
  return (seg[1] - seg[0]) / segmentSpeed(cut, seg);
}

/** Maps a second of the raw take onto its second in the cut result. */
function mapCutTime(cut, tRaw) {
  let acc = 0;
  for (const seg of cut.segments) {
    if (tRaw < seg[0]) break;
    if (tRaw <= seg[1]) return acc + (tRaw - seg[0]) / segmentSpeed(cut, seg);
    acc += segmentDuration(cut, seg);
  }
  return acc;
}

// ----------------------------------------------------------------------- main

function parseArgs(argv) {
  const out = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) out[a.slice(2)] = argv[++i];
    else out._.push(a);
  }
  return out;
}

const DEFAULTS = {
  fps: 30,
  frame: {
    background: "backgrounds/default.webp",
    // "native" draws the recording at one output pixel per source pixel at 1x,
    // which is the sharpest the take can be. A number is a fraction of the
    // output width instead.
    fit: "native",
    radius: 13,
    // How far the camera follows the focus point (1 = locks on target, 0 =
    // window stays centred). See README.md "follow" for the zoom-path tradeoff.
    follow: 1,
    shadow: { blur: 44, offsetX: 0, offsetY: 20, spread: 2, opacity: 0.3 },
    border: { width: 1, color: [255, 255, 255], opacity: 0.45 },
  },
  cursor: {
    arrow: "cursors/arrow.svg",
    pointer: "cursors/pointer.svg",
    size: 128,
    hotspot: { arrow: { x: 0.293, y: 0.175 }, pointer: { x: 0.383, y: 0.243 } },
    shadow: { blur: 14, offsetX: 1, offsetY: 6, opacity: 0.38 },
    // Travel time comes from the distance, so a long move is never rushed
    // and a short one is never sluggish. A beat may override it.
    speed: 850,
    minTravel: 0.45,
    maxTravel: 1.5,
    settle: 0.14,
    arc: 0.08,
    fade: 0.3,
    press: { scale: 0.84, duration: 0.16 },
    start: { x: null, y: null, hidden: false },
  },
  click: {
    radius: [6, 42],
    duration: 0.55,
    fill: 0.05,
    stroke: 0.3,
    strokeWidth: 2,
    color: [86, 86, 86],
  },
  // `lead` puts the camera at full zoom before the click, never during it.
  // `in` and `out` are the ease durations at `default`; a weaker zoom takes
  // proportionally less time, so every zoom in a video moves at one speed.
  zoom: { default: 1.9, lead: 0.5, in: 0.62, out: 0.8, hold: 0.8 },
  // Freezes the source frame so the camera and the cursor have time to move.
  // `auto` inserts a freeze wherever the cursor would have to travel faster
  // than `speed`; a beat's own `pause` block adds one on top.
  pace: { auto: true, speed: 850, dwell: 0.3, afterDelay: 0.35 },
  quality: { crf: 38, cpuUsed: 2 },
};

function merge(base, over) {
  if (over == null) return base;
  if (Array.isArray(base) || Array.isArray(over) || typeof base !== "object") return over;
  const out = { ...base };
  for (const k of Object.keys(over)) out[k] = merge(base[k], over[k]);
  return out;
}

/** The timeline, resolved against where it lives, and the source's probed metadata. */
async function readTimeline(args) {
  const timelinePath = args._[0];
  if (!timelinePath) {
    console.error("usage: polish-recording.mjs <timeline.json> [options]");
    process.exit(2);
  }

  const here = path.dirname(new URL(import.meta.url).pathname);
  const base = path.dirname(path.resolve(timelinePath));
  // A bare `cursors/...`, `backgrounds/...` path means the assets shipped next
  // to this script; anything else resolves against the timeline.
  const asset = (p) => {
    if (/^(cursors|backgrounds)\//.test(p)) return path.join(here, p);
    if (path.isAbsolute(p)) return p;
    return path.resolve(base, p);
  };
  const rel = (p) => (path.isAbsolute(p) ? p : path.resolve(base, p));
  const cfg = merge(DEFAULTS, JSON.parse(fs.readFileSync(timelinePath, "utf8")));

  const input = rel(cfg.input);
  const output = args.out ? path.resolve(args.out) : rel(cfg.output);
  return { cfg, asset, input, output, meta: await probe(input) };
}

/** Source, page and output sizes, and the page-to-source scale. */
function frameGeometry(cfg, meta) {
  const srcW = meta.width;
  const srcH = meta.height;
  const pageW = cfg.page?.width ?? srcW;
  const pageH = cfg.page?.height ?? srcH;
  const outW = cfg.size?.width ?? srcW;
  const outH = cfg.size?.height ?? srcH;
  if (outW % 2 || outH % 2) throw new Error("output width and height must be even");
  return { srcW, srcH, pageW, pageH, sx: srcW / pageW, sy: srcH / pageH, outW, outH };
}

/** Beats may be timed against the raw take or against the finished cut. */
function scaledBeats(cfg, { sx, sy }) {
  return cfg.beats
    .map((b) => ({
      ...b,
      t: b.t != null ? b.t : mapCutTime(cfg.cut, b.tRaw),
      x: b.x == null ? null : b.x * sx,
      y: b.y == null ? null : b.y * sy,
      zoomAt: b.zoomAt ? { x: b.zoomAt.x * sx, y: b.zoomAt.y * sy } : null,
    }))
    .toSorted((a, b) => a.t - b.t);
}

function cursorConfig(cfg, { pageW, pageH, sx, sy }) {
  return {
    ...cfg.cursor,
    start: {
      x: (cfg.cursor.start.x ?? pageW * 0.5) * sx,
      y: (cfg.cursor.start.y ?? pageH * 0.5) * sy,
      hidden: !!cfg.cursor.start.hidden,
    },
  };
}

async function loadSprites({ args, cfg, asset, geo }) {
  const bgPath = args.background ? path.resolve(args.background) : asset(cfg.frame.background);
  const [background, arrowBmp, pointerBmp] = await Promise.all([
    loadImageCover(bgPath, geo.outW, geo.outH),
    rasterize(asset(cfg.cursor.arrow), cfg.cursor.size),
    rasterize(asset(cfg.cursor.pointer), cfg.cursor.size),
  ]);
  return {
    background,
    arrow: buildSprite(arrowBmp, cfg.cursor.hotspot.arrow, cfg.cursor.shadow),
    pointer: buildSprite(pointerBmp, cfg.cursor.hotspot.pointer, cfg.cursor.shadow),
  };
}

function logPacing(pacing, srcDuration, duration) {
  if (!pacing.freezes.length) return;
  const list = pacing.freezes
    .map((f) => `${f.c.toFixed(2)}${f.d > 0 ? "+" : ""}${f.d.toFixed(2)}`)
    .join(" ");
  console.log(`  pacing: ${srcDuration.toFixed(2)}s -> ${duration.toFixed(2)}s  [${list}]`);
}

/**
 * The output frames to render. `--preview` is stated in seconds of the result,
 * so the range has to be mapped back through the pacing before it becomes a
 * trim on the source.
 */
function outputRange({ args, pacing, duration, srcDuration, fps }) {
  const preview = args.preview ? args.preview.split(":").map(Number) : null;
  const outStart = preview ? Math.max(0, preview[0]) : 0;
  const outEnd = preview ? Math.min(preview[1], duration) : duration;
  return {
    preview,
    outStart,
    srcStart: pacing.srcOf(outStart),
    srcEnd: Math.min(srcDuration, pacing.srcOf(outEnd) + 2 / fps),
    frames: Math.max(1, Math.round((outEnd - outStart) * fps)),
  };
}

/**
 * The graph always ends in `fps`, and the output always states `-r`. A bare
 * `setpts` before the end leaves ffmpeg guessing the rate from timestamps,
 * and it guesses the source's rate, silently dropping frames.
 */
function decodeGraph(cut, range, fps) {
  const graph = cut ? cutFilter(cut) : "[0:v]null[s];";
  if (!range.preview) return `${graph}[s]fps=${fps}[out]`;
  return (
    `${graph}[s]trim=start=${range.srcStart}:end=${range.srcEnd},setpts=PTS-STARTPTS[p];` +
    `[p]fps=${fps}[out]`
  );
}

/**
 * An ffmpeg child with its stderr kept. `close` is attached now, not after the
 * loop: a process that has already closed never emits `close` again, and
 * awaiting it then would let node exit silently.
 */
function spawnFfmpeg(argv, stdio) {
  const child = spawn("ffmpeg", argv, { stdio });
  const errors = [];
  child.stderr.on("data", (c) => errors.push(c));
  return { child, errors, done: once(child, "close") };
}

function decoderArgs({ input, graph, fps }) {
  return [
    "-v",
    "error",
    "-i",
    input,
    "-filter_complex",
    graph,
    "-map",
    "[out]",
    "-r",
    String(fps),
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-",
  ];
}

function encoderArgs({ output, geo, fps, crf, cpuUsed }) {
  return [
    "-v",
    "error",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgba",
    "-s",
    `${geo.outW}x${geo.outH}`,
    "-r",
    String(fps),
    "-i",
    "-",
    "-an",
    "-c:v",
    "libvpx-vp9",
    "-b:v",
    "0",
    "-crf",
    String(crf),
    "-deadline",
    "good",
    "-cpu-used",
    String(cpuUsed),
    "-row-mt",
    "1",
    "-pix_fmt",
    "yuv420p",
    "-y",
    output,
  ];
}

/**
 * The source is pulled, not iterated: a frozen stretch asks for the same
 * source frame over several output frames, so the decoder only advances
 * when the output clock has moved past the next source frame.
 */
function sourceReader(stream, bytes) {
  const source = readFrames(stream, bytes)[Symbol.asyncIterator]();
  const state = { index: -1, frame: null, drained: false };
  return {
    state,
    async advanceTo(want) {
      while (!state.drained && state.index < want) {
        const next = await source.next();
        if (next.done) {
          state.drained = true;
          break;
        }
        state.frame = next.value;
        state.index++;
      }
      return state.frame;
    },
  };
}

// Two candidate positions: the window centred in the frame, and the window
// placed so the focus point is dead centre. `follow` blends them, and both are
// straight functions of the zoom, so the path has no kink. Clamping the window
// against the recording's edge put a kink in one axis: the page tilted and snapped back.
function windowAt({ cam, scene }) {
  const { cfg, geo } = scene;
  const scale = scene.baseScale * cam.z;
  const winW = geo.srcW * scale;
  const winH = geo.srcH * scale;
  const left = lerp((geo.outW - winW) / 2, geo.outW / 2 - cam.cx * scale, cfg.frame.follow);
  const top = lerp((geo.outH - winH) / 2, geo.outH / 2 - cam.cy * scale, cfg.frame.follow);
  return {
    left,
    top,
    scale,
    cx: left + winW / 2,
    cy: top + winH / 2,
    hw: winW / 2,
    hh: winH / 2,
    r: cfg.frame.radius * scale,
  };
}

function renderFrame({ scene, frame, t }) {
  const { cfg, geo, cursor } = scene;
  const { outW, outH } = geo;
  const win = windowAt({ cam: scene.cameraAt(t), scene });
  const { left, top, scale } = win;

  const dst = Buffer.allocUnsafe(outW * outH * 4);
  scene.background.copy(dst);
  drawShadow(dst, outW, outH, win, cfg.frame.shadow);
  drawWindow(dst, outW, outH, frame, geo.srcW, geo.srcH, win, cfg.frame.border, scene.scratchRef);

  for (const r of cursor.ripples(t, cfg.click)) {
    drawRipple(
      dst,
      outW,
      outH,
      left + r.x * scale,
      top + r.y * scale,
      r.radius,
      r.fill,
      r.stroke,
      cfg.click.strokeWidth,
      cfg.click.color,
    );
  }

  const c = cursor.at(t);
  if (c.alpha > 0.002) {
    const sprite = c.hand ? scene.pointer : scene.arrow;
    drawSprite(dst, outW, outH, sprite, left + c.x * scale, top + c.y * scale, c.scale, c.alpha);
  }
  return dst;
}

/** Renders every frame in the range into the encoder; answers how many it wrote. */
async function encodeFrames({ scene, range, reader, encoder, fps }) {
  let n = 0;
  const started = Date.now();
  for (let i = 0; i < range.frames; i++) {
    const t = range.outStart + i / fps;
    const want = Math.max(0, Math.round((scene.pacing.srcOf(t) - range.srcStart) * fps));
    const frame = await reader.advanceTo(want);
    if (!frame) break;
    if (!encoder.stdin.write(renderFrame({ scene, frame, t }))) await once(encoder.stdin, "drain");
    n++;
    if (n % 60 === 0) {
      const rate = n / ((Date.now() - started) / 1000);
      process.stderr.write(`\r  frame ${n}  ${rate.toFixed(1)} fps  ${(n / fps).toFixed(1)}s`);
    }
  }
  return n;
}

async function awaitCoders({ decoder, encoder, drained }) {
  encoder.child.stdin.end();
  if (!drained) {
    decoder.child.stdout.destroy();
    decoder.child.kill("SIGKILL");
  }
  const [decCode] = await decoder.done;
  const [encCode] = await encoder.done;
  process.stderr.write("\r".padEnd(60) + "\r");

  if (drained && decCode !== 0) {
    throw new Error(`decoder failed\n${Buffer.concat(decoder.errors).toString("utf8")}`);
  }
  if (encCode !== 0) {
    throw new Error(`encoder failed\n${Buffer.concat(encoder.errors).toString("utf8")}`);
  }
}

async function reportOutput(output, frames) {
  const result = await probe(output);
  const size = fs.statSync(output).size;
  console.log(
    `${path.relative(process.cwd(), output)}  ` +
      `${result.duration.toFixed(2)}s  ${(size / 1024 / 1024).toFixed(2)} MB  ` +
      `${result.width}x${result.height}  ${frames} frames`,
  );
}

async function writeStills(args, output) {
  if (!args.stills) return;
  const dir = args["stills-dir"]
    ? path.resolve(args["stills-dir"])
    : path.join(path.dirname(output), "stills");
  fs.mkdirSync(dir, { recursive: true });
  for (const s of args.stills.split(",").map((v) => v.trim())) {
    const file = path.join(dir, `t${s.replace(".", "_")}.png`);
    await run("ffmpeg", ["-v", "error", "-ss", s, "-i", output, "-frames:v", "1", "-y", file]);
  }
  console.log(`stills: ${path.relative(process.cwd(), dir)}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { cfg, asset, input, output, meta } = await readTimeline(args);
  const geo = frameGeometry(cfg, meta);
  const fps = cfg.fps;
  const beats = scaledBeats(cfg, geo);
  const cursorCfg = cursorConfig(cfg, geo);
  const sprites = await loadSprites({ args, cfg, asset, geo });

  const srcDuration = cfg.cut
    ? cfg.cut.segments.reduce((a, seg) => a + segmentDuration(cfg.cut, seg), 0)
    : meta.duration;

  // Beats are authored against the source clock. Pacing freezes the source
  // where a move would be too fast to follow, which moves every later beat.
  const pacing = buildPacing(beats, cfg.pace, cursorCfg);
  for (const b of beats) b.t = pacing.timeOf(b);
  const duration = srcDuration + pacing.total;
  logPacing(pacing, srcDuration, duration);

  const scene = {
    cfg,
    geo,
    pacing,
    ...sprites,
    cameraAt: buildCameraTrack(beats, cfg.zoom, duration, geo.srcW / 2, geo.srcH / 2),
    cursor: buildCursorTrack(beats, cursorCfg),
    baseScale: cfg.frame.fit === "native" ? 1 : (geo.outW * cfg.frame.fit) / geo.srcW,
    scratchRef: { buf: new Float32Array(1) },
  };

  const range = outputRange({ args, pacing, duration, srcDuration, fps });
  const graph = decodeGraph(cfg.cut, range, fps);
  const decoder = spawnFfmpeg(decoderArgs({ input, graph, fps }), ["ignore", "pipe", "pipe"]);
  fs.mkdirSync(path.dirname(output), { recursive: true });
  const crf = args.crf ?? cfg.quality.crf;
  const encoderArgv = encoderArgs({ output, geo, fps, crf, cpuUsed: cfg.quality.cpuUsed });
  const encoder = spawnFfmpeg(encoderArgv, ["pipe", "ignore", "pipe"]);

  const reader = sourceReader(decoder.child.stdout, geo.srcW * geo.srcH * 4);
  const frames = await encodeFrames({ scene, range, reader, encoder: encoder.child, fps });
  await awaitCoders({ decoder, encoder, drained: reader.state.drained });
  await reportOutput(output, frames);
  await writeStills(args, output);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
