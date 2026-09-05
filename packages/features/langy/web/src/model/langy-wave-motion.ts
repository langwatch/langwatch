import {
  currentTurnAssistant,
  hasTokens,
  runningTool,
  type ThinkingMessage,
} from "./langy-thinking-line";

/**
 * Maps observable Langy activity to low-amplitude fold motion. The fold never follows
 * the pointer or claims unobserved work.
 */

export type LangyWaveActivity = "idle" | "waiting" | "thinking" | "streaming" | "tool" | "settling";

/**
 * The smoothed parameter vector the renderer folds into the rope every frame.
 * All values are unitless multipliers; the renderer owns the absolute (small)
 * pixel amplitudes.
 */
export interface LangyWaveMotion {
  /** Master amplitude, 0..1. Kept low across the board — see the targets. */
  energy: number;
  /** Phase speed of the travelling wind. */
  drift: number;
  /** Weight of the short-wavelength component (0 = pure long swell). */
  flutter: number;
  /** Depth of the rhythmic amplitude pulse, 0..1. Only the tool state has it. */
  pulse: number;
}

/**
 * Per-state motion targets.
 */
export const WAVE_MOTION_TARGETS: Record<LangyWaveActivity, LangyWaveMotion> = {
  // Idle is the permanent look and must be nearly imperceptible — a barely-there
  // drift, not a wash. Working states bloom above it, then ease back down. These
  // are multipliers; the renderer's absolute pixel amplitudes are deliberately
  // tiny (see `sampleRope`), so even "streaming" only whispers.
  idle: { energy: 0.22, drift: 0.45, flutter: 0.25, pulse: 0 },
  // WAITING IS THE ONE PEOPLE WATCH.
  waiting: { energy: 0.58, drift: 0.8, flutter: 0.55, pulse: 0 },
  // Thinking stays the deep slow swell: MORE amplitude than waiting, much less
  // flutter and much less drift. Reasoning reads as considered, not agitated.
  thinking: { energy: 0.62, drift: 0.5, flutter: 0.14, pulse: 0 },
  streaming: { energy: 0.9, drift: 1.15, flutter: 0.8, pulse: 0 },
  tool: { energy: 0.6, drift: 0.55, flutter: 0.16, pulse: 1 },
  settling: { energy: 0.08, drift: 0.32, flutter: 0.18, pulse: 0 },
};

/** Where the smoothed vector starts: at rest. */
export function restingWaveMotion(): LangyWaveMotion {
  return { ...WAVE_MOTION_TARGETS.idle };
}

/**
 * Rising energy answers within ~half a second (a state change should be legible
 * promptly); falling energy takes ~2s to visually settle (a turn's end eases out, never
 * snaps).
 */
export const WAVE_ENERGY_RISE_TAU_S = 0.45;
export const WAVE_ENERGY_FALL_TAU_S = 0.7;
export const WAVE_CHARACTER_TAU_S = 0.6;

/** The wake ripple's top-to-bottom travel time. */
export const WAVE_RIPPLE_TRAVEL_S = 1.4;
/** The tool pulse's breathing period. */
export const WAVE_PULSE_PERIOD_S = 2.6;

/**
 * ── ONE-SHOT GESTURES ───────────────────────────────────────────────────────
 */
export const WAVE_SHAKE_DURATION_S = 0.5;
/** Success vibrate: a quick, springy, happy wag that eases out. */
export const WAVE_CELEBRATE_DURATION_S = 0.75;
/** Time for one seam-glitter pulse to run the fibre (travel + dark gap). */
export const WAVE_GLITTER_TRAVEL_S = 2.4;
/** Glitter intensity eases IN this fast when a status label appears… */
export const WAVE_GLITTER_RISE_TAU_S = 0.35;
/** …and OUT this slow when it clears, so the fibre never snaps dark. */
export const WAVE_GLITTER_FALL_TAU_S = 0.9;

/**
 * Map Langy's live turn signals to the fold's activity state.
 */
export function deriveWaveActivity({
  turnInFlight,
  isSettling,
  hasLiveReasoning,
  messages,
}: {
  /** A turn is live (transport busy OR the durable running-turn signal). */
  turnInFlight: boolean;
  /** The turn failed, or a quiet auto-recovery is pending. */
  isSettling: boolean;
  /** Reasoning deltas are on the wire right now. */
  hasLiveReasoning: boolean;
  messages: ThinkingMessage[];
}): LangyWaveActivity {
  if (isSettling) return "settling";
  if (!turnInFlight) return "idle";
  const last = currentTurnAssistant(messages);
  if (runningTool(last)) return "tool";
  if (hasTokens(last)) return "streaming";
  if (hasLiveReasoning) return "thinking";
  return "waiting";
}

/** Exponential approach with a real time constant — frame-rate independent. */
function approach(current: number, target: number, dt: number, tau: number): number {
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

/**
 * One smoothing step: ease the live parameter vector toward the active state's
 * targets. Pure — the renderer owns the clock and calls this once per frame.
 */
export function stepWaveMotion({
  current,
  activity,
  dt,
}: {
  current: LangyWaveMotion;
  activity: LangyWaveActivity;
  dt: number;
}): LangyWaveMotion {
  const target = WAVE_MOTION_TARGETS[activity];
  return {
    energy: approach(
      current.energy,
      target.energy,
      dt,
      target.energy > current.energy ? WAVE_ENERGY_RISE_TAU_S : WAVE_ENERGY_FALL_TAU_S,
    ),
    drift: approach(current.drift, target.drift, dt, WAVE_CHARACTER_TAU_S),
    flutter: approach(current.flutter, target.flutter, dt, WAVE_CHARACTER_TAU_S),
    pulse: approach(current.pulse, target.pulse, dt, WAVE_CHARACTER_TAU_S),
  };
}

/**
 * Did this activity transition mark the START of a turn? That — and only that —
 * fires the one gentle wake ripple. Working→working flips (tool→streaming)
 * never ripple, and neither does easing back to rest.
 */
export function isWakeTransition(previous: LangyWaveActivity, next: LangyWaveActivity): boolean {
  const wasResting = previous === "idle" || previous === "settling";
  const isWorking =
    next === "waiting" || next === "thinking" || next === "streaming" || next === "tool";
  return wasResting && isWorking;
}

/** The four states in which Langy is actively working a turn. */
function isWorkingActivity(activity: LangyWaveActivity): boolean {
  return (
    activity === "waiting" ||
    activity === "thinking" ||
    activity === "streaming" ||
    activity === "tool"
  );
}

/**
 * Did the turn just FAIL? Entering `settling` from anywhere else fires the one
 * nervous shake. Staying in settling (a recovery that drags on) never re-shakes.
 */
export function isErrorTransition(previous: LangyWaveActivity, next: LangyWaveActivity): boolean {
  return previous !== "settling" && next === "settling";
}

/**
 * Did a working turn just resolve cleanly back to rest? That — and only that —
 * fires the happy wag. A `settling → idle` wind-down is NOT a success (the shake
 * already spoke for that turn), and idle→idle noise never celebrates.
 */
export function isSuccessTransition(previous: LangyWaveActivity, next: LangyWaveActivity): boolean {
  return isWorkingActivity(previous) && next === "idle";
}
