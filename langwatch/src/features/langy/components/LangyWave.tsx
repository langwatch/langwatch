import { Box } from "@chakra-ui/react";
import { useEffect, useRef } from "react";
import {
  type LangyWaveActivity,
  type LangyWaveMotion,
  isErrorTransition,
  isSuccessTransition,
  isWakeTransition,
  restingWaveMotion,
  stepWaveMotion,
  WAVE_CELEBRATE_DURATION_S,
  WAVE_GLITTER_FALL_TAU_S,
  WAVE_GLITTER_RISE_TAU_S,
  WAVE_GLITTER_TRAVEL_S,
  WAVE_PULSE_PERIOD_S,
  WAVE_RIPPLE_TRAVEL_S,
  WAVE_SHAKE_DURATION_S,
} from "../logic/langyWaveMotion";

/**
 * The living fold behind the panel — one rope, two looks, both layouts.
 *
 * A vertical rope is sampled down the panel and animated every frame. Its
 * motion is driven ENTIRELY by Langy's own activity (`activity` prop, derived
 * in the panel from the live turn's wire signals — see
 * `logic/langyWaveMotion.ts` and specs/langy/langy-panel-fold-motion.feature).
 * It never reacts to the cursor: the old pointer physics (a gaussian bulge at
 * cursor height, a spring-loaded swing away from approach) looked alive for a
 * minute and then read as a distraction reacting to the wrong things.
 *
 * The vocabulary, in one line each: idle drifts almost still; a sent message
 * fires one gentle ripple down the rope; thinking is a slow deep swell;
 * streaming is a livelier travelling wind; a running tool breathes on a steady
 * pulse; a failure settles toward stillness. Transitions ease through a single
 * smoothed parameter vector, so rapid state flips never pop, and a finished
 * turn takes a couple of seconds to come back to rest.
 *
 * On TOP of that ambient motion sit GESTURES — the fold's personality, quiet at
 * rest and expressive only when something happens (see `logic/langyWaveMotion.ts`):
 * while a STATUS LABEL is up on the conversation, a warm pulse runs down the seam
 * like light down a fibre; a FAILED turn shivers once (a brief nervous shake); a
 * turn that SUCCEEDS wags happily down the rope and eases out. The shake and wag
 * are decaying one-shots; the fibre glitter is a level that tracks the status.
 *
 * The rope is the seam of a soft two-tone brand fold. A warm layer is clipped
 * to its right, a cool layer shows through on its left, and a luminous seam is
 * stroked along the divide. The clip-path and seam are driven from the rAF
 * loop; the layers are decorative and inert to the pointer. The whole thing
 * only mounts while the panel is open (`active`), so the loop never runs
 * behind a closed panel. Reduced motion draws one resting S-curve and stops.
 */

// Points sampled down the rope. More points = a smoother curve at more cost per
// frame; 28 is plenty for a shape this soft.
const SAMPLES = 28;

interface RopePoint {
  x: number;
  y: number;
}

/**
 * The live animation state, held in a ref so the rAF loop mutates it without
 * triggering React renders.
 */
interface WaveState {
  /** The smoothed motion parameter vector (energy / drift / flutter / pulse). */
  motion: LangyWaveMotion;
  /** The activity the previous frame saw, to detect wake transitions. */
  lastActivity: LangyWaveActivity;
  /** Accumulated wind phase; advances at the smoothed drift speed. */
  windPhase: number;
  /** Accumulated pulse phase for the tool state's breathing. */
  pulsePhase: number;
  /** The wake ripple's progress down the rope (0..1), or null when none. */
  ripple: number | null;
  /** Error shake progress (0..1), or null — a brief nervous side-to-side shiver. */
  shake: number | null;
  /** Success wag progress (0..1), or null — a springy happy dance down the rope. */
  celebrate: number | null;
  /** Seam-glitter intensity (0..1), eased toward 1 while a status label is up. */
  glitterEnergy: number;
  /** Accumulated glitter phase — advances the fibre pulse down the seam. */
  glitterPhase: number;
  /** Timestamp of the previous frame, for a real dt. */
  lastT: number | null;
}

/**
 * The OPEN seam curve — just the sampled line, threaded through a Catmull-Rom →
 * cubic-bezier conversion so the discrete samples read as one smooth line rather
 * than a polyline. Used for the stroked seam and the fibre pulse (which needs an
 * open path so its travelling dash never wanders onto the closing edges).
 */
