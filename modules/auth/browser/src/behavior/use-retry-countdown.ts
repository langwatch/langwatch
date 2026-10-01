import { useCallback, useEffect, useState } from "react";

/**
 * The rate limiter's remaining window, counted down where somebody can see
 * it. The screen counts what the server's refusal said, never guesses;
 * `null` is also honest for a refusal naming no window — no guess beats a bad one.
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
