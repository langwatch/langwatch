/**
 * Whether the reader's system asks for less motion, read live. Main's
 * `GovernanceHeroGround` reads this from a platform-app hook this package may
 * not import, and no workspace package exposes an equivalent yet, so this is
 * the minimal `prefers-reduced-motion` media-query hook.
 */
import { useEffect, useState } from "react";

const QUERY = "(prefers-reduced-motion: reduce)";

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    const media = window.matchMedia(QUERY);
    setReduced(media.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  return reduced;
}