function ropeCurve(pts: RopePoint[]): string {
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
  return d;
}

/**
 * The seam curve CLOSED around the RIGHT edge — so as a `clip-path` it KEEPS the
 * clipped layer to the right of the curve. Overshoot the corners so the fill
 * never leaves a sliver at the panel's rounded edges.
 */
function ropePath(pts: RopePoint[], w: number, h: number): string {
  return ropeCurve(pts) + ` L ${w + 60} ${h + 60} L ${w + 60} -60 Z`;
}

/**
 * Build one frame of the rope from the smoothed motion vector.
 *
 * Absolute amplitudes stay small, but no longer so small that working states are
 * indistinguishable from rest. At full streaming energy the wind peaks around
 * 3% of the panel width and idle sits near a tenth of that: the resting fold is
 * still a shape you only notice breathing if you look for it, while a turn in
 * flight is unmistakably moving. The short component also runs a shorter
 * wavelength (11 vs 9) so high flutter reads as a WIGGLE rather than a second,
 * slower swell riding the first.
 */
function sampleRope(
  w: number,
  h: number,
  opts: {
    motion: LangyWaveMotion;
    windPhase: number;
    pulsePhase: number;
    ripple: number | null;
    shake: number | null;
    celebrate: number | null;
  },
): RopePoint[] {
  const { motion, windPhase, pulsePhase, ripple, shake, celebrate } = opts;
  // The tool state's breathing: a smooth dip-and-return of the whole wind
  // amplitude. Depth eases with `motion.pulse`, so it fades in/out like
  // everything else.
  const pulseMod = 1 - motion.pulse * 0.35 * (0.5 - 0.5 * Math.sin(pulsePhase));
  const amp = motion.energy * pulseMod;
  const pts: RopePoint[] = [];
  for (let i = 0; i < SAMPLES; i++) {
    const ny = i / (SAMPLES - 1); // 0..1 down the panel
    // Resting S-shape, biased just right of centre. A gentle, near-vertical
    // bow — the fold's shape, not its motion.
    let x = w * (0.52 + 0.045 * Math.sin(ny * Math.PI * 1.6 + 0.4));
    // Wind: a long travelling swell plus a short flutter, softened toward the
    // ends. The flutter weight is what separates a deep thinking swell (≈0)
    // from the livelier streaming wind (high).
    const env = Math.sin(Math.PI * ny) * 0.6 + 0.4;
    x +=
      env *
      amp *
      (w * 0.019 * Math.sin(ny * 4.2 - windPhase) +
        motion.flutter * w * 0.014 * Math.sin(ny * 11.0 + windPhase * 0.62));
    // The wake ripple: one gaussian bump travelling top→bottom once, easing in
    // and out over its life.
    if (ripple !== null) {
      x +=
        Math.sin(Math.PI * ripple) *
        w *
        0.018 *
        Math.exp(-(((ny - ripple) / 0.16) ** 2));
    }
    // Error shake: the WHOLE rope shivers side to side (no `ny` term, so it
    // reads as one nervous line), high frequency, amplitude decaying to nothing
    // over the gesture's short life. A failure that stutters, then stills.
    if (shake !== null) {
      x += (1 - shake) * w * 0.02 * Math.sin(shake * Math.PI * 14);
    }
    // Success wag: a springy, happy dance. Unlike the shake it TRAVELS (phase
    // rides `ny`), lower frequency, with a bouncy ease-out envelope biased to
    // the front — a quick upbeat wiggle down the rope that settles.
    if (celebrate !== null) {
      const env = Math.sin(Math.PI * celebrate) * (1 - celebrate * 0.4);
      x += env * w * 0.016 * Math.sin(ny * 3.0 + celebrate * Math.PI * 6);
    }
    // Soft clamp: compress toward the edges instead of hard-stopping.
    const c = w * 0.5;
    const r = w * 0.46;
    x = c + Math.tanh((x - c) / r) * r;
    pts.push({ x, y: ny * (h + 120) - 60 }); // overshoot top/bottom
  }
  return pts;
}

