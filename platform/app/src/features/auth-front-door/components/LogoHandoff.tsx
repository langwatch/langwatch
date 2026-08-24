import { useEffect, useRef, useState } from "react";
import { FullLogo } from "~/components/icons/FullLogo";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import "../authFrontDoor.css";
import { beginEntrance, endEntrance } from "../logic/entrance";

/**
 * The handoff: the mark the loading screen was showing walks into the top of
 * the auth card, and the card comes up behind it.
 *
 * It is the same mark, at the same size, in the same place it was already
 * being shown (`LoadingScreen` centres `FullLogo` at 155x38 scaled 1.2), so
 * the two screens read as one element moving rather than two elements
 * swapping. It lands on the card's own logo slot and cross-fades into it over
 * the last stretch, because the card's mark is the icon alone.
 *
 * FLIP, with three rules:
 *
 *   - transform only. No layout property is animated, so the browser never
 *     reflows mid-motion and the card underneath is composited, not repainted.
 *   - once per page load. A route change, a step change and the sign-up morph
 *     are all the same page continuing; replaying an arrival on each one would
 *     be a tic.
 *   - nothing waits on it. The overlay is `pointer-events: none`, the card is
 *     mounted and live from the first frame, and the only thing the motion
 *     gates is when focus is taken (`useEntranceSettled`).
 *
 * Under `prefers-reduced-motion` none of it runs: no overlay, no held-back
 * mark, and focus is taken immediately.
 */

/** Survives remounts on purpose: the arrival belongs to the page load. */
let handoffHasPlayed = false;

/** The mark's flight. */
const HANDOFF_MS = 550;
const HANDOFF_EASING = "cubic-bezier(.2,.8,.2,1)";
/** The tail, over which the overlay becomes the card's own mark. */
const CROSSFADE_MS = 140;
/** Long enough for the last staggered row to finish rising. */
const STAGGER_TAIL_MS = 300;

/** What `LoadingScreen` renders, to the pixel. */
const LOADING_LOGO_WIDTH = 155 * 1.2;
const LOADING_LOGO_HEIGHT = 38 * 1.2;

const CARD_LOGO_SELECTOR = "[data-auth-card-logo]";
const ENTER_CLASS = "lw-front-door-enter";
const WAITING_CLASS = "lw-front-door-logo-waiting";

type Phase = "ready" | "flying" | "done";

export function LogoHandoff() {
  const reduceMotion = useReducedMotion();
  const [phase, setPhase] = useState<Phase>("ready");
  const overlay = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (reduceMotion || handoffHasPlayed) {
      setPhase("done");
      return;
    }

    const slot = document.querySelector<HTMLElement>(CARD_LOGO_SELECTOR);
    const node = overlay.current;
    // `Element.animate` is not implemented in jsdom, and a browser that cannot
    // find the slot has nothing to fly to. Both land on the same answer as
    // reduced motion: the card is simply there.
    if (!slot || !node || typeof node.animate !== "function") {
      setPhase("done");
      return;
    }

    handoffHasPlayed = true;

    const target = slot.getBoundingClientRect();
    const scale = target.height / LOADING_LOGO_HEIGHT;
    const startX = (window.innerWidth - LOADING_LOGO_WIDTH) / 2;
    const startY = (window.innerHeight - LOADING_LOGO_HEIGHT) / 2;
    // The icon sits at the left of the wordmark, so landing the wordmark's
    // left edge on the slot's left edge lands the icon on the icon.
    const endTransform = `translate3d(${target.left}px, ${target.top}px, 0) scale(${scale})`;

    slot.classList.add(WAITING_CLASS);
    document.body.classList.add(ENTER_CLASS);
    beginEntrance();
    setPhase("flying");

    const flight = node.animate(
      [
        {
          transform: `translate3d(${startX}px, ${startY}px, 0) scale(1)`,
          opacity: 1,
        },
        {
          transform: endTransform,
          opacity: 1,
          offset: 1 - CROSSFADE_MS / HANDOFF_MS,
        },
        { transform: endTransform, opacity: 0 },
      ],
      { duration: HANDOFF_MS, easing: HANDOFF_EASING, fill: "forwards" },
    );

    let cleared: ReturnType<typeof setTimeout> | undefined;
    const land = () => {
      slot.classList.remove(WAITING_CLASS);
      setPhase("done");
      endEntrance();
      // The stagger is finishing behind the mark; the class comes off once it
      // has, so a card mounted later in the session does not replay it.
      cleared = setTimeout(() => {
        document.body.classList.remove(ENTER_CLASS);
      }, STAGGER_TAIL_MS);
    };
    flight.onfinish = land;
    // A backgrounded tab can leave the animation unfinished, and a mark that
    // never lands is a card with no logo at all.
    flight.oncancel = land;
    const failsafe = window.setTimeout(land, HANDOFF_MS + 400);

    return () => {
      window.clearTimeout(failsafe);
      if (cleared) clearTimeout(cleared);
      slot.classList.remove(WAITING_CLASS);
      document.body.classList.remove(ENTER_CLASS);
      endEntrance();
    };
  }, [reduceMotion]);

  if (phase === "done") return null;

  return (
    <div
      ref={overlay}
      className="lw-front-door-handoff"
      aria-hidden="true"
      data-testid="logo-handoff"
      // Invisible until the flight's own first frame takes over, so the mark
      // is never seen parked in the corner waiting to start.
      style={{ opacity: phase === "ready" ? 0 : 1 }}
    >
      <FullLogo width={LOADING_LOGO_WIDTH} height={LOADING_LOGO_HEIGHT} />
    </div>
  );
}

/** Test seam: the arrival is per page load, and a suite is one long page. */
export function _resetLogoHandoffForTests(): void {
  handoffHasPlayed = false;
}
