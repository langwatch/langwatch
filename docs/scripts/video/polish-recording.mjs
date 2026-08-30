#!/usr/bin/env node
/**
 * Adds a synthetic mouse cursor and focus zooms to a screen recording.
 *
 *   node docs/scripts/video/polish-recording.mjs <timeline.json> [options]
 *
 * A screen recorder driven by Playwright captures no mouse cursor and no zoom,
 * so a raw take is flat and hard to follow. This script reads a timeline of
 * click beats and renders the two things that make the take readable:
 *
 *   1. A cursor that travels to each click target on a curved, eased path,
 *      turns into a pointing hand when it arrives, and dips on the click.
 *   2. A zoom that eases in on the target just before the click, holds while
 *      the result appears, and eases back out.
 *
 * It reads the raw take through ffmpeg, composites every frame in plain
 * JavaScript, and writes the result back through ffmpeg. The only external
 * programs are `ffmpeg`, `ffprobe` and `rsvg-convert`, so there is nothing to
 * install from npm and the script keeps working after any dependency bump.
 *
 * Options:
 *   --out PATH          write here instead of the timeline's `output`
 *   --preview A:B       render only seconds A to B of the result (fast loop)
 *   --stills "1,4,8.5"  after encoding, write a PNG per listed second
 *   --stills-dir DIR    where those PNGs go (default: next to the output)
 *   --crf N             override the encoder quality (lower is better)
 *
 * See README.md in this directory for the timeline format.
 */

import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// --------------------------------------------------------------------- easing

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;

/** Slow at both ends, quick through the middle. The default for everything. */
const easeInOutCubic = (x) =>
  x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

/** Quick start, long settle. Used for the click dip. */
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

// ------------------------------------------------------------------- cursors

/**
 * Renders an SVG to an RGBA bitmap of the requested height.
 *
 * rsvg-convert writes PNG, and Node cannot decode PNG on its own, so ffmpeg
 * turns the PNG into raw RGBA. Both are already required by the rest of the
 * script, which is why this takes two processes instead of a library.
 */
async function rasterize(svgPath, height) {
  const tmp = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), "polish-cursor-")),
    "c.png",
  );
  await run("rsvg-convert", ["-h", String(Math.round(height)), svgPath, "-o", tmp]);
  const meta = await probe(tmp);
  const rgba = await run("ffmpeg", [
    "-v", "error",
    "-i", tmp,
    "-f", "rawvideo",
    "-pix_fmt", "rgba",
    "-",
  ]);
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  return { width: meta.width, height: meta.height, data: rgba };
}

