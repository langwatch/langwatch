import { useCallback, useEffect, useRef } from "react";

/**
 * The closed-state Langy orb's proximity micro-interaction.
 */

/** How far BEYOND the orb's own radius the cursor still pulls at it, in px. */
const PROXIMITY_RADIUS = 150;
/** Per-frame easing toward the target — a soft catch-up, frame-rate agnostic enough for a hover. */
const EASE = 0.18;
/** Max travel of the orb toward the cursor, px. Kept small — a lean, not a lunge. */
const ORB_REACH = 1.5;
/** Max travel of the glow toward the cursor, px — it reaches a little further than the body. */
const GLOW_REACH = 9;
/** Peak glow opacity at full proximity — a faint bloom, not a lamp. */
const GLOW_PEAK = 0.16;
/** Directional stretch at full proximity — a barely-perceptible liquid pull. */
const STRETCH_MAX = 0.016;
/** Uniform grow at full proximity. */
const GROW_MAX = 0.016;

/** Mutable per-effect physics state, threaded through the module-level helpers below. */
interface OrbProximityState {
  raf: number;
  /** Latest pointer position (viewport coords) and whether we have one yet. */
  px: number;
  py: number;
  havePointer: boolean;
  /** Eased proximity 0..1, and the (already proximity-scaled) unit direction
   *  from the orb toward the cursor. */
  cp: number;
  cx: number;
  cy: number;
}

function createOrbProximityState(): OrbProximityState {
  return { raf: 0, px: 0, py: 0, havePointer: false, cp: 0, cx: 0, cy: 0 };
}

function paintOrb(
  orb: HTMLButtonElement,
  glow: HTMLSpanElement | null,
  state: OrbProximityState,
): void {
  const e = state.cp;
  if (e < 0.001) {
    orb.style.transform = "";
  } else {
    // Translate toward the cursor, with a hint of lift; then a directional
    // stretch: rotate to the cursor axis, scale unevenly, rotate back — an
    // ellipse elongated toward the pointer.
    const tx = state.cx * ORB_REACH;
    const ty = state.cy * ORB_REACH - 1 * e;
    const angle = (Math.atan2(state.cy, state.cx) * 180) / Math.PI;
    const stretch = STRETCH_MAX * e;
    const grow = 1 + GROW_MAX * e;
    orb.style.transform =
      `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) ` +
      `rotate(${angle.toFixed(2)}deg) ` +
      `scale(${(grow * (1 + stretch)).toFixed(3)}, ${(grow * (1 - stretch)).toFixed(3)}) ` +
      `rotate(${(-angle).toFixed(2)}deg)`;
  }
  if (glow) {
    glow.style.opacity = (e * GLOW_PEAK).toFixed(3);
    glow.style.transform = `translate(${(state.cx * GLOW_REACH).toFixed(2)}px, ${(
      state.cy * GLOW_REACH
    ).toFixed(2)}px)`;
  }
}

/** Where the physics is heading: proximity 0..1 and the unit direction to the cursor. */
function computeProximityTarget(
  rect: DOMRect,
  state: OrbProximityState,
): { targetP: number; targetUx: number; targetUy: number } {
  if (!state.havePointer) return { targetP: 0, targetUx: 0, targetUy: 0 };
  const ocx = rect.left + rect.width / 2;
  const ocy = rect.top + rect.height / 2;
  const dx = state.px - ocx;
  const dy = state.py - ocy;
  const dist = Math.hypot(dx, dy);
  const reach = PROXIMITY_RADIUS + rect.width / 2;
  const raw = Math.max(0, 1 - dist / reach);
  const targetP = raw * raw * (3 - 2 * raw); // smoothstep — soft edges
  if (dist <= 0.001) return { targetP, targetUx: 0, targetUy: 0 };
  return { targetP, targetUx: dx / dist, targetUy: dy / dist };
}

