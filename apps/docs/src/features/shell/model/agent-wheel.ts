export const CODING_AGENTS = ["claude", "codex", "copilot", "gemini", "opencode"];

/** Slot-machine names that flash past on a fast spin; never selectable, never announced. */
export const CASINO_NAMES = [
  "jackpot",
  "lucky 7",
  "cherry",
  "bar bar bar",
  "triple 7",
  "all in",
  "high roller",
  "royal flush",
];

/** Pixels between names, friction time constants (seconds) and speeds in names per second. */
export const WHEEL = {
  stepPx: 15,
  spinTau: 0.75,
  snapTau: 0.12,
  maxSpeed: 45,
  flickSpeed: 2,
  casinoSpeed: 5,
  sampleMs: 100,
};

/** Signed steps from the chosen agent, wrapped so the wheel shows two either side. */
export function wheelOffset({ index, chosen }: { index: number; chosen: number }) {
  const count = CODING_AGENTS.length;
  return ((((index - chosen) % count) + count + 2) % count) - 2;
}

/** The same offset for a reel turned part way: a name wraps round the back at 2.5 steps. */
export function reelOffset({ index, position }: { index: number; position: number }) {
  const count = CODING_AGENTS.length;
  return ((((index - position) % count) + count + count / 2) % count) - count / 2;
}

export function agentAt({ slot }: { slot: number }) {
  const count = CODING_AGENTS.length;
  return CODING_AGENTS[((Math.round(slot) % count) + count) % count] ?? "claude";
}

/** Fades 1, 0.4, 0.14 at whole steps, as the resting styles do, to nothing at the back. */
export function nameOpacity({ distance }: { distance: number }) {
  const stops = [1, 0.4, 0.14, 0];
  const at = Math.min(Math.abs(distance), 2.5);
  const lower = Math.min(Math.floor(at), 2);
  const span = lower === 2 ? 0.5 : 1;
  const from = stops[lower] ?? 0;
  return from + ((stops[lower + 1] ?? 0) - from) * ((at - lower) / span);
}

/** Pointer velocity in names per second over the last moments of a drag; down turns back. */
export function flickVelocity({ samples }: { samples: { time: number; y: number }[] }) {
  const last = samples.at(-1);
  if (!last) return 0;
  const first = samples.find((sample) => last.time - sample.time <= WHEEL.sampleMs) ?? last;
  const elapsed = (last.time - first.time) / 1000;
  return elapsed > 0 ? -(last.y - first.y) / WHEEL.stepPx / elapsed : 0;
}

/** Where a released reel comes to rest: friction carries it speed x tau, then the nearest name. */
export function restingSlot({ position, velocity }: { position: number; velocity: number }) {
  if (Math.abs(velocity) < WHEEL.flickSpeed) return Math.round(position);
  const speed = Math.max(-WHEEL.maxSpeed, Math.min(WHEEL.maxSpeed, velocity));
  return Math.round(position + speed * WHEEL.spinTau);
}

/** One frame of friction: the gap to the goal decays exponentially, an ease that ends still. */
export function approach({
  position,
  goal,
  tau,
  seconds,
}: {
  position: number;
  goal: number;
  tau: number;
  seconds: number;
}) {
  const next = goal - (goal - position) * Math.exp(-seconds / tau);
  return Math.abs(goal - next) * WHEEL.stepPx < 0.2 ? goal : next;
}

/**
 * The casino name a slot shows when it comes round at this speed: more of them the faster it
 * turns, none below the threshold and none within two names of where it will land.
 */
export function casinoName({
  slot,
  speed,
  target,
}: {
  slot: number;
  speed: number;
  target: number;
}) {
  const excess = (Math.abs(speed) - WHEEL.casinoSpeed) / WHEEL.casinoSpeed;
  if (excess <= 0 || Math.abs(slot - target) <= 2) return undefined;
  const share = Math.min(0.65, 0.35 + excess * 0.3);
  const draw = (Math.abs(slot) * 0.618034) % 1;
  if (draw >= share) return undefined;
  return CASINO_NAMES[Math.abs(slot * 7) % CASINO_NAMES.length];
}
