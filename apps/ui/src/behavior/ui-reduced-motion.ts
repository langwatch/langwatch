/**
 * Whether this reader asked their operating system for less motion.
 *
 * One line of browser API, in the global layer for the reason every other module
 * here is: `ui-browser-capability` forbids `apps/ui/src/features/*` from naming
 * `window`, and a feature that reaches `matchMedia` directly cannot be mounted
 * anywhere else or driven by a test with no browser.
 *
 * It LISTENS rather than reading once. The preference is changed from a system
 * settings panel while a page is open, and a full-screen animation that keeps
 * playing after the reader turned motion off is exactly the thing the setting
 * exists to stop. A browser that does not implement `matchMedia` — and jsdom,
 * unless a suite stubs it — reads as "no preference", which is the same answer
 * the media query gives when there is none.
 */

import { useEffect, useState } from "react";

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

export function readUiPrefersReducedMotion(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return false;
  try {
    return window.matchMedia(REDUCED_MOTION_QUERY).matches;
  } catch {
    return false;
  }
}

export function useUiPrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(readUiPrefersReducedMotion);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    let media: MediaQueryList;
    try {
      media = window.matchMedia(REDUCED_MOTION_QUERY);
    } catch {
      return;
    }
    const onChange = () => setReduced(media.matches);
    onChange();
    media.addEventListener?.("change", onChange);
    return () => media.removeEventListener?.("change", onChange);
  }, []);

  return reduced;
}
