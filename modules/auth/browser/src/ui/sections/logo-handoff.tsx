import "../../model/ambient.d.ts";
import { useReducedMotion } from "@langwatch/design-system/use-reduced-motion";
import { useEffect } from "react";

import "../elements/auth-front-door.css";
import { beginEntrance, endEntrance } from "../../model/entrance.ts";

/**
 * Card settle on arrival; dissolve between screens, once per page load, respects reduced-motion
 */

/** Survives remounts on purpose: the arrival belongs to the page load. */
let entranceHasPlayed = false;

/** The card's settle, plus the last staggered row's rise. */
const ENTRANCE_MS = 360 + 270;

const ENTER_CLASS = "lw-front-door-enter";

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
