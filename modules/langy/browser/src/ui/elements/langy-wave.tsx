import { Box } from "@chakra-ui/react";
import { type RefObject, useEffect, useRef } from "react";

import {
  isErrorTransition,
  isSuccessTransition,
  isWakeTransition,
  type LangyWaveActivity,
  type LangyWaveMotion,
  restingWaveMotion,
  stepWaveMotion,
  WAVE_CELEBRATE_DURATION_S,
  WAVE_GLITTER_FALL_TAU_S,
  WAVE_GLITTER_RISE_TAU_S,
  WAVE_GLITTER_TRAVEL_S,
  WAVE_PULSE_PERIOD_S,
  WAVE_RIPPLE_TRAVEL_S,
  WAVE_SHAKE_DURATION_S,
} from "../../model/langy-wave-motion.ts";

/**
 * Draws the panel fold from Langy's activity, never pointer movement. Ambient states
 * ease through one motion vector; success, failure and status gestures are bounded
 * overlays.
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
 * cubic-bezier conversion so the discrete samples read as one smooth line rather than a
 * polyline.
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
      x += Math.sin(Math.PI * ripple) * w * 0.018 * Math.exp(-(((ny - ripple) / 0.16) ** 2));
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

/** The DOM nodes the frame loop restrokes, reached directly rather than re-rendering React. */
type WaveNodes = {
  clipRef: RefObject<HTMLDivElement | null>;
  edgeRef: RefObject<SVGPathElement | null>;
  fiberRef: RefObject<SVGPathElement | null>;
};

/**
 * The clip layer wants the CLOSED path; the stroked seam and the fibre pulse want the OPEN curve,
 * so the fibre's travelling dash never wanders onto the off-canvas closing edges.
 */
function applyWavePath({
  nodes,
  pts,
  w,
  h,
}: {
  nodes: WaveNodes;
  pts: RopePoint[];
  w: number;
  h: number;
}) {
  if (nodes.clipRef.current) {
    nodes.clipRef.current.style.clipPath = `path('${ropePath(pts, w, h)}')`;
  }
  const curve = ropeCurve(pts);
  nodes.edgeRef.current?.setAttribute("d", curve);
  nodes.fiberRef.current?.setAttribute("d", curve);
}

const FIBER_DASH = 42;
const FIBER_PEAK = 0.5;

/**
 * The seam glitter: a second copy of the seam stroked bright with one short dash and a long dark
 * gap, its offset advanced each frame so the pulse runs down the line (negative = top to bottom).
 */
function applyWaveFiber({
  fiber,
  state,
  h,
}: {
  fiber: SVGPathElement | null;
  state: WaveState;
  h: number;
}) {
  if (!fiber) return;
  const energy = state.glitterEnergy;
  if (energy < 0.004) {
    fiber.style.opacity = "0";
    return;
  }
  const gap = (h + 120) * 1.25;
  const period = FIBER_DASH + gap;
  fiber.style.strokeDasharray = `${FIBER_DASH.toFixed(1)} ${gap.toFixed(1)}`;
  fiber.style.strokeDashoffset = (-state.glitterPhase * period).toFixed(1);
  fiber.style.opacity = (energy * FIBER_PEAK).toFixed(3);
}

/**
 * Reduced motion: draw the resting fold and stop — no rAF, no gestures, the fibre dark; it
 * redraws only when the panel actually resizes.
 */
function drawStillWave({ el, nodes }: { el: HTMLElement; nodes: WaveNodes }): () => void {
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
    applyWavePath({ nodes, pts, w, h });
    if (nodes.fiberRef.current) nodes.fiberRef.current.style.opacity = "0";
  };
  draw();
  const resizeObserver = new ResizeObserver(draw);
  resizeObserver.observe(el);
  return () => resizeObserver.disconnect();
}

/**
 * A state change fires the one-shot gestures: the idle→working edge sends the wake ripple,
 * entering settling shakes (failure), a clean return to idle wags (success).
 */
function fireWaveGestures(state: WaveState, activity: LangyWaveActivity): void {
  if (activity === state.lastActivity) return;
  if (isWakeTransition(state.lastActivity, activity)) state.ripple = 0;
  if (isErrorTransition(state.lastActivity, activity)) state.shake = 0;
  if (isSuccessTransition(state.lastActivity, activity)) state.celebrate = 0;
  state.lastActivity = activity;
}

