import {
  hasTokens,
  runningTool,
  type ThinkingMessage,
} from "./langyThinkingLine";

/**
 * The fold's motion vocabulary — what the Langy panel's decorative fold says
 * with its movement, and how.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 *
 * The fold moves with LANGY'S OWN BEHAVIOUR, never with the user's cursor. It
 * used to lean toward the pointer with a spring-loaded shove — which looked
 * alive for a minute and then read as a distraction reacting to the wrong
 * things. Now its motion is a quiet status channel: each activity state has a
 * distinct, LOW-amplitude character, so a change in motion carries information
 * (Langy started thinking, Langy is writing) instead of demanding attention.
 *
 * Spec: specs/langy/langy-panel-fold-motion.feature
 *
 * ── THE VOCABULARY ──────────────────────────────────────────────────────────
 *
 *   idle       almost still — a slowed version of the gentle resting wind.
 *              This is the permanent look of a settled panel.
 *   waiting    a turn was sent but nothing is on the wire yet. Barely above
 *              idle; the WAKE RIPPLE (a one-shot pass down the rope, fired on
 *              the idle→working transition) is what marks the send.
 *   thinking   reasoning is streaming — a slow deep swell: more amplitude on
 *              the long wavelength, almost no flutter, slow drift. Clearly
 *              calmer than streaming.
 *   streaming  tokens are arriving — the liveliest state: faster travelling
 *              wind with more flutter. Still subtle.
 *   tool       a tool is running — a slow rhythmic pulse: the amplitude
 *              breathes on a steady period, distinct from writing.
 *   settling   the turn failed or is quietly recovering — ease toward
 *              stillness; a failure must never look frantic.
 *
 * Activity is derived from the SAME provable wire signals as the thinking line
 * (`langyThinkingLine.ts`): the tool stream, streamed prose, live reasoning.
 * The fold therefore never claims work that isn't happening.
 *
 * ── NO POPS ─────────────────────────────────────────────────────────────────
 *
 * States can flip fast (tool→stream→tool). The renderer never jumps between
 * parameter sets: it holds ONE smoothed parameter vector and eases it toward
 * the active state's targets every frame (`stepWaveMotion`). Energy falls
 * slower than it rises, so the end of a turn eases back to idle over a couple
 * of seconds rather than snapping.
 */

export type LangyWaveActivity =
  | "idle"
  | "waiting"
  | "thinking"
  | "streaming"
  | "tool"
  | "settling";

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
 * Per-state motion targets. Invariants the unit tests pin:
 * streaming is the most energetic and fastest; thinking is calmer (slower,
 * deeper, near-zero flutter) than streaming; only the tool state pulses;
 * settling is the stillest; nothing exceeds energy 1.
 */
export const WAVE_MOTION_TARGETS: Record<LangyWaveActivity, LangyWaveMotion> = {
  // Idle is the permanent look and must be nearly imperceptible — a barely-there
  // drift, not a wash. Working states bloom above it, then ease back down. These
  // are multipliers; the renderer's absolute pixel amplitudes are deliberately
  // tiny (see `sampleRope`), so even "streaming" only whispers.
  idle: { energy: 0.22, drift: 0.45, flutter: 0.25, pulse: 0 },
  // WAITING IS THE ONE PEOPLE WATCH. It is the cold-start window — the longest
  // stretch anyone stares at this panel — and it used to sit at 0.35 energy with
  // idle's own flutter, which is to say it looked switched off at exactly the
  // moment the user most wants to know something is happening. The wake ripple
  // marked the send and then the rope went back to almost-still.
  //
  // It now blows: high flutter and near-streaming drift, so the rope wiggles in
  // the wind rather than merely drifting. It stays UNDER streaming (that
  // ordering is load-bearing and pinned by test) — the difference is character
  // rather than volume, a gusty wait against a purposeful travelling wind.
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
 * Rising energy answers within ~half a second (a state change should be
 * legible promptly); falling energy takes ~2s to visually settle (a turn's end
 * eases out, never snaps). The fall is a little quicker than it was, because the
 * working states now sit higher — from a louder peak the same time constant left
 * the rope perceptibly moving after the answer had landed. Character params (drift/flutter/pulse) share one
 * medium time constant so waveform shape morphs smoothly through rapid
 * tool→stream→tool flips.
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
 *
 * On top of the continuous ambient motion, the fold plays short, legible
 * GESTURES on the events of a turn — the fold's personality, kept quiet at rest
 * and expressive only at the moment something happens:
 *
 *   • seam glitter — while a STATUS LABEL is showing on the conversation (the
 *     orange-orbed "Analysing traces…" rows), a bright warm pulse runs down the
 *     seam like light down a fibre. Not a one-shot: a sustained shimmer whose
 *     intensity eases in while the status is up and out when it clears.
 *   • shake        — the turn FAILED: a brief nervous side-to-side shiver, then
 *     still. Never frantic, never long.
 *   • celebrate    — the turn SUCCEEDED: a quick, springy, happy wag down the
 *     rope that eases out. The one upbeat beat in the vocabulary.
 *
 * Shake and celebrate are one-shots with decaying envelopes; the glitter is a
 * level that tracks the status label. The renderer owns the clock.
 */
/** Error shake: a brief, nervous side-to-side shiver of the whole rope. */
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
 *
 * Priority mirrors the thinking line: a failure/recovery settles everything;
 * otherwise the most specific provable signal wins (tool > tokens > reasoning),
 * and a turn with nothing on the wire yet is merely "waiting".
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
  const last = [...messages].reverse().find((m) => m.role === "assistant");
  if (runningTool(last)) return "tool";
  if (hasTokens(last)) return "streaming";
  if (hasLiveReasoning) return "thinking";
  return "waiting";
}

/** Exponential approach with a real time constant — frame-rate independent. */
function approach(
  current: number,
  target: number,
  dt: number,
  tau: number,
): number {
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
      target.energy > current.energy
        ? WAVE_ENERGY_RISE_TAU_S
        : WAVE_ENERGY_FALL_TAU_S,
    ),
    drift: approach(current.drift, target.drift, dt, WAVE_CHARACTER_TAU_S),
    flutter: approach(
      current.flutter,
      target.flutter,
      dt,
      WAVE_CHARACTER_TAU_S,
    ),
    pulse: approach(current.pulse, target.pulse, dt, WAVE_CHARACTER_TAU_S),
  };
}

/**
 * Did this activity transition mark the START of a turn? That — and only that —
 * fires the one gentle wake ripple. Working→working flips (tool→streaming)
 * never ripple, and neither does easing back to rest.
 */
export function isWakeTransition(
  previous: LangyWaveActivity,
  next: LangyWaveActivity,
): boolean {
  const wasResting = previous === "idle" || previous === "settling";
  const isWorking =
    next === "waiting" ||
    next === "thinking" ||
    next === "streaming" ||
    next === "tool";
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
export function isErrorTransition(
  previous: LangyWaveActivity,
  next: LangyWaveActivity,
): boolean {
  return previous !== "settling" && next === "settling";
}

/**
 * Did a working turn just resolve cleanly back to rest? That — and only that —
 * fires the happy wag. A `settling → idle` wind-down is NOT a success (the shake
 * already spoke for that turn), and idle→idle noise never celebrates.
 */
export function isSuccessTransition(
  previous: LangyWaveActivity,
  next: LangyWaveActivity,
): boolean {
  return isWorkingActivity(previous) && next === "idle";
}
