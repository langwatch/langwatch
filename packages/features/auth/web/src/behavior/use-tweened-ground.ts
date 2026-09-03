import { useEffect, useRef, useState } from "react";
import type { GroundShift } from "../model/ground-palette";
import {
  easeInOutCubic,
  GROUND_TWEEN_MS,
  groundShiftsMatch,
  mixGroundShift,
} from "../model/ground-palette";

/**
 * The ground, on its way to a new turn.
 *
 * Given where the field should BE, this returns where it is right now, a frame
 * at a time. The shader is handed the result every frame, so what a person
 * sees when a step changes is the field turning into position rather than
 * jumping there.
 *
 * It always tweens from wherever the field currently IS, never from the turn
 * it was last aiming at. Somebody who moves two steps quickly gets one
 * continuous motion that changes its mind, not a queue of animations.
 *
 * `instant` collapses the whole thing to an assignment: no frame loop, no
 * motion. That is the reduced-motion path, where the ground is not animating
 * at all and neither should this.
 *
 * `target` MUST be memoized by the caller. It is the effect's only trigger, so
 * a fresh object every render would restart the journey on the frame it
 * published — a loop, not an animation.
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
