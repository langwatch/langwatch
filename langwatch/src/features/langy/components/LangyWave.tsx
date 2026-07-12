import { Box } from "@chakra-ui/react";
import { useEffect, useRef } from "react";

/**
 * The living rope behind the FLOATING panel — one physics engine, two looks.
 *
 * A vertical rope is sampled down the panel and animated every frame. It is
 * never still:
 *
 *   1. it SWAYS on its own — two layered sine waves of different speed and
 *      wavelength, a soft wind that anchors gently at the top and bottom edges;
 *   2. it is PUSHED by the cursor — approach from one side and it swings away,
 *      as a damped spring (momentum + a hair of overshoot = weight), with a wide
 *      gaussian bulge tracking the cursor's height so it leans toward exactly
 *      where you are. The push is a continuous `tanh` of the signed distance to
 *      the rope, so crossing the seam never jolts.
 *
 * The same rope drives two `variant`s (an interim design comparison — see the
 * store's `panelEffect`):
 *
 *   • "fold"  — the rope is the seam of a soft two-tone brand FOLD. A warm layer
 *               is clipped to its right, a cool layer shows through on its left,
 *               and a luminous seam is stroked along the divide. This sits BEHIND
 *               the content, as a background wash.
 *   • "split" — the rope splits the panel BLACK↔WHITE. A single inverting layer
 *               (`mix-blend-mode: difference`) is clipped to one side of the rope
 *               and sits ABOVE the content, so everything on that side flips to
 *               its inverse — the "two rendered on top of each other, one white
 *               one black" look, without re-rendering the live tree twice.
 *
 * Either way the clip-path and the seam are driven imperatively from the rAF
 * loop; the layers are decorative and inert to the pointer. The whole thing only
 * mounts in floating mode while the panel is open (`active`), so the loop never
 * runs behind a closed or docked panel. Reduced motion draws one resting S-curve
 * and stops.
 */

export type LangyWaveVariant = "fold" | "split";

// Points sampled down the rope. More points = a smoother curve at more cost per
// frame; 28 is plenty for a shape this soft.
const SAMPLES = 28;

interface RopePoint {
  x: number;
  y: number;
}

/**
 * The live physics of the shove, held in a ref so the rAF loop mutates it
 * without triggering React renders.
 */
interface WaveState {
  mouse: { x: number; y: number; inside: boolean };
  /** Rope shove: position + velocity of a damped spring. */
  push: number;
  pushV: number;
  /** Bulge centre (cursor y, 0..1), spring-smoothed. */
  my: number;
  myV: number;
  /** 0..1 fade of cursor influence, so entering/leaving never pops. */
  presence: number;
  /** Previous frame's rope x-samples, to measure cursor→rope distance. */
  lastXs: number[] | null;
  /** Timestamp of the previous frame, for a real dt. */
  lastT: number | null;
  /** Wind-phase accumulator; advances slower while a popover is open. */
  windT: number;
  /** A menu/popover is open — slide the rope aside so it doesn't fight it. */
  popoverOpen: boolean;
  /** 0..1 slide of the whole rope to the far LEFT while a popover is open. */
  park: number;
}

/**
 * Sample the rope's x at every height, then close the shape around the RIGHT
 * edge — so as a `clip-path` it KEEPS the clipped layer to the right of the
 * curve, and as a stroke it draws just the curve (the closing edges sit
 * off-canvas).
 *
 * The sampled points are threaded through a Catmull-Rom → cubic-bezier
 * conversion so the discrete samples read as one smooth line rather than a
 * polyline.
 */