const GESTURE_DURATIONS_S = {
  ripple: WAVE_RIPPLE_TRAVEL_S,
  shake: WAVE_SHAKE_DURATION_S,
  celebrate: WAVE_CELEBRATE_DURATION_S,
} as const;

/** Each running gesture moves on by its own duration, and ends at 1. */
function advanceWaveGestures(state: WaveState, dt: number): void {
  for (const gesture of ["ripple", "shake", "celebrate"] as const) {
    const progress = state[gesture];
    if (progress === null) continue;
    const next = progress + dt / GESTURE_DURATIONS_S[gesture];
    state[gesture] = next >= 1 ? null : next;
  }
}

/**
 * Seam glitter eases toward lit while a status label is up — a touch faster in than out, so it
 * never snaps dark — and its phase keeps the pulse running down the line while lit.
 */
function advanceWaveGlitter(state: WaveState, dt: number, statusActive: boolean): void {
  const target = statusActive ? 1 : 0;
  const tau = target > state.glitterEnergy ? WAVE_GLITTER_RISE_TAU_S : WAVE_GLITTER_FALL_TAU_S;
  state.glitterEnergy += (target - state.glitterEnergy) * (1 - Math.exp(-dt / tau));
  state.glitterPhase += dt / WAVE_GLITTER_TRAVEL_S;
}

/**
 * One frame: steer the smoothed motion toward the current activity, ACCUMULATE the phases at the
 * smoothed speeds (so a speed change never jumps the waveform), advance gestures and glitter.
 */
function stepWave({
  state,
  activity,
  statusActive,
  dt,
}: {
  state: WaveState;
  activity: LangyWaveActivity;
  statusActive: boolean;
  dt: number;
}): void {
  fireWaveGestures(state, activity);
  state.motion = stepWaveMotion({ current: state.motion, activity, dt });
  state.windPhase += dt * state.motion.drift;
  state.pulsePhase += dt * ((Math.PI * 2) / WAVE_PULSE_PERIOD_S);
  advanceWaveGestures(state, dt);
  advanceWaveGlitter(state, dt, statusActive);
}

/**
 * The rope reacts to Langy's ACTIVITY and nothing else — not the cursor, menus or focus. The loop
 * reads activity and status through refs, so a change steers it rather than restarting it.
 */
function runWaveLoop({
  el,
  nodes,
  state,
  activityRef,
  statusActiveRef,
}: {
  el: HTMLElement;
  nodes: WaveNodes;
  state: WaveState;
  activityRef: RefObject<LangyWaveActivity>;
  statusActiveRef: RefObject<boolean>;
}): () => void {
  let raf = 0;
  const tick = (now: number) => {
    raf = requestAnimationFrame(tick);
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (w === 0 || h === 0) return;
    const dt = Math.min(0.05, state.lastT ? (now - state.lastT) / 1000 : 1 / 60);
    state.lastT = now;
    stepWave({ state, activity: activityRef.current, statusActive: statusActiveRef.current, dt });
    const pts = sampleRope(w, h, state);
    applyWavePath({ nodes, pts, w, h });
    applyWaveFiber({ fiber: nodes.fiberRef.current, state, h });
  };
  raf = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(raf);
    // A fresh dt on resume, so a long-hidden panel never integrates one huge frame.
    state.lastT = null;
  };
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
  containerRef: RefObject<HTMLElement | null>;
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
   * The narrow docked sidebar. The fold still reads fully — same seam, same fibre — but
   * the broad tone fills over-power the tall empty column, so `compact` softens ONLY
   * those fills (see `.langy-wave--compact`).
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
    const el = containerRef.current;
    if (!active || !el) return;
    const nodes = { clipRef, edgeRef, fiberRef };
    if (reduceMotion) return drawStillWave({ el, nodes });
    return runWaveLoop({ el, nodes, state: state.current, activityRef, statusActiveRef });
  }, [active, reduceMotion, containerRef]);

  if (!active) return null;

  return (
    <Box
      className={`langy-wave langy-wave--fold${compact ? " langy-wave--compact" : ""}`}
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