/** Three box passes approximate a Gaussian closely enough for a drop shadow. */
function blurAlpha(src, w, h, radius) {
  if (radius < 1) return src;
  let a = src;
  let b = new Float32Array(w * h);
  for (let pass = 0; pass < 3; pass++) {
    // horizontal
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
    // vertical
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
 *
 * The result is premultiplied so that scaling it with bilinear sampling does
 * not bleed background colour through the soft edges.
 */
function buildSprite(bitmap, hotspot, shadow) {
  const { width: cw, height: ch, data } = bitmap;
  const pad =
    Math.ceil(shadow.blur * 2) +
    Math.ceil(Math.abs(shadow.offsetX) + Math.abs(shadow.offsetY)) +
    2;
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
  const blurred = blurAlpha(
    shadowAlpha,
    w,
    h,
    Math.max(1, Math.round(shadow.blur / 2)),
  );

  // Premultiplied RGB in 0..255, alpha in 0..1.
  const out = new Float32Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const sa = clamp(blurred[i] * shadow.opacity, 0, 1);
    out[i * 4 + 0] = 0;
    out[i * 4 + 1] = 0;
    out[i * 4 + 2] = 0;
    out[i * 4 + 3] = sa;
  }
  for (let y = 0; y < ch; y++) {
    for (let x = 0; x < cw; x++) {
      const s = (y * cw + x) * 4;
      const ca = data[s + 3] / 255;
      if (ca === 0) continue;
      const d = ((y + pad) * w + (x + pad)) * 4;
      const da = out[d + 3];
      const na = ca + da * (1 - ca);
      out[d + 0] = data[s + 0] * ca + out[d + 0] * (1 - ca);
      out[d + 1] = data[s + 1] * ca + out[d + 1] * (1 - ca);
      out[d + 2] = data[s + 2] * ca + out[d + 2] * (1 - ca);
      out[d + 3] = na;
    }
  }

  return {
    w,
    h,
    data: out,
    hotX: pad + hotspot.x * cw,
    hotY: pad + hotspot.y * ch,
  };
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
    const y0i = clamp(vy, 0, sh - 1);
    const y1i = clamp(vy + 1, 0, sh - 1);
    for (let x = x0; x < x1; x++) {
      const u = (x + 0.5 - left) * inv - 0.5;
      const ux = Math.floor(u);
      const fx = u - ux;
      const x0i = clamp(ux, 0, sw - 1);
      const x1i = clamp(ux + 1, 0, sw - 1);

      const iA = (y0i * sw + x0i) * 4;
      const iB = (y0i * sw + x1i) * 4;
      const iC = (y1i * sw + x0i) * 4;
      const iD = (y1i * sw + x1i) * 4;
      const wA = (1 - fx) * (1 - fy);
      const wB = fx * (1 - fy);
      const wC = (1 - fx) * fy;
      const wD = fx * fy;

      const sa =
        (s[iA + 3] * wA + s[iB + 3] * wB + s[iC + 3] * wC + s[iD + 3] * wD) *
        alpha;
      if (sa <= 0.002) continue;
      const sr = (s[iA] * wA + s[iB] * wB + s[iC] * wC + s[iD] * wD) * alpha;
      const sg =
        (s[iA + 1] * wA + s[iB + 1] * wB + s[iC + 1] * wC + s[iD + 1] * wD) *
        alpha;
      const sb =
        (s[iA + 2] * wA + s[iB + 2] * wB + s[iC + 2] * wC + s[iD + 2] * wD) *
        alpha;

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
 * Precomputes the tap indices and weights for one axis. The filter widens when
 * the image is being made smaller, which is what keeps a downscale from
 * aliasing.
 */
function planAxis(outN, srcStart, srcSpan, srcLimit) {
  const step = srcSpan / outN;
  const support = Math.max(1, step) * 2;
  const taps = Math.ceil(support) * 2;
  const idx = new Int32Array(outN * taps);
  const wgt = new Float32Array(outN * taps);
  const invSupport = 1 / Math.max(1, step);

  for (let i = 0; i < outN; i++) {
    const center = srcStart + (i + 0.5) * step - 0.5;
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

/**
 * Resamples the rectangle (cropX, cropY, cropW, cropH) of an RGBA source into
 * a full RGBA destination, separably: rows first into a float scratch buffer,
 * then columns.
 */
function resample(src, sw, sh, cropX, cropY, cropW, cropH, dst, dw, dh, scratch) {
  const xs = planAxis(dw, cropX, cropW, sw);
  const ys = planAxis(dh, cropY, cropH, sh);

  // Only the source rows the vertical pass will read need a horizontal pass.
  let rowMin = sh;
  let rowMax = 0;
  for (let i = 0; i < ys.idx.length; i++) {
    const r = ys.idx[i];
    if (r < rowMin) rowMin = r;
    if (r > rowMax) rowMax = r;
  }
  const rows = rowMax - rowMin + 1;
  const need = rows * dw * 4;
  if (scratch.length < need) scratch = new Float32Array(need);

  const xt = xs.taps;
  for (let r = 0; r < rows; r++) {
    const srow = (rowMin + r) * sw * 4;
    const drow = r * dw * 4;
    for (let x = 0; x < dw; x++) {
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
      const d = drow + x * 4;
      scratch[d] = a;
      scratch[d + 1] = b;
      scratch[d + 2] = c;
    }
  }

  const yt = ys.taps;
  for (let y = 0; y < dh; y++) {
    const base = y * yt;
    const drow = y * dw * 4;
    for (let x = 0; x < dw; x++) {
      let a = 0;
      let b = 0;
      let c = 0;
      for (let k = 0; k < yt; k++) {
        const w = ys.wgt[base + k];
        if (w === 0) continue;
        const p = (ys.idx[base + k] - rowMin) * dw * 4 + x * 4;
        a += scratch[p] * w;
        b += scratch[p + 1] * w;
        c += scratch[p + 2] * w;
      }
      const d = drow + x * 4;
      dst[d] = clamp(a, 0, 255);
      dst[d + 1] = clamp(b, 0, 255);
      dst[d + 2] = clamp(c, 0, 255);
      dst[d + 3] = 255;
    }
  }
  return scratch;
}

// -------------------------------------------------------------------- tracks

/**
 * Turns the beats into a list of zoom keyframes and returns a lookup.
 *
 * Each zoomed beat contributes four keyframes: leave 1x, reach the target zoom
 * just before the click, hold, return to 1x. When two beats are close enough
 * that the second starts before the first has returned, both 1x keyframes are
 * dropped so the view pans straight from one focus point to the next.
 */
function buildZoomTrack(beats, cfg, duration) {
  const groups = [];
  for (const b of beats) {
    if (b.x == null || b.y == null) continue;
    const z = b.zoom == null ? cfg.default : b.zoom;
    if (!(z > 1.0001)) continue;
    const peak = b.t - cfg.lead;
    const holdEnd = b.t + (b.hold == null ? cfg.hold : b.hold);
    groups.push({
      rampIn: peak - cfg.in,
      peak,
      holdEnd,
      rampOut: holdEnd + cfg.out,
      z,
      // `zoomAt` frames something wider than the click, such as the dialog the
      // button belongs to. Without it the click point is the centre.
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

    if (!joinBefore) kf.push({ t: g.rampIn, z: 1, cx: g.cx, cy: g.cy });
    kf.push({ t: g.peak, z: g.z, cx: g.cx, cy: g.cy });
    // A hold that would run past the next zoom's peak is cut short.
    let holdEnd = g.holdEnd;
    if (joinAfter) holdEnd = Math.min(holdEnd, next.peak - 0.08);
    kf.push({ t: Math.max(holdEnd, g.peak + 0.02), z: g.z, cx: g.cx, cy: g.cy });
    if (!joinAfter) kf.push({ t: g.rampOut, z: 1, cx: g.cx, cy: g.cy });
  }

  if (kf.length === 0) return () => ({ z: 1, cx: 0, cy: 0 });

  kf.sort((a, b) => a.t - b.t);
  for (let i = 1; i < kf.length; i++) {
    if (kf[i].t <= kf[i - 1].t) kf[i].t = kf[i - 1].t + 0.001;
  }
  kf.unshift({ t: Math.min(-1, kf[0].t - 1), z: 1, cx: kf[0].cx, cy: kf[0].cy });
  const last = kf[kf.length - 1];
  kf.push({ t: Math.max(duration + 1, last.t + 1), z: 1, cx: last.cx, cy: last.cy });

  let cursor = 0;
  return (t) => {
    while (cursor > 0 && t < kf[cursor].t) cursor--;
    while (cursor < kf.length - 2 && t >= kf[cursor + 1].t) cursor++;
    const a = kf[cursor];
    const b = kf[cursor + 1];
    const u = clamp((t - a.t) / (b.t - a.t), 0, 1);
    const e = easeInOutCubic(u);
    return {
      // Zoom reads as constant speed to the eye when interpolated in log space.
      z: Math.exp(lerp(Math.log(a.z), Math.log(b.z), e)),
      cx: lerp(a.cx, b.cx, e),
      cy: lerp(a.cy, b.cy, e),
    };
  };
}

/**
 * Turns the beats into the cursor's path, its arrow-or-hand state, the click
 * dip and its visibility.
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
    let depart = arrive - (b.travel == null ? cfg.travel : b.travel);
    if (depart < freeFrom) depart = freeFrom;
    if (depart > arrive) depart = arrive;
    // The hand only appears where there is something to click.
    const handAfter = b.click !== false;
    moves.push({ depart, arrive, from: at, to: { x: b.x, y: b.y }, handAfter });
    if (handAfter) clicks.push(b.t);
    at = { x: b.x, y: b.y };
    freeFrom = b.t;
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
        // A slight perpendicular bow keeps the path from looking mechanical.
        const bow = cfg.arc * Math.hypot(dx, dy);
        const mx = (m.from.x + m.to.x) / 2 - (dy / (Math.hypot(dx, dy) || 1)) * bow;
        const my = (m.from.y + m.to.y) / 2 + (dx / (Math.hypot(dx, dy) || 1)) * bow;
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
      if (t >= c && t <= c + cfg.press.duration) {
        const u = (t - c) / cfg.press.duration;
        // Dip in fast, come back gently.
        const dip = Math.sin(Math.PI * easeOutCubic(u));
        return 1 - (1 - cfg.press.scale) * dip;
      }
    }
    return 1;
  };

  return (t) => {
    const { p, hand } = posAt(t);
    return { x: p.x, y: p.y, hand, scale: scaleAt(t), alpha: alphaAt(t) };
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
  cursor: {
    arrow: "cursors/arrow.svg",
    pointer: "cursors/pointer.svg",
    size: 64,
    hotspot: { arrow: { x: 0.293, y: 0.175 }, pointer: { x: 0.383, y: 0.243 } },
    shadow: { blur: 10, offsetX: 1, offsetY: 4, opacity: 0.4 },
    travel: 0.75,
    settle: 0.14,
    arc: 0.08,
    fade: 0.3,
    press: { scale: 0.84, duration: 0.16 },
    start: { x: null, y: null, hidden: false },
  },
  zoom: { default: 1.5, lead: 0.16, in: 0.62, out: 0.8, hold: 1.0 },
  quality: { crf: 32, cpuUsed: 2 },
};

function merge(base, over) {
  if (over == null) return base;
  if (Array.isArray(base) || typeof base !== "object") return over;
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
  const rel = (p) => (path.isAbsolute(p) ? p : path.resolve(base, p));
  const cfg = merge(DEFAULTS, JSON.parse(fs.readFileSync(timelinePath, "utf8")));

  const input = rel(cfg.input);
  const output = args.out ? path.resolve(args.out) : rel(cfg.output);
  const meta = await probe(input);

  // The recording's own pixels. Beat coordinates are page pixels, which differ
  // when the take was recorded at a device scale factor above 1.
  const srcW = meta.width;
  const srcH = meta.height;
  const pageW = cfg.page?.width ?? srcW;
  const pageH = cfg.page?.height ?? srcH;
  const sx = srcW / pageW;
  const sy = srcH / pageH;

  const outW = cfg.size?.width ?? srcW;
  const outH = cfg.size?.height ?? srcH;
  const fps = cfg.fps;

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

  const [arrowBmp, pointerBmp] = await Promise.all([
    rasterize(rel(cfg.cursor.arrow.startsWith("cursors/") ? path.join(here, cfg.cursor.arrow) : cfg.cursor.arrow), cfg.cursor.size),
    rasterize(rel(cfg.cursor.pointer.startsWith("cursors/") ? path.join(here, cfg.cursor.pointer) : cfg.cursor.pointer), cfg.cursor.size),
  ]);
  const arrow = buildSprite(arrowBmp, cfg.cursor.hotspot.arrow, cfg.cursor.shadow);
  const pointer = buildSprite(pointerBmp, cfg.cursor.hotspot.pointer, cfg.cursor.shadow);

  const duration = cfg.cut
    ? cfg.cut.segments.reduce((a, [s, e]) => a + (e - s), 0) / (cfg.cut.speed || 1)
    : meta.duration;

  const zoomAt = buildZoomTrack(beats, cfg.zoom, duration);
  const cursorAt = buildCursorTrack(beats, cursorCfg);

  // ------------------------------------------------------------- ffmpeg pair
  const preview = args.preview
    ? args.preview.split(":").map(Number)
    : null;
  const clockOffset = preview ? preview[0] : 0;

  // The graph always ends in `fps`, and the output always states `-r`. A bare
  // `setpts` before the end leaves ffmpeg guessing the rate from timestamps,
  // and it guesses the source's rate, silently dropping frames.
  let graph = cfg.cut ? cutFilter(cfg.cut) : "[0:v]null[s];";
  if (preview) {
    graph += `[s]trim=start=${preview[0]}:end=${preview[1]},setpts=PTS-STARTPTS[p];`;
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
  let scratch = new Float32Array(1);
  let n = 0;
  const started = Date.now();

  for await (const frame of readFrames(dec.stdout, srcBytes)) {
    const t = clockOffset + n / fps;
    const { z, cx, cy } = zoomAt(t);

    const dst = Buffer.allocUnsafe(outBytes);
    if (z <= 1.0001 && outW === srcW && outH === srcH) {
      frame.copy(dst);
    } else {
      const cropW = srcW / z;
      const cropH = srcH / z;
      const cropX = clamp(cx - cropW / 2, 0, srcW - cropW);
      const cropY = clamp(cy - cropH / 2, 0, srcH - cropH);
      scratch = resample(
        frame, srcW, srcH,
        cropX, cropY, cropW, cropH,
        dst, outW, outH,
        scratch,
      );
    }

    const c = cursorAt(t);
    if (c.alpha > 0.002) {
      // The cursor lives in page space, so the zoom has to carry it too.
      const cropW = srcW / z;
      const cropH = srcH / z;
      const cropX = clamp(cx - cropW / 2, 0, srcW - cropW);
      const cropY = clamp(cy - cropH / 2, 0, srcH - cropH);
      const px = ((c.x - cropX) * outW) / cropW;
      const py = ((c.y - cropY) * outH) / cropH;
      drawSprite(
        dst, outW, outH,
        c.hand ? pointer : arrow,
        px, py,
        c.scale,
        c.alpha,
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
  const [decCode] = await decDone;
  const [encCode] = await encDone;
  process.stderr.write("\r".padEnd(60) + "\r");

  if (decCode !== 0) throw new Error(`decoder failed\n${Buffer.concat(decErr)}`);
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
