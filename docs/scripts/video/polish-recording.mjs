#!/usr/bin/env node
/**
 * Screen Studio style polish for a docs screen recording.
 *
 *   node docs/scripts/video/polish-recording.mjs <timeline.json> [options]
 *
 * READ THE GUIDE BEFORE YOU AUTHOR A TIMELINE:
 * https://nexus.langwatch.ai/wiki/recording-video-for-docs
 *
 * That page carries the rules this script cannot enforce: how many zooms a
 * video can take before it is unwatchable, which targets earn one, when to pan
 * instead of zooming out and back in, and how to record a take that the polish
 * step can use. `README.md` next to this file is the format reference. The
 * guide is the judgement.
 *
 * What it renders, per frame:
 *
 *   background image  ->  soft shadow  ->  the recording, as a rounded window
 *                     ->  the click ripple  ->  the cursor
 *
 * The camera puts the click target at the centre of the frame and zooms
 * uniformly around it, so the window slides off the canvas and the background
 * fills what is left. That is the point of the background: it is what lets the
 * camera track the cursor instead of being pinned inside the recording.
 *
 * It reads the take through ffmpeg, composites every frame in plain
 * JavaScript, and writes the result back through ffmpeg. The only external
 * programs are `ffmpeg`, `ffprobe` and `rsvg-convert`, so there is nothing to
 * install from npm.
 *
 * Options:
 *   --out PATH          write here instead of the timeline's `output`
 *   --background PATH   override the background image
 *   --preview A:B       render only seconds A to B of the result (fast loop)
 *   --stills "1,4,8.5"  after encoding, write a PNG per listed second
 *   --stills-dir DIR    where those PNGs go (default: next to the output)
 *   --crf N             override the encoder quality (lower is better)
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// --------------------------------------------------------------------- easing

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (x) => x * x * (3 - 2 * x);

/** Slow at both ends, quick through the middle. The default for everything. */
const easeInOutCubic = (x) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

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
        reject(new Error(`${cmd} exited ${code}\n${Buffer.concat(err)}`));
        return;
      }
      resolve(Buffer.concat(out));
    });
  });
}

async function probe(file) {
  const raw = await run("ffprobe", [
    "-v", "error",
    "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate:format=duration",
    "-of", "json",
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
    "-v", "error",
    "-i", file,
    "-vf", `scale=${w}:${h}:force_original_aspect_ratio=increase:flags=lanczos,crop=${w}:${h}`,
    "-frames:v", "1",
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-",
  ]);
  if (data.length !== w * h * 4) {
    throw new Error(`background decoded to ${data.length} bytes, expected ${w * h * 4}`);
  }
  return data;
}

// ------------------------------------------------------------------- cursors

/**
 * Renders an SVG to an RGBA bitmap of the requested height.
 *
 * rsvg-convert writes PNG, and node cannot decode PNG on its own, so ffmpeg
 * turns the PNG into raw RGBA. Both are already required by the rest of the
 * script, which is why this takes two processes instead of a library.
 */
async function rasterize(svgPath, height) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "polish-cursor-"));
  const tmp = path.join(dir, "c.png");
  await run("rsvg-convert", ["-h", String(Math.round(height)), svgPath, "-o", tmp]);
  const meta = await probe(tmp);
  const rgba = await run("ffmpeg", [
    "-v", "error", "-i", tmp, "-f", "rawvideo", "-pix_fmt", "rgba", "-",
  ]);
  fs.rmSync(dir, { recursive: true, force: true });
  return { width: meta.width, height: meta.height, data: rgba };
}

