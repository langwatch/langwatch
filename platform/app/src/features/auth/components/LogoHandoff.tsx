import { useEffect } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";
import "../auth.css";
import { beginEntrance, endEntrance } from "../logic/entrance";

/**
 * The entrance: the card settles into place once, on arrival.
 *
 * The loading screen and the card both show the same wordmark, nearly
 * centred, so a soft dissolve between the two screens already reads as one
 * thing coming to rest. What this component adds is only the settle — the
 * card rises a few pixels into place and its rows follow each other in by a
 * breath — all of it declared in the stylesheet against the
 * `lw-auth-enter` class this component puts on the body.
 *
 * An earlier version flew the mark from the loading screen's centre into the
 * card's logo slot (FLIP, overlay, cross-fade). At real speed the flight read
 * as a flash — the mark vanished and reappeared rather than travelling — and
 * a motion that has to be explained is worse than none. The dissolve keeps
 * the continuity and drops the theatrics.
 *
 * Three rules, unchanged from the flight it replaces:
 *
 *   - once per page load. A route change, a step change and the sign-up
 *     morph are all the same page continuing; replaying an arrival on each
 *     one would be a tic.
 *   - nothing waits on it. The card is mounted and live from the first
 *     frame; the only thing the motion gates is when focus is taken
 *     (`useEntranceSettled`).
 *   - under `prefers-reduced-motion`, none of it runs and focus is taken
 *     immediately.
 */

/** Survives remounts on purpose: the arrival belongs to the page load. */
let entranceHasPlayed = false;

/** The card's settle, plus the last staggered row's rise. */
const ENTRANCE_MS = 360 + 270;

const ENTER_CLASS = "lw-auth-enter";

export function LogoHandoff() {
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion || entranceHasPlayed) return;
    entranceHasPlayed = true;

    document.body.classList.add(ENTER_CLASS);
    beginEntrance();

    // The class comes off once the last row has risen, so a card mounted
    // later in the session does not replay the entrance.
    const settled = window.setTimeout(() => {
      document.body.classList.remove(ENTER_CLASS);
      endEntrance();
    }, ENTRANCE_MS);

    return () => {
      window.clearTimeout(settled);
      document.body.classList.remove(ENTER_CLASS);
      endEntrance();
    };
  }, [reduceMotion]);

  return null;
}

/** Test seam: the arrival is per page load, and a suite is one long page. */
export function _resetLogoHandoffForTests(): void {
  entranceHasPlayed = false;
}
