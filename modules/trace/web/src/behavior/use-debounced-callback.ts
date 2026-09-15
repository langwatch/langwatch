/**
 * A callback that waits for the caller to stop calling it.
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
