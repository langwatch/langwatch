import { useCallback, useEffect, useRef } from "react";

/**
 * The closed-state Langy orb's proximity micro-interaction.
 *
 * As the cursor approaches the orb (within `PROXIMITY_RADIUS` of its edge) two
 * things bloom, both scaled by how close the cursor is and eased every frame so
 * nothing pops:
 *
 *   • a soft warm GLOW leans OUT of the orb toward the cursor — light reaching
 *     for the pointer;
 *   • the orb itself DEFORMS toward the cursor — a small translate plus a
 *     directional stretch (elongated along the cursor axis), so it reads as
 *     liquid glass being drawn, not a rigid button nudging.
 *
 * This is the ONE place a Langy surface reacts to the pointer, and deliberately
 * so: it is a hover affordance on an interactive target (you are aiming AT it),
 * not ambient chrome reacting to unrelated movement — the mistake the fold's
 * old cursor physics made. It is imperative (refs + a rAF that self-parks when
 * settled) so a moving pointer never triggers React renders, and it is disabled
 * wholesale under reduced motion.
 *
 * Returns the refs to attach: `orbRef` on the orb button, `glowRef` on the glow
 * layer inside it.
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

export function useLangyOrbProximity({ enabled }: { enabled: boolean }) {
  const orbRef = useRef<HTMLButtonElement>(null);
  const glowRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!enabled) return;
    const orb = orbRef.current;
    if (!orb) return;
    const glow = glowRef.current;

    let raf = 0;
    // Latest pointer position (viewport coords) and whether we have one yet.
    let px = 0;
    let py = 0;
    let havePointer = false;
    // Eased state: proximity 0..1, and the (already proximity-scaled) unit
    // direction from the orb toward the cursor.
    let cp = 0;
    let cx = 0;
    let cy = 0;

    const paint = () => {
      const e = cp;
      if (e < 0.001) {
        orb.style.transform = "";
      } else {
        // Translate toward the cursor, with a hint of lift; then a directional
        // stretch: rotate to the cursor axis, scale unevenly, rotate back — an
        // ellipse elongated toward the pointer.
        const tx = cx * ORB_REACH;
        const ty = cy * ORB_REACH - 1 * e;
        const angle = (Math.atan2(cy, cx) * 180) / Math.PI;
        const stretch = STRETCH_MAX * e;
        const grow = 1 + GROW_MAX * e;
        orb.style.transform =
          `translate(${tx.toFixed(2)}px, ${ty.toFixed(2)}px) ` +
          `rotate(${angle.toFixed(2)}deg) ` +
          `scale(${(grow * (1 + stretch)).toFixed(3)}, ${(
            grow *
            (1 - stretch)
          ).toFixed(3)}) ` +
          `rotate(${(-angle).toFixed(2)}deg)`;
      }
      if (glow) {
        glow.style.opacity = (e * GLOW_PEAK).toFixed(3);
        glow.style.transform = `translate(${(cx * GLOW_REACH).toFixed(2)}px, ${(
          cy * GLOW_REACH
        ).toFixed(2)}px)`;
      }
    };

    const step = () => {
      raf = 0;
      const rect = orb.getBoundingClientRect();
      const ocx = rect.left + rect.width / 2;
      const ocy = rect.top + rect.height / 2;

      let targetP = 0;
      let targetUx = 0;
      let targetUy = 0;
      if (havePointer) {
        const dx = px - ocx;
        const dy = py - ocy;
        const dist = Math.hypot(dx, dy);
        const reach = PROXIMITY_RADIUS + rect.width / 2;
        const raw = Math.max(0, 1 - dist / reach);
        targetP = raw * raw * (3 - 2 * raw); // smoothstep — soft edges
        if (dist > 0.001) {
          targetUx = dx / dist;
          targetUy = dy / dist;
        }
      }

      cp += (targetP - cp) * EASE;
      cx += (targetUx * targetP - cx) * EASE;
      cy += (targetUy * targetP - cy) * EASE;
      paint();

      const settled =
        Math.abs(cp - targetP) < 0.001 &&
        Math.abs(cx - targetUx * targetP) < 0.001 &&
        Math.abs(cy - targetUy * targetP) < 0.001;
      // Park when converged; the next pointer move re-arms the loop, so an idle
      // orb costs nothing.
      if (!settled) raf = requestAnimationFrame(step);
    };

    const kick = () => {
      if (!raf) raf = requestAnimationFrame(step);
    };
    const onMove = (ev: PointerEvent) => {
      px = ev.clientX;
      py = ev.clientY;
      havePointer = true;
      kick();
    };
    const onLeave = () => {
      havePointer = false;
      kick();
    };

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("mouseleave", onLeave);
    window.addEventListener("blur", onLeave);

    return () => {
      window.removeEventListener("pointermove", onMove);
      document.removeEventListener("mouseleave", onLeave);
      window.removeEventListener("blur", onLeave);
      if (raf) cancelAnimationFrame(raf);
      orb.style.transform = "";
      if (glow) {
        glow.style.opacity = "0";
        glow.style.transform = "";
      }
    };
  }, [enabled]);

  // The click acknowledgement: a quick warm bloom from the orb's centre that
  // reads as "it heard you". Fired on the click that OPENS the panel — at which
  // point the orb itself unmounts, so the bloom is spawned as a detached element
  // on <body> (it outlives the orb) and removes itself when the animation ends.
  // A no-op under reduced motion (the panel just opens instantly).
  const activate = useCallback(() => {
    if (!enabled || typeof document === "undefined") return;
    const orb = orbRef.current;
    if (!orb) return;
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
  }, [enabled]);

  return { orbRef, glowRef, activate };
}