/** Eases `state` one frame toward `target`, in place, and reports whether it has converged. */
function easeTowardTarget(
  state: OrbProximityState,
  target: { targetP: number; targetUx: number; targetUy: number },
): boolean {
  const { targetP, targetUx, targetUy } = target;
  state.cp += (targetP - state.cp) * EASE;
  state.cx += (targetUx * targetP - state.cx) * EASE;
  state.cy += (targetUy * targetP - state.cy) * EASE;
  return (
    Math.abs(state.cp - targetP) < 0.001 &&
    Math.abs(state.cx - targetUx * targetP) < 0.001 &&
    Math.abs(state.cy - targetUy * targetP) < 0.001
  );
}

function resetOrbVisuals(orb: HTMLButtonElement, glow: HTMLSpanElement | null): void {
  orb.style.transform = "";
  if (glow) {
    glow.style.opacity = "0";
    glow.style.transform = "";
  }
}

/**
 * Wires the pointermove/mouseleave/blur listeners that drive the proximity
 * loop for one mounted orb, and returns the teardown for effect cleanup.
 */
function attachOrbProximityLoop(orb: HTMLButtonElement, glow: HTMLSpanElement | null): () => void {
  const state = createOrbProximityState();

  const step = () => {
    state.raf = 0;
    const target = computeProximityTarget(orb.getBoundingClientRect(), state);
    const settled = easeTowardTarget(state, target);
    paintOrb(orb, glow, state);
    // Park when converged; the next pointer move re-arms the loop, so an idle
    // orb costs nothing.
    if (!settled) state.raf = requestAnimationFrame(step);
  };

  const kick = () => {
    if (!state.raf) state.raf = requestAnimationFrame(step);
  };
  const onMove = (ev: PointerEvent) => {
    state.px = ev.clientX;
    state.py = ev.clientY;
    state.havePointer = true;
    kick();
  };
  const onLeave = () => {
    state.havePointer = false;
    kick();
  };

  window.addEventListener("pointermove", onMove, { passive: true });
  document.addEventListener("mouseleave", onLeave);
  window.addEventListener("blur", onLeave);

  return () => {
    window.removeEventListener("pointermove", onMove);
    document.removeEventListener("mouseleave", onLeave);
    window.removeEventListener("blur", onLeave);
    if (state.raf) cancelAnimationFrame(state.raf);
    resetOrbVisuals(orb, glow);
  };
}

/**
 * The click acknowledgement: a quick warm bloom from the orb's centre that
 * reads as "it heard you". Fired on the click that OPENS the panel — at which
 * point the orb itself unmounts, so the bloom is spawned as a detached element
 * on <body> (it outlives the orb) and removes itself when the animation ends.
 */
function spawnOrbBurst(orb: HTMLButtonElement): void {
  const rect = orb.getBoundingClientRect();
  const burst = document.createElement("span");
  burst.className = "langy-orb-burst";
  burst.setAttribute("aria-hidden", "true");
  burst.style.left = `${rect.left + rect.width / 2}px`;
  burst.style.top = `${rect.top + rect.height / 2}px`;
  const remove = () => burst.remove();
  burst.addEventListener("animationend", remove, { once: true });
  // Safety net in case animationend never fires (e.g. tab backgrounded).
  window.setTimeout(remove, 500);
  document.body.appendChild(burst);
}

export function useLangyOrbProximity({ enabled }: { enabled: boolean }) {
  const orbRef = useRef<HTMLButtonElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const orb = orbRef.current;
    if (!orb) return;
    return attachOrbProximityLoop(orb, glowRef.current);
  }, [enabled]);

  // A no-op under reduced motion (the panel just opens instantly) — the
  // early-outs below just mean there is no orb to burst from.
  const activate = useCallback(() => {
    if (!enabled || typeof document === "undefined") return;
    const orb = orbRef.current;
    if (!orb) return;
    spawnOrbBurst(orb);
  }, [enabled]);

  return { orbRef, glowRef, activate };
}
