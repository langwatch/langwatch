import { type RefObject, useEffect, useRef } from "react";
import { useEntranceSettled } from "../logic/entrance";

/**
 * Takes focus once the entrance has finished moving, and immediately when
 * nothing is moving at all — which is every case except the first paint of a
 * page load, and every case under reduced motion.
 *
 * Focus is the ONE thing the entrance is allowed to hold back. Taking it while
 * the card is still rising drags the page under the animation on a phone; the
 * field itself is mounted, live and typeable the whole time.
 */
export function useFocusWhenSettled(): RefObject<HTMLInputElement | null> {
  const field = useRef<HTMLInputElement>(null);
  const settled = useEntranceSettled();

  useEffect(() => {
    if (settled) field.current?.focus();
  }, [settled]);

  return field;
}
