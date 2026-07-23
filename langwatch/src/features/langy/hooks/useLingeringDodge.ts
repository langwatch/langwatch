import { useEffect, useRef, useState } from "react";

/**
 * Dodge state that engages instantly but releases on a delay.
 *
 * The floating Langy surfaces hop LEFT while a drawer holds the right edge.
 * Engaging must be immediate, the drawer is already on its way in. Releasing
 * is sequenced: the drawer leaves first, a beat passes, and only then does
 * the surface glide back to its corner. Releasing in lockstep with the
 * drawer's exit read as two cards fighting over the same edge.
 *
 * Spec: specs/langy/langy-panel-layout.feature
 */
export function useLingeringDodge({
  active,
  releaseDelayMs,
  immediate = false,
}: {
  active: boolean;
  releaseDelayMs: number;
  /** Release without the delay (reduced motion: nothing glides, so nothing
   *  should linger either). */
  immediate?: boolean;
}): boolean {
  const [held, setHeld] = useState(active);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (active) {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      setHeld(true);
      return;
    }
    if (immediate) {
      setHeld(false);
      return;
    }
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setHeld(false);
    }, releaseDelayMs);
    return () => {
      if (timerRef.current !== null) {
        window.clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [active, immediate, releaseDelayMs]);

  return active || held;
}
