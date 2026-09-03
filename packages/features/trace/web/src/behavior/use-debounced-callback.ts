/**
 * A callback that waits for the caller to stop calling it.
 *
 * `use-debounce`'s `useDebouncedCallback` is what the moved call site used, and
 * this package does not depend on it. The two properties that site relies on
 * are the delay and `cancel()` — a mapping that changes dataset mid-flight must
 * not write the old dataset's mapping after the switch.
 *
 * The callback is held in a ref so a re-render never restarts a pending wait,
 * and the returned function keeps its identity for the life of the component,
 * which is what lets an effect depend on it without re-running every render.
 */

import { useEffect, useMemo, useRef } from "react";

export type DebouncedCallback<A extends unknown[]> = ((...args: A) => void) & {
  cancel: () => void;
};

export function useDebouncedCallback<A extends unknown[]>(
  callback: (...args: A) => void,
  delayMs: number,
): DebouncedCallback<A> {
  const latest = useRef(callback);
  latest.current = callback;
  const delay = useRef(delayMs);
  delay.current = delayMs;
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(void 0);

  const debounced = useMemo<DebouncedCallback<A>>(() => {
    const cancel = () => {
      if (timer.current !== void 0) clearTimeout(timer.current);
      timer.current = void 0;
    };
    const run = ((...args: A) => {
      cancel();
      timer.current = setTimeout(() => {
        timer.current = void 0;
        latest.current(...args);
      }, delay.current);
    }) as DebouncedCallback<A>;
    run.cancel = cancel;
    return run;
  }, []);

  useEffect(() => debounced.cancel, [debounced]);

  return debounced;
}
