import { useCallback, useEffect, useState } from "react";

/**
 * The rate limiter's remaining window, counted down where somebody can see it.
 *
 * The screen learns the real wait from the refusal that carried it, so this
 * counts what the server said rather than guessing. `null` is the ordinary
 * state and also the honest one for a refusal that named no window: a submit
 * disabled for a duration nobody knows is a worse guess than no guess.
 */
export function useRetryCountdown(): {
  secondsToWait: number | null;
  startWait: (seconds: number) => void;
  clearWait: () => void;
} {
  const [secondsToWait, setSecondsToWait] = useState<number | null>(null);

  useEffect(() => {
    if (secondsToWait === null) return;
    if (secondsToWait <= 0) {
      setSecondsToWait(null);
      return;
    }
    const tick = setTimeout(() => {
      setSecondsToWait((remaining) => (remaining === null ? null : remaining - 1));
    }, 1000);
    return () => clearTimeout(tick);
  }, [secondsToWait]);

  const startWait = useCallback((seconds: number) => {
    setSecondsToWait(seconds);
  }, []);
  const clearWait = useCallback(() => setSecondsToWait(null), []);

  return { secondsToWait, startWait, clearWait };
}
