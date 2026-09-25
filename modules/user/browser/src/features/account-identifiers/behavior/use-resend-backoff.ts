import { nowInstant } from "@langwatch/time";
import { useCallback, useEffect, useRef, useState } from "react";

/** The wait after each press in a run; the last step is the ceiling. */
const BACKOFF_SECONDS = [3, 15, 45, 120, 300] as const;

/** Five quiet minutes end a run, so the next press starts from the first step. */
const RUN_ENDS_AFTER_MS = 5 * 60_000;

/**
 * The growing wait between resends and its countdown. The wait follows the press,
 * not the outcome; a server refusal's `retryAfterSeconds` outranks it (`holdFor`).
 * Spec: specs/identity/authentication-settings.feature
 */
export function useResendBackoff(): {
  /** Seconds left before another press is allowed; undefined when free. */
  secondsToWait: number | undefined;
  isWaiting: boolean;
  recordAttempt: () => void;
  holdFor: (seconds: number) => void;
} {
  const [secondsToWait, setSecondsToWait] = useState<number | undefined>(void 0);
  const streak = useRef(0);
  const lastAttemptAt = useRef<number | undefined>(void 0);

  useEffect(() => {
    if (secondsToWait === void 0) return;
    if (secondsToWait <= 0) {
      setSecondsToWait(void 0);
      return;
    }
    const tick = setTimeout(() => {
      setSecondsToWait((remaining) => (remaining === void 0 ? void 0 : remaining - 1));
    }, 1000);
    return () => clearTimeout(tick);
  }, [secondsToWait]);

  const recordAttempt = useCallback(() => {
    const now = nowInstant().epochMilliseconds;
    const previous = lastAttemptAt.current;
    if (previous !== void 0 && now - previous > RUN_ENDS_AFTER_MS) {
      streak.current = 0;
    }
    lastAttemptAt.current = now;

    const step = Math.min(streak.current, BACKOFF_SECONDS.length - 1);
    streak.current += 1;
    setSecondsToWait(BACKOFF_SECONDS[step]);
  }, []);

  const holdFor = useCallback((seconds: number) => {
    if (seconds <= 0) return;
    setSecondsToWait((local) => Math.max(local ?? 0, Math.ceil(seconds)));
  }, []);

  return {
    secondsToWait,
    isWaiting: secondsToWait !== void 0,
    recordAttempt,
    holdFor,
  };
}
