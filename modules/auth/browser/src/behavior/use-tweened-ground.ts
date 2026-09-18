import { useEffect, useRef, useState } from "react";
import type { GroundShift } from "../model/ground-palette.ts";
import {
  easeInOutCubic,
  GROUND_TWEEN_MS,
  groundShiftsMatch,
  mixGroundShift,
} from "../model/ground-palette.ts";

/**
 * Frame tween to new ground position; always from current; respects reduced-motion
 */
export function useTweenedGround(
  target: GroundShift,
  { instant = false }: { instant?: boolean } = {},
): GroundShift {
  const [current, setCurrent] = useState(target);
  // Read by the frame loop, which must see the newest value without being
  // re-created around it — a tween that restarted on its own output would
  // never finish.
  const currentRef = useRef(current);
  currentRef.current = current;

  useEffect(() => {
    if (instant) {
      setCurrent(target);
      return;
    }

    const from = currentRef.current;
    // Already there. Mount is the common case — the field starts at rest and
    // is asked for rest — and a frame loop that spends most of a second
    // re-applying the values it started with is a cost with no picture.
    if (groundShiftsMatch(from, target)) return;

    const startedAt = performance.now();
    let frame = 0;

    const step = () => {
      const elapsed = performance.now() - startedAt;
      const t = Math.min(1, elapsed / GROUND_TWEEN_MS);
      setCurrent(t >= 1 ? target : mixGroundShift(from, target, easeInOutCubic(t)));
      if (t < 1) frame = requestAnimationFrame(step);
    };

    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [instant, target]);

  return current;
}