export function LangyWave({
  containerRef,
  active,
  activity,
  statusActive,
  compact = false,
  reduceMotion,
}: {
  /** The panel element the rope is sized from. */
  containerRef: React.RefObject<HTMLElement | null>;
  /** Only true while the panel is open (and the effect isn't "plain"). */
  active: boolean;
  /** What Langy is doing right now — the ONLY thing that drives the motion. */
  activity: LangyWaveActivity;
  /**
   * A status label (the orange-orbed "Analysing traces…" row) is showing on the
   * conversation right now. Gates the seam's fibre glitter — it shimmers in
   * sympathy with the status, then eases dark when it clears.
   */
  statusActive: boolean;
  /**
   * The narrow docked sidebar. The fold still reads fully — same seam, same
   * fibre — but the broad tone fills over-power the tall empty column, so
   * `compact` softens ONLY those fills (see `.langy-wave--compact`). The seam
   * stays full-strength so the fold never reads as "switched off".
   */
  compact?: boolean;
  reduceMotion: boolean;
}) {
  // The clipped layer and the stroked seam are driven imperatively every frame,
  // so we reach for their DOM nodes rather than re-rendering React.
  const clipRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<SVGPathElement>(null);
  // The fibre pulse: a second seam path whose bright dash travels down the line
  // like light down a fibre. Driven imperatively each frame from the rAF loop.
  const fiberRef = useRef<SVGPathElement>(null);
  // The rAF loop reads the CURRENT activity + status through refs the render
  // keeps fresh — a change must steer the running loop, not restart it
  // (restarting would drop the accumulated phases and visibly hitch).
  const activityRef = useRef<LangyWaveActivity>(activity);
  activityRef.current = activity;
  const statusActiveRef = useRef<boolean>(statusActive);
  statusActiveRef.current = statusActive;
  const state = useRef<WaveState>({
    motion: restingWaveMotion(),
    lastActivity: "idle",
    windPhase: 0,
    pulsePhase: 0,
    ripple: null,
    shake: null,
    celebrate: null,
    glitterEnergy: 0,
    glitterPhase: 0,
    lastT: null,
  });

  useEffect(() => {
    if (!active) return;
    const el = containerRef.current;
    if (!el) return;
    const s = state.current;

    // The clip layer wants the CLOSED path; the stroked seam and the fibre pulse
    // want the OPEN curve (an open path so the fibre's travelling dash never
    // wanders onto the off-canvas closing edges).
    const applyPath = (pts: RopePoint[], w: number, h: number) => {
      if (clipRef.current) {
        clipRef.current.style.clipPath = `path('${ropePath(pts, w, h)}')`;
      }
      const curve = ropeCurve(pts);
      edgeRef.current?.setAttribute("d", curve);
      fiberRef.current?.setAttribute("d", curve);
    };

    // The seam glitter, drawn as a pulse of light travelling DOWN the fibre: a
    // second copy of the seam stroked bright, with a single short dash (the
    // pulse) and a long dark gap, its offset advanced each frame so the dash
    // runs down the line. Opacity rides the eased glitter energy, so it blooms
    // while a status label is up and fades to nothing at rest. `h + 120` is the
    // seam's y-span (it overshoots the panel by 60px top and bottom).
    const FIBER_DASH = 42;
    const FIBER_PEAK = 0.5;
    const applyFiber = (h: number) => {
      const fib = fiberRef.current;
      if (!fib) return;
      const e = s.glitterEnergy;
      if (e < 0.004) {
        fib.style.opacity = "0";
        return;
      }
      const len = h + 120;
      const gap = len * 1.25;
      const period = FIBER_DASH + gap;
      fib.style.strokeDasharray = `${FIBER_DASH.toFixed(1)} ${gap.toFixed(1)}`;
      // Negative offset slides the dash toward the path END (top→bottom).
      fib.style.strokeDashoffset = (-s.glitterPhase * period).toFixed(1);
      fib.style.opacity = (e * FIBER_PEAK).toFixed(3);
    };

    // Reduced motion: draw the resting fold and stop. No rAF — redraws only
    // when the panel actually resizes (the open spring, a layout-mode switch,
    // a viewport resize in sidebar mode).
    if (reduceMotion) {
      const draw = () => {
        const w = el.clientWidth;
        const h = el.clientHeight;
        if (w === 0 || h === 0) return;
        const pts = sampleRope(w, h, {
          motion: { energy: 0, drift: 0, flutter: 0, pulse: 0 },
          windPhase: 0,
          pulsePhase: 0,
          ripple: null,
          shake: null,
          celebrate: null,
        });
        applyPath(pts, w, h);
        // Reduced motion means no gestures at all — keep the fibre pulse dark.
        if (fiberRef.current) fiberRef.current.style.opacity = "0";
      };
      draw();
      const resizeObserver = new ResizeObserver(draw);
      resizeObserver.observe(el);
      return () => resizeObserver.disconnect();
    }

    // The rope reacts to Langy's ACTIVITY and nothing else: not the cursor, and
    // — deliberately — not menus, popovers, selects or focus either. An earlier
    // version slid the whole rope aside whenever an overlay opened (a leftover
    // from the Split experiment); that read as the fold "reacting to the wrong
    // thing" the instant a user opened a dropdown, so it's gone. Overlays portal
    // onto <body>, above the panel, and simply sit over the quietly-drifting
    // fold.
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

      // A state change steers the smoothed vector and fires the one-shot
      // gestures: the idle→working edge sends the wake ripple, entering settling
      // shakes (failure), a clean return to idle wags (success). Never anything
      // discontinuous in the ambient motion itself.
      const currentActivity = activityRef.current;
      if (currentActivity !== s.lastActivity) {
        if (isWakeTransition(s.lastActivity, currentActivity)) s.ripple = 0;
        if (isErrorTransition(s.lastActivity, currentActivity)) s.shake = 0;
        if (isSuccessTransition(s.lastActivity, currentActivity)) {
          s.celebrate = 0;
        }
        s.lastActivity = currentActivity;
      }
      s.motion = stepWaveMotion({
        current: s.motion,
        activity: currentActivity,
        dt,
      });

      // Phases ACCUMULATE at the smoothed speeds, so a speed change can never
      // jump the waveform.
      s.windPhase += dt * s.motion.drift;
      s.pulsePhase += dt * ((Math.PI * 2) / WAVE_PULSE_PERIOD_S);
      if (s.ripple !== null) {
        s.ripple += dt / WAVE_RIPPLE_TRAVEL_S;
        if (s.ripple >= 1) s.ripple = null;
      }
      if (s.shake !== null) {
        s.shake += dt / WAVE_SHAKE_DURATION_S;
        if (s.shake >= 1) s.shake = null;
      }
      if (s.celebrate !== null) {
        s.celebrate += dt / WAVE_CELEBRATE_DURATION_S;
        if (s.celebrate >= 1) s.celebrate = null;
      }

      // Seam glitter: ease the intensity toward 1 while a status label is up (a
      // touch faster in than out, so it never snaps dark), and advance the fibre
      // phase so the pulse keeps running down the line while lit.
      const glitterTarget = statusActiveRef.current ? 1 : 0;
      const glitterTau =
        glitterTarget > s.glitterEnergy
          ? WAVE_GLITTER_RISE_TAU_S
          : WAVE_GLITTER_FALL_TAU_S;
      s.glitterEnergy +=
        (glitterTarget - s.glitterEnergy) * (1 - Math.exp(-dt / glitterTau));
      s.glitterPhase += dt / WAVE_GLITTER_TRAVEL_S;

      const pts = sampleRope(w, h, {
        motion: s.motion,
        windPhase: s.windPhase,
        pulsePhase: s.pulsePhase,
        ripple: s.ripple,
        shake: s.shake,
        celebrate: s.celebrate,
      });
      applyPath(pts, w, h);
      applyFiber(h);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      // A fresh dt on resume, so a long-hidden panel never integrates one huge
      // frame.
      s.lastT = null;
    };
  }, [active, reduceMotion, containerRef]);

  if (!active) return null;

  return (
    <Box
      className={`langy-wave langy-wave--fold${
        compact ? " langy-wave--compact" : ""
      }`}
      aria-hidden
    >
      <div className="langy-wave-base" />
      <div ref={clipRef} className="langy-wave-light" />
      {/* The luminous seam, restroked each frame; the fibre pulse rides ON it —
          a bright dash travelling down the same curve, lit while a status label
          is up (opacity 0 at rest). */}
      <svg className="langy-wave-svg">
        <path ref={edgeRef} className="langy-wave-seam" fill="none" />
        <path ref={fiberRef} className="langy-wave-fiber" fill="none" />
      </svg>
    </Box>
  );
}