function ropePath(pts: RopePoint[], w: number, h: number): string {
  const at = (i: number) => pts[Math.max(0, Math.min(pts.length - 1, i))]!;
  let d = `M ${pts[0]!.x.toFixed(1)} ${pts[0]!.y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1x = p1.x + (p2.x - p0.x) / 6;
    const c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6;
    const c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  // Close around the right side; overshoot the corners so the fill never leaves
  // a sliver at the panel's rounded edges.
  d += ` L ${w + 60} ${h + 60} L ${w + 60} -60 Z`;
  return d;
}

/**
 * Build one frame of the rope.
 *
 * `windAmp` and `presence` scale the two motion sources independently, so the
 * same function serves both the animated loop (wind on, cursor faded in/out)
 * and the reduced-motion resting shape (both zero).
 */
function sampleRope(
  w: number,
  h: number,
  opts: {
    t: number;
    windAmp: number;
    presence: number;
    push: number;
    my: number;
    park: number;
  },
): { pts: RopePoint[]; xs: number[] } {
  const { t, windAmp, presence, push, my, park } = opts;
  const pts: RopePoint[] = [];
  const xs: number[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const ny = i / (SAMPLES - 1); // 0..1 down the panel
    // Resting S-shape, biased just right of centre.
    let x = w * (0.52 + 0.055 * Math.sin(ny * Math.PI * 1.6 + 0.4));
    // Wind: two sines of different speed + wavelength, softened toward the ends.
    const env = Math.sin(Math.PI * ny) * 0.6 + 0.4;
    x +=
      windAmp *
      env *
      (w * 0.018 * Math.sin(ny * 5.0 - t * 1.1) +
        w * 0.01 * Math.sin(ny * 9.0 + t * 0.7));
    // Cursor: a global swing plus a wide gaussian bulge at the cursor's height.
    const g = Math.exp(-(((ny - my) / 0.28) ** 2));
    x += presence * push * (w * 0.26 + w * 0.14 * g);
    // Park the whole rope hard to the LEFT while a popover is open, so it
    // slides out from under the (right-anchored) dropdown and the panel reads
    // uniform behind it. 1.3w overshoots the clamp, so it settles at the edge.
    x -= park * w * 1.3;
    // Soft clamp: compress toward the edges instead of hard-stopping.
    const c = w * 0.5;
    const r = w * 0.46;
    x = c + Math.tanh((x - c) / r) * r;
    xs.push(x);
    pts.push({ x, y: ny * (h + 120) - 60 }); // overshoot top/bottom
  }
  return { pts, xs };
}

export function LangyWave({
  containerRef,
  active,
  variant,
  reduceMotion,
}: {
  /** The panel element the cursor is tracked against (and sized from). */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Only true in floating mode while the panel is open (and not "plain"). */
  active: boolean;
  variant: LangyWaveVariant;
  reduceMotion: boolean;
}) {
  // The clipped layer and the stroked seam are driven imperatively every frame,
  // so we reach for their DOM nodes rather than re-rendering React. `clipRef`
  // points at whichever clip layer the current variant rendered.
  const clipRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<SVGPathElement>(null);
  const state = useRef<WaveState>({
    mouse: { x: 0, y: 0, inside: false },
    push: 0,
    pushV: 0,
    my: 0.5,
    myV: 0,
    presence: 0,
    lastXs: null,
    lastT: null,
    windT: 0,
    popoverOpen: false,
    park: 0,
  });

  useEffect(() => {
    if (!active) return;
    const el = containerRef.current;
    if (!el) return;
    const s = state.current;

    const applyPath = (d: string) => {
      if (clipRef.current) clipRef.current.style.clipPath = `path('${d}')`;
      edgeRef.current?.setAttribute("d", d);
    };

    // Reduced motion: draw the resting fold once and stop. No listeners, no rAF.
    if (reduceMotion) {
      const draw = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (w === 0 || h === 0) return;
        const { pts } = sampleRope(w, h, {
          t: 0,
          windAmp: 0,
          presence: 0,
          push: 0,
          my: 0.5,
          park: 0,
        });
        applyPath(ropePath(pts, w, h));
      };
      draw();
      // The panel grows from a spring on open; redraw once it has settled so the
      // resting curve matches the final size rather than the mid-animation one.
      const settle = window.setTimeout(draw, 320);
      return () => window.clearTimeout(settle);
    }

    const onMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect();
      s.mouse = {
        x: e.clientX - rect.left,
        y: e.clientY - rect.top,
        inside: true,
      };
    };
    const onLeave = () => {
      s.mouse.inside = false;
    };
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerleave", onLeave);

    // While a menu / popover / select is open, the rope calms down (slower
    // wind below, cursor lean faded out) so the moving seam doesn't sweep
    // around behind the static dropdown. Those overlays portal onto <body>,
    // out of the panel's reach, so we can't invert them — we just notice one
    // is open. An observer (not per-frame polling) flips the flag.
    const OPEN_OVERLAY =
      '[data-scope="menu"][data-state="open"],' +
      '[data-scope="popover"][data-state="open"],' +
      '[data-scope="select"][data-state="open"],' +
      '[data-scope="combobox"][data-state="open"]';
    const syncOverlay = () => {
      s.popoverOpen = !!document.querySelector(OPEN_OVERLAY);
    };
    syncOverlay();
    const overlayObserver = new MutationObserver(syncOverlay);
    overlayObserver.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });

    let raf = 0;
    const tick = (now: number) => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w === 0 || h === 0) {
        raf = requestAnimationFrame(tick);
        return;
      }
      const dt = Math.min(0.05, s.lastT ? (now - s.lastT) / 1000 : 1 / 60);
      s.lastT = now;

      // Wind advances at quarter speed while a popover is open (calm, not
      // frozen); windT accumulates, so the speed change never snaps.
      s.windT += dt * (s.popoverOpen ? 0.25 : 1);
      // Ease the leftward park in/out — a smooth slide, not a jump.
      s.park += ((s.popoverOpen ? 1 : 0) - s.park) * Math.min(1, dt * 4);

      // Cursor influence: a continuous target from the SIGNED distance to the
      // rope, not a side-switch. At the seam the push is ~0 and it ramps up
      // smoothly with depth, so crossing the rope never jolts. Positive when the
      // cursor is on the left of the rope → push it right.
      let target = 0;
      if (s.mouse.inside && s.lastXs) {
        const i = Math.round((s.mouse.y / h) * (SAMPLES - 1));
        const ropeX = s.lastXs[Math.max(0, Math.min(SAMPLES - 1, i))]!;
        target = Math.tanh(((ropeX - s.mouse.x) / w) * 5.5);
      }
      // A popover is open → don't lean toward the cursor, or the seam sweeps
      // around behind the dropdown. The spring settles to the resting sway.
      if (s.popoverOpen) target = 0;

      // Presence fades cursor influence in/out over ~1/3s (no pop on leave);
      // it also fades OUT while a popover is open, so the lean bleeds away.
      s.presence +=
        ((s.mouse.inside && !s.popoverOpen ? 1 : 0) - s.presence) *
        Math.min(1, dt * 3.5);

      // Damped spring for the shove — momentum + a hair of overshoot = weight.
      {
        const k = 22; // stiffness
        const dmp = 2 * Math.sqrt(k) * 0.8; // <1 ⇒ slight overshoot
        s.pushV += ((target - s.push) * k - s.pushV * dmp) * dt;
        s.push += s.pushV * dt;
      }
      // Spring the bulge centre toward the cursor's height (softer, critically
      // damped so it never wobbles).
      if (s.mouse.inside) {
        const k = 14;
        const dmp = 2 * Math.sqrt(k);
        s.myV += ((s.mouse.y / h - s.my) * k - s.myV * dmp) * dt;
        s.my += s.myV * dt;
      }

      const { pts, xs } = sampleRope(w, h, {
        t: s.windT,
        windAmp: 1,
        presence: s.presence,
        push: s.push,
        my: s.my,
        park: s.park,
      });
      s.lastXs = xs;
      applyPath(ropePath(pts, w, h));
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerleave", onLeave);
      overlayObserver.disconnect();
    };
    // `variant` re-runs the effect so the reduced-motion redraw (and a fresh
    // clip-layer grab) happens when the look is switched live.
  }, [active, reduceMotion, variant, containerRef]);

  if (!active) return null;

  return (
    <Box className={`langy-wave langy-wave--${variant}`} aria-hidden>
      {variant === "fold" ? (
        <>
          {/* Cool tone — shows on the left, where the warm layer is clipped away. */}
          <div className="langy-wave-base" />
          {/* Warm tone — clipped to the right of the rope every frame. */}
          <div ref={clipRef} className="langy-wave-light" />
        </>
      ) : (
        // One inverting layer, clipped to the right of the rope → that side
        // flips to its inverse (black↔white) while the left stays as it is.
        <div ref={clipRef} className="langy-wave-split" />
      )}
      {/* The luminous seam, restroked each frame with the same path. */}
      <svg className="langy-wave-svg">
        <path ref={edgeRef} className="langy-wave-seam" fill="none" />
      </svg>
    </Box>
  );
}