/** Three box passes approximate a Gaussian closely enough for a drop shadow. */
function blurAlpha(src, w, h, radius) {
  if (radius < 1) return src;
  let a = src;
  let b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      let sum = 0;
      for (let x = -radius; x <= radius; x++) sum += a[row + clamp(x, 0, w - 1)];
      const norm = 1 / (radius * 2 + 1);
      for (let x = 0; x < w; x++) {
        b[row + x] = sum * norm;
        sum += a[row + clamp(x + radius + 1, 0, w - 1)];
        sum -= a[row + clamp(x - radius, 0, w - 1)];
      }
    }
    const t = a;
    a = new Float32Array(w * h);
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -radius; y <= radius; y++) sum += b[clamp(y, 0, h - 1) * w + x];
      const norm = 1 / (radius * 2 + 1);
      for (let y = 0; y < h; y++) {
        a[y * w + x] = sum * norm;
        sum += b[clamp(y + radius + 1, 0, h - 1) * w + x];
        sum -= b[clamp(y - radius, 0, h - 1) * w + x];
      }
    }
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
    Math.ceil(shadow.blur * 2) +
    Math.ceil(Math.abs(shadow.offsetX) + Math.abs(shadow.offsetY)) + 2;
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

  for (let y = y0; y < y1; y++) {
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

  let rowMin = sh;
  let rowMax = 0;
  for (let i = 0; i < ys.idx.length; i++) {
    const r = ys.idx[i];
    if (r < rowMin) rowMin = r;
    if (r > rowMax) rowMax = r;
  }
  const rows = rowMax - rowMin + 1;
  const need = rows * outW * 3;
  if (scratchRef.buf.length < need) scratchRef.buf = new Float32Array(need);
  const scratch = scratchRef.buf;

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

  const yt = ys.taps;
  const bw = border ? border.width : 0;
  for (let y = 0; y < outH; y++) {
    const base = y * yt;
    const py = y0 + y + 0.5;
    const drow = (y0 + y) * dw;
    for (let x = 0; x < outW; x++) {
      const px = x0 + x + 0.5;
      const sd = sdRoundRect(px, py, win.cx, win.cy, win.hw, win.hh, win.r);
      const cov = clamp(0.5 - sd, 0, 1);
      if (cov <= 0.002) continue;

      let a = 0;
      let b = 0;
      let c = 0;
      for (let k = 0; k < yt; k++) {
        const w = ys.wgt[base + k];
        if (w === 0) continue;
        const p = (ys.idx[base + k] - rowMin) * outW * 3 + x * 3;
        a += scratch[p] * w;
        b += scratch[p + 1] * w;
        c += scratch[p + 2] * w;
      }

      if (bw > 0) {
        const ring = (cov - clamp(0.5 - (sd + bw), 0, 1)) * border.opacity;
        if (ring > 0.002) {
          a = lerp(a, border.color[0], ring);
          b = lerp(b, border.color[1], ring);
          c = lerp(c, border.color[2], ring);
        }
      }

      const d = (drow + x0 + x) * 4;
      const keep = 1 - cov;
      dst[d + 0] = clamp(clamp(a, 0, 255) * cov + dst[d + 0] * keep, 0, 255);
      dst[d + 1] = clamp(clamp(b, 0, 255) * cov + dst[d + 1] * keep, 0, 255);
      dst[d + 2] = clamp(clamp(c, 0, 255) * cov + dst[d + 2] * keep, 0, 255);
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

/**
 * Turns the beats into camera keyframes and returns a lookup.
 *
 * Each zoomed beat contributes four keyframes: leave 1x, reach the target zoom
 * before the click, hold, return to 1x. At 1x the camera sits on the middle of
 * the recording; zoomed, it sits on the focus point, so zooming in and panning
 * to the target are one movement.
 *
 * When two beats are close enough that the second starts before the first has
 * returned, both 1x keyframes are dropped and the camera pans straight from
 * one focus point to the next. That is the rule for a corner target followed
 * by a central one: zoom once, then move.
 */
function buildCameraTrack(beats, cfg, duration, midX, midY) {
  const groups = [];
  for (const b of beats) {
    if (b.x == null || b.y == null) continue;
    const z = b.zoom == null ? cfg.default : b.zoom;
    if (!(z > 1.0001)) continue;
    const lead = b.lead == null ? cfg.lead : b.lead;
    const rampIn = b.in == null ? cfg.in : b.in;
    const peak = b.t - lead;
    const holdEnd = b.t + (b.hold == null ? cfg.hold : b.hold);
    groups.push({
      rampIn: peak - rampIn,
      peak,
      holdEnd,
      rampOut: holdEnd + (b.out == null ? cfg.out : b.out),
      z,
      cx: b.zoomAt ? b.zoomAt.x : b.x,
      cy: b.zoomAt ? b.zoomAt.y : b.y,
    });
  }

  const kf = [];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    const prev = groups[i - 1];
    const next = groups[i + 1];
    const joinBefore = prev && prev.rampOut > g.rampIn;
    const joinAfter = next && g.rampOut > next.rampIn;

    if (!joinBefore) kf.push({ t: g.rampIn, z: 1, cx: midX, cy: midY });
    kf.push({ t: g.peak, z: g.z, cx: g.cx, cy: g.cy });
    let holdEnd = g.holdEnd;
    if (joinAfter) holdEnd = Math.min(holdEnd, next.peak - 0.08);
    kf.push({ t: Math.max(holdEnd, g.peak + 0.02), z: g.z, cx: g.cx, cy: g.cy });
    if (!joinAfter) kf.push({ t: g.rampOut, z: 1, cx: midX, cy: midY });
  }

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

/**
 * Turns the beats into the cursor's path, its arrow-or-hand state, the click
 * dip, the click ripples and its visibility.
 */
function buildCursorTrack(beats, cfg) {
  const moves = [];
  const clicks = [];
  const vis = [{ t: -1, a: cfg.start.hidden ? 0 : 1 }];

  let at = { x: cfg.start.x, y: cfg.start.y };
  let freeFrom = 0;

  for (const b of beats) {
    if (b.hide) {
      vis.push({ t: b.t, a: 0 });
      continue;
    }
    if (b.show) {
      vis.push({ t: b.t, a: 1 });
      continue;
    }
    if (b.x == null || b.y == null || b.cursor === false) continue;

    const arrive = b.t - cfg.settle;
    // Travel time comes from the distance, so the cursor keeps one speed
    // across the whole video instead of racing over a long move.
    const dist = Math.hypot(b.x - at.x, b.y - at.y);
    const want =
      b.travel != null
        ? b.travel
        : clamp(dist / cfg.speed, cfg.minTravel, cfg.maxTravel);
    let depart = arrive - want;
    if (depart < freeFrom) depart = freeFrom;
    if (depart > arrive) depart = arrive;
    // The hand only appears where there is something to click.
    const handAfter = b.click !== false;
    const arc = b.arc == null ? cfg.arc : b.arc;
    moves.push({ depart, arrive, from: at, to: { x: b.x, y: b.y }, handAfter, arc });
    if (handAfter) clicks.push({ t: b.t, x: b.x, y: b.y });
    at = { x: b.x, y: b.y };
    // The hand stays down for the whole press. Leaving earlier turns it back
    // into an arrow while the ripple is still expanding under it.
    freeFrom = b.t + (handAfter ? cfg.press.duration : 0);
  }

  const posAt = (t) => {
    for (let i = 0; i < moves.length; i++) {
      const m = moves[i];
      if (t < m.depart) {
        const prev = moves[i - 1];
        return { p: m.from, hand: prev ? prev.handAfter : false };
      }
      if (t <= m.arrive) {
        const span = m.arrive - m.depart;
        const u = span <= 0 ? 1 : easeInOutCubic((t - m.depart) / span);
        const dx = m.to.x - m.from.x;
        const dy = m.to.y - m.from.y;
        const len = Math.hypot(dx, dy) || 1;
        // A slight perpendicular bow keeps the path from looking mechanical.
        // A beat sets `arc: 0` when it wants a ruled line, such as a sweep
        // along a line of text.
        const bow = m.arc * len;
        const mx = (m.from.x + m.to.x) / 2 - (dy / len) * bow;
        const my = (m.from.y + m.to.y) / 2 + (dx / len) * bow;
        const iu = 1 - u;
        return {
          p: {
            x: iu * iu * m.from.x + 2 * iu * u * mx + u * u * m.to.x,
            y: iu * iu * m.from.y + 2 * iu * u * my + u * u * m.to.y,
          },
          hand: false,
        };
      }
    }
    const lastMove = moves[moves.length - 1];
    return {
      p: lastMove ? lastMove.to : cfg.start,
      hand: lastMove ? lastMove.handAfter : false,
    };
  };

  vis.sort((a, b) => a.t - b.t);
  const alphaAt = (t) => {
    let a = vis[0].a;
    for (let i = 1; i < vis.length; i++) {
      const k = vis[i];
      if (t >= k.t) {
        a = k.a;
        continue;
      }
      const from = vis[i - 1].a;
      const u = clamp((t - (k.t - cfg.fade)) / cfg.fade, 0, 1);
      return lerp(from, k.a, easeInOutCubic(u));
    }
    return a;
  };

  const scaleAt = (t) => {
    for (const c of clicks) {
      if (t >= c.t && t <= c.t + cfg.press.duration) {
        const u = (t - c.t) / cfg.press.duration;
        // Dip in fast, come back gently.
        return 1 - (1 - cfg.press.scale) * Math.sin(Math.PI * easeOutCubic(u));
      }
    }
    return 1;
  };

  return {
    at: (t) => {
      const { p, hand } = posAt(t);
      return { x: p.x, y: p.y, hand, scale: scaleAt(t), alpha: alphaAt(t) };
    },
    ripples: (t, cfg2) => {
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
    },
  };
}

/**
 * Freezes the source frame wherever the cursor would have to move faster than
 * a viewer can follow, and maps between the source clock and the output clock.
 *
 * A frozen source is what buys the camera and the cursor their time. Without
 * it the only way to slow a move down is to cut the take differently, and the
 * two targets that need the most room are usually the two the take runs
 * through fastest. A beat asks for a freeze of its own with
 * `pause: { before, after }`, or `pause: 0.6` for a wait before the click.
 */
function buildPacing(beats, pace, cursorCfg) {
  const freezes = [];
  const insert = (c, d) => {
    if (!(d > 0.005)) return;
    const hit = freezes.find((f) => Math.abs(f.c - c) < 1e-6);
    if (hit) {
      hit.d += d;
      return;
    }
    freezes.push({ c, d });
    freezes.sort((a, b) => a.c - b.c);
  };
  const outOf = (c) => {
    let acc = 0;
    for (const f of freezes) {
      if (f.c < c - 1e-9) acc += f.d;
      else break;
    }
    return c + acc;
  };
  const pauseOf = (b) =>
    typeof b.pause === "number"
      ? { before: b.pause, after: 0 }
      : { before: b.pause?.before ?? 0, after: b.pause?.after ?? 0 };
  // The click lands at the end of its own `before` freeze, so the frame the
  // viewer waits on is the one before anything happened.
  const timeOf = (b) => outOf(b.t) + (b.x == null ? 0 : pauseOf(b).before);

  for (const b of beats) {
    if (b.x == null) continue;
    const { before, after } = pauseOf(b);
    insert(b.t, before);
    insert(b.t + pace.afterDelay, after);
  }

  if (pace.auto) {
    const path = beats.filter((b) => b.x != null && b.cursor !== false);
    for (let i = 1; i < path.length; i++) {
      const a = path[i - 1];
      const b = path[i];
      const need =
        Math.hypot(b.x - a.x, b.y - a.y) / pace.speed +
        cursorCfg.settle +
        (a.click === false ? 0 : cursorCfg.press.duration) +
        pace.dwell;
      const short = need - (timeOf(b) - timeOf(a));
      if (short > 0.005) insert(Math.min(a.t + pace.afterDelay, b.t - 0.05), short);
    }
  }

  const total = freezes.reduce((sum, f) => sum + f.d, 0);
  const srcOf = (o) => {
    let acc = 0;
    for (const f of freezes) {
      const start = f.c + acc;
      if (o < start) return o - acc;
      if (o < start + f.d) return f.c;
      acc += f.d;
    }
    return o - acc;
  };
  return { total, freezes, outOf, srcOf, timeOf };
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
  cut.segments.forEach(([start, end], i) => {
    parts.push(`[0:v]trim=start=${start}:end=${end},setpts=PTS-STARTPTS[c${i}];`);
    labels += `[c${i}]`;
  });
  parts.push(`${labels}concat=n=${cut.segments.length}:v=1:a=0[cat];`);
  parts.push(`[cat]setpts=PTS/${cut.speed || 1}[s];`);
  return parts.join("");
}

/** Maps a second of the raw take onto its second in the cut result. */
function mapCutTime(cut, tRaw) {
  let acc = 0;
  for (const [start, end] of cut.segments) {
    if (tRaw < start) break;
    if (tRaw <= end) return (acc + (tRaw - start)) / (cut.speed || 1);
    acc += end - start;
  }
  return acc / (cut.speed || 1);
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
    background: "backgrounds/dark.webp",
    // "native" draws the recording at one output pixel per source pixel at 1x,
    // which is the sharpest the take can be. A number is a fraction of the
    // output width instead.
    fit: "native",
    radius: 13,
    // How far the camera follows the focus point. 1 puts the focus dead
    // centre of the frame, which is the only setting where the camera path is
    // a straight function of the zoom; 0 keeps the window centred and never
    // follows. Anything between is a blend of the two, and a blend bends the
    // path slightly, so lower it only when a corner target shows more
    // background than you want.
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const timelinePath = args._[0];
  if (!timelinePath) {
    console.error("usage: polish-recording.mjs <timeline.json> [options]");
    process.exit(2);
  }

  const here = path.dirname(new URL(import.meta.url).pathname);
  const base = path.dirname(path.resolve(timelinePath));
  // A bare `cursors/...`, `backgrounds/...` path means the assets shipped next
  // to this script; anything else resolves against the timeline.
  const asset = (p) =>
    /^(cursors|backgrounds)\//.test(p)
      ? path.join(here, p)
      : path.isAbsolute(p)
        ? p
        : path.resolve(base, p);
  const rel = (p) => (path.isAbsolute(p) ? p : path.resolve(base, p));
  const cfg = merge(DEFAULTS, JSON.parse(fs.readFileSync(timelinePath, "utf8")));

  const input = rel(cfg.input);
  const output = args.out ? path.resolve(args.out) : rel(cfg.output);
  const meta = await probe(input);

  const srcW = meta.width;
  const srcH = meta.height;
  const pageW = cfg.page?.width ?? srcW;
  const pageH = cfg.page?.height ?? srcH;
  const sx = srcW / pageW;
  const sy = srcH / pageH;

  const outW = cfg.size?.width ?? srcW;
  const outH = cfg.size?.height ?? srcH;
  const fps = cfg.fps;
  if (outW % 2 || outH % 2) throw new Error("output width and height must be even");

  // Beats may be timed against the raw take or against the finished cut.
  const beats = cfg.beats
    .map((b) => ({
      ...b,
      t: b.t != null ? b.t : mapCutTime(cfg.cut, b.tRaw),
      x: b.x == null ? null : b.x * sx,
      y: b.y == null ? null : b.y * sy,
      zoomAt: b.zoomAt ? { x: b.zoomAt.x * sx, y: b.zoomAt.y * sy } : null,
    }))
    .sort((a, b) => a.t - b.t);

  const cursorCfg = {
    ...cfg.cursor,
    start: {
      x: (cfg.cursor.start.x ?? pageW * 0.5) * sx,
      y: (cfg.cursor.start.y ?? pageH * 0.5) * sy,
      hidden: !!cfg.cursor.start.hidden,
    },
  };

  const bgPath = args.background ? path.resolve(args.background) : asset(cfg.frame.background);
  const [background, arrowBmp, pointerBmp] = await Promise.all([
    loadImageCover(bgPath, outW, outH),
    rasterize(asset(cfg.cursor.arrow), cfg.cursor.size),
    rasterize(asset(cfg.cursor.pointer), cfg.cursor.size),
  ]);
  const arrow = buildSprite(arrowBmp, cfg.cursor.hotspot.arrow, cfg.cursor.shadow);
  const pointer = buildSprite(pointerBmp, cfg.cursor.hotspot.pointer, cfg.cursor.shadow);

  const srcDuration = cfg.cut
    ? cfg.cut.segments.reduce((a, [s, e]) => a + (e - s), 0) / (cfg.cut.speed || 1)
    : meta.duration;

  // Beats are authored against the source clock. Pacing freezes the source
  // where a move would be too fast to follow, which moves every later beat.
  const pacing = buildPacing(beats, cfg.pace, cursorCfg);
  for (const b of beats) b.t = pacing.timeOf(b);
  const duration = srcDuration + pacing.total;
  if (pacing.total > 0.005) {
    console.log(
      `  pacing: ${pacing.freezes.length} freezes, ` +
        `+${pacing.total.toFixed(2)}s (${srcDuration.toFixed(2)}s -> ${duration.toFixed(2)}s)`,
    );
  }

  const cameraAt = buildCameraTrack(beats, cfg.zoom, duration, srcW / 2, srcH / 2);
  const cursor = buildCursorTrack(beats, cursorCfg);

  const baseScale = cfg.frame.fit === "native" ? 1 : (outW * cfg.frame.fit) / srcW;
  const follow = cfg.frame.follow;

  // ------------------------------------------------------------- ffmpeg pair
  // `--preview` is stated in seconds of the result, so the range has to be
  // mapped back through the pacing before it becomes a trim on the source.
  const preview = args.preview ? args.preview.split(":").map(Number) : null;
  const outStart = preview ? Math.max(0, preview[0]) : 0;
  const outEnd = preview ? Math.min(preview[1], duration) : duration;
  const srcStart = pacing.srcOf(outStart);
  const srcEnd = Math.min(srcDuration, pacing.srcOf(outEnd) + 2 / fps);
  const frames = Math.max(1, Math.round((outEnd - outStart) * fps));

  // The graph always ends in `fps`, and the output always states `-r`. A bare
  // `setpts` before the end leaves ffmpeg guessing the rate from timestamps,
  // and it guesses the source's rate, silently dropping frames.
  let graph = cfg.cut ? cutFilter(cfg.cut) : "[0:v]null[s];";
  if (preview) {
    graph += `[s]trim=start=${srcStart}:end=${srcEnd},setpts=PTS-STARTPTS[p];`;
    graph += `[p]fps=${fps}[out]`;
  } else {
    graph += `[s]fps=${fps}[out]`;
  }

  const dec = spawn(
    "ffmpeg",
    [
      "-v", "error",
      "-i", input,
      "-filter_complex", graph,
      "-map", "[out]",
      "-r", String(fps),
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  const decErr = [];
  dec.stderr.on("data", (c) => decErr.push(c));
  // Attached now, not after the loop: a process that has already closed never
  // emits `close` again, and awaiting it then would let node exit silently.
  const decDone = once(dec, "close");

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const enc = spawn(
    "ffmpeg",
    [
      "-v", "error",
      "-f", "rawvideo",
      "-pix_fmt", "rgba",
      "-s", `${outW}x${outH}`,
      "-r", String(fps),
      "-i", "-",
      "-an",
      "-c:v", "libvpx-vp9",
      "-b:v", "0",
      "-crf", String(args.crf ?? cfg.quality.crf),
      "-deadline", "good",
      "-cpu-used", String(cfg.quality.cpuUsed),
      "-row-mt", "1",
      "-pix_fmt", "yuv420p",
      "-y",
      output,
    ],
    { stdio: ["pipe", "ignore", "pipe"] },
  );
  const encErr = [];
  enc.stderr.on("data", (c) => encErr.push(c));
  const encDone = once(enc, "close");

  // -------------------------------------------------------------- frame loop
  const srcBytes = srcW * srcH * 4;
  const outBytes = outW * outH * 4;
  const scratchRef = { buf: new Float32Array(1) };
  let n = 0;
  const started = Date.now();

  // The source is pulled, not iterated: a frozen stretch asks for the same
  // source frame over several output frames, so the decoder only advances
  // when the output clock has moved past the next source frame.
  const source = readFrames(dec.stdout, srcBytes)[Symbol.asyncIterator]();
  let srcIdx = -1;
  let frame = null;
  let drained = false;

  for (let i = 0; i < frames; i++) {
    const t = outStart + i / fps;
    const want = Math.max(0, Math.round((pacing.srcOf(t) - srcStart) * fps));
    while (!drained && srcIdx < want) {
      const next = await source.next();
      if (next.done) {
        drained = true;
        break;
      }
      frame = next.value;
      srcIdx++;
    }
    if (!frame) break;
    const cam = cameraAt(t);
    const scale = baseScale * cam.z;
    const winW = srcW * scale;
    const winH = srcH * scale;

    // Two candidate positions: the window centred in the frame, and the
    // window placed so the focus point is dead centre. `follow` blends them.
    // Both are straight functions of the zoom, so the camera path has no kink.
    // Clamping the window against the edge of the recording, which is what
    // this used to do, put a kink in exactly one axis, and the eye read that
    // as the page tilting and then snapping back.
    const left = lerp((outW - winW) / 2, outW / 2 - cam.cx * scale, follow);
    const top = lerp((outH - winH) / 2, outH / 2 - cam.cy * scale, follow);

    const win = {
      left,
      top,
      scale,
      cx: left + winW / 2,
      cy: top + winH / 2,
      hw: winW / 2,
      hh: winH / 2,
      r: cfg.frame.radius * scale,
    };

    const dst = Buffer.allocUnsafe(outBytes);
    background.copy(dst);
    drawShadow(dst, outW, outH, win, cfg.frame.shadow);
    drawWindow(dst, outW, outH, frame, srcW, srcH, win, cfg.frame.border, scratchRef);

    for (const r of cursor.ripples(t, cfg.click)) {
      drawRipple(
        dst, outW, outH,
        left + r.x * scale, top + r.y * scale,
        r.radius, r.fill, r.stroke, cfg.click.strokeWidth, cfg.click.color,
      );
    }

    const c = cursor.at(t);
    if (c.alpha > 0.002) {
      drawSprite(
        dst, outW, outH,
        c.hand ? pointer : arrow,
        left + c.x * scale, top + c.y * scale,
        c.scale, c.alpha,
      );
    }

    if (!enc.stdin.write(dst)) await once(enc.stdin, "drain");
    n++;
    if (n % 60 === 0) {
      const rate = n / ((Date.now() - started) / 1000);
      process.stderr.write(
        `\r  frame ${n}  ${rate.toFixed(1)} fps  ${(n / fps).toFixed(1)}s`,
      );
    }
  }

  enc.stdin.end();
  if (!drained) {
    dec.stdout.destroy();
    dec.kill("SIGKILL");
  }
  const [decCode] = await decDone;
  const [encCode] = await encDone;
  process.stderr.write("\r".padEnd(60) + "\r");

  if (drained && decCode !== 0) {
    throw new Error(`decoder failed\n${Buffer.concat(decErr)}`);
  }
  if (encCode !== 0) throw new Error(`encoder failed\n${Buffer.concat(encErr)}`);

  const result = await probe(output);
  const size = fs.statSync(output).size;
  console.log(
    `${path.relative(process.cwd(), output)}  ` +
      `${result.duration.toFixed(2)}s  ${(size / 1024 / 1024).toFixed(2)} MB  ` +
      `${result.width}x${result.height}  ${n} frames`,
  );

  if (args.stills) {
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
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
