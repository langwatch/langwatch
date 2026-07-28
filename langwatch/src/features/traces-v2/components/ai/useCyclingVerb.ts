import { useEffect, useState } from "react";
import { useReducedMotion } from "~/hooks/useReducedMotion";

export const DEFAULT_THINKING_VERBS = [
  "Thinking about",
  "Pondering",
  "Researching",
  "Looking into",
  "Procrastinating about",
  "Mulling over",
  "Untangling",
  "Diving into",
];

/** How long each verb holds before rotating. The original, unchanged, default. */
const DEFAULT_INTERVAL_MS = 1800;

export function useCyclingVerb(
  active: boolean,
  verbs: readonly string[],
  /**
   * Dwell time per verb. Surfaces that crossfade the swap (rather than cutting)
   * want longer, so the text settles and is readable before it is replaced —
   * otherwise the next verb arrives mid-animation. Defaults to the original
   * 1800ms, so existing callers are unaffected.
   */
  intervalMs: number = DEFAULT_INTERVAL_MS,
): string {
  const reduceMotion = useReducedMotion();
  const [verb, setVerb] = useState(verbs[0] ?? "");
  useEffect(() => {
    if (!active || reduceMotion) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % verbs.length;
      setVerb(verbs[i] ?? "");
    }, intervalMs);
    return () => clearInterval(id);
  }, [active, reduceMotion, verbs, intervalMs]);
  return verb;
}
