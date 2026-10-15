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

/** Where the eased pull wants to be: proximity 0..1 and the unit direction toward the cursor. */
type OrbTarget = { p: number; ux: number; uy: number };

const AT_REST: OrbTarget = { p: 0, ux: 0, uy: 0 };

/** The pull the cursor exerts on the orb — smoothstep over its reach, so the edge is soft. */
function orbTarget({
  rect,
  pointer,
}: {
  rect: DOMRect;
  pointer: { x: number; y: number } | undefined;
}): OrbTarget {
  if (!pointer) return AT_REST;
  const dx = pointer.x - (rect.left + rect.width / 2);
  const dy = pointer.y - (rect.top + rect.height / 2);
  const dist = Math.hypot(dx, dy);
  const raw = Math.max(0, 1 - dist / (PROXIMITY_RADIUS + rect.width / 2));
  const p = raw * raw * (3 - 2 * raw);
  if (dist <= 0.001) return { p, ux: 0, uy: 0 };
  return { p, ux: dx / dist, uy: dy / dist };
}

/**
 * A lean toward the cursor with a hint of lift, then a directional stretch: rotate to the cursor
 * axis, scale unevenly, rotate back — an ellipse elongated toward the pointer.
 */
function orbTransform({ p, x, y }: { p: number; x: number; y: number }): string {
  if (p < 0.001) return "";
  const angle = (Math.atan2(y, x) * 180) / Math.PI;
  const stretch = STRETCH_MAX * p;
  const grow = 1 + GROW_MAX * p;
  return (
    `translate(${(x * ORB_REACH).toFixed(2)}px, ${(y * ORB_REACH - p).toFixed(2)}px) ` +
    `rotate(${angle.toFixed(2)}deg) ` +
    `scale(${(grow * (1 + stretch)).toFixed(3)}, ${(grow * (1 - stretch)).toFixed(3)}) ` +
    `rotate(${(-angle).toFixed(2)}deg)`
  );
}

/**
 * The orb's eased pull toward the pointer, driven imperatively. It parks once converged, and the
 * next pointer move re-arms the loop, so an idle orb costs nothing.
 */
class OrbProximity {
  private raf = 0;
  private pointer: { x: number; y: number } | undefined;
  private p = 0;
  private x = 0;
  private y = 0;

  constructor(
    private readonly orb: HTMLElement,
    private readonly glow: HTMLElement | null,
  ) {
    window.addEventListener("pointermove", this.onMove, { passive: true });
    document.addEventListener("mouseleave", this.onLeave);
    window.addEventListener("blur", this.onLeave);
  }

  dispose(): void {
    window.removeEventListener("pointermove", this.onMove);
    document.removeEventListener("mouseleave", this.onLeave);
    window.removeEventListener("blur", this.onLeave);
    if (this.raf) cancelAnimationFrame(this.raf);
    this.orb.style.transform = "";
    if (!this.glow) return;
    this.glow.style.opacity = "0";
    this.glow.style.transform = "";
  }

  private readonly onMove = (event: PointerEvent) => {
    this.pointer = { x: event.clientX, y: event.clientY };
    this.kick();
  };

  private readonly onLeave = () => {
    this.pointer = undefined;
    this.kick();
  };

  private kick(): void {
    if (!this.raf) this.raf = requestAnimationFrame(this.step);
  }

  private readonly step = () => {
    this.raf = 0;
    const target = orbTarget({ rect: this.orb.getBoundingClientRect(), pointer: this.pointer });
    const goalX = target.ux * target.p;
    const goalY = target.uy * target.p;
    this.p += (target.p - this.p) * EASE;
    this.x += (goalX - this.x) * EASE;
    this.y += (goalY - this.y) * EASE;
    this.paint();
    const moving = [target.p - this.p, goalX - this.x, goalY - this.y].some(
      (gap) => Math.abs(gap) >= 0.001,
    );
    if (moving) this.raf = requestAnimationFrame(this.step);
  };

  private paint(): void {
    this.orb.style.transform = orbTransform({ p: this.p, x: this.x, y: this.y });
    if (!this.glow) return;
    this.glow.style.opacity = (this.p * GLOW_PEAK).toFixed(3);
    this.glow.style.transform = `translate(${(this.x * GLOW_REACH).toFixed(2)}px, ${(this.y * GLOW_REACH).toFixed(2)}px)`;
  }
}

/**
 * The click acknowledgement: a quick warm bloom from the orb's centre that reads as "it heard
 * you". The orb unmounts on that click, so the bloom lives on <body> and removes itself.
 */
function spawnOrbBurst(orb: HTMLElement): void {
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
    const orb = orbRef.current;
    if (!enabled || !orb) return;
    const proximity = new OrbProximity(orb, glowRef.current);
    return () => proximity.dispose();
  }, [enabled]);

  // A no-op under reduced motion: the panel just opens instantly.
  const activate = useCallback(() => {
    const orb = orbRef.current;
    if (enabled && orb) spawnOrbBurst(orb);
  }, [enabled]);

  return { orbRef, glowRef, activate };
}
