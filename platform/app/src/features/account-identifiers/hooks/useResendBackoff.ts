import { useCallback, useEffect, useRef, useState } from "react";

/**
 * How long the resend button stands down after each press in a run of them.
 *
 * The first press costs almost nothing — somebody who clicks once and watches
 * their inbox is not the problem, and making them wait teaches them the
 * button is broken. The steps after it climb fast, because a second and third
 * press inside a minute mean the mail is not arriving and more of it will not
 * help.
 *
 * The last value is the ceiling: the run can carry on, and the wait stops
 * growing rather than reaching a length nobody would sit through.
 */
const BACKOFF_SECONDS = [3, 15, 45, 120, 300] as const;

/**
 * A run ends when somebody stops pressing. Five minutes of quiet is not
 * spamming by any reading, so the next press starts from the first step
 * again — the escalation is aimed at a burst, not at somebody who came back
 * an hour later to try once more.
 */
const RUN_ENDS_AFTER_MS = 5 * 60_000;

/**
 * The growing wait between resends, and the countdown that shows it.
 *
 * "Send it again" is a button whose whole job is to send mail to somebody
 * else's inbox, so it is worth being careful with — but the server's rate
 * limit is the wrong and only guard on its own. It is invisible until it
 * fires, it fires on a budget sized for an hour, and the first a person hears
 * of it is a refusal after they have already sent five. This puts the cost in
 * front of the press instead: press once, nothing much happens; keep pressing,
 * and the wait grows where you can watch it.
 *
 * ── What "actually spamming" means here ─────────────────────────────────
 *
 * Only a RUN escalates. The streak advances on each press and resets once
 * somebody has been quiet for `RUN_ENDS_AFTER_MS`, so the person who presses
 * once, reads their mail, and comes back later never meets a longer wait than
 * the first one. That is the distinction the server's window cannot draw: it
 * counts presses per hour and cannot tell six in ten seconds from six spread
 * across the hour.
 *
 * ── It counts even when the send succeeded ──────────────────────────────
 *
 * Deliberately. A resend that WORKED is exactly the one somebody repeats,
 * because a working send and a lost one look identical from this side of the
 * screen. So the wait follows the press, not the outcome.
 *
 * The server's limit stays the backstop and wins when the two disagree: a
 * refusal carrying `retryAfterSeconds` replaces the local wait with the real
 * one, so the button never says "3 seconds" about a door that is shut for
 * twenty minutes.
 */
export function useResendBackoff(): {
  /** Seconds left before another press is allowed, or null when free. */
  secondsToWait: number | null;
  /** Whether the button should refuse a press right now. */
  isWaiting: boolean;
  /** Call as the press is made: starts the next wait and advances the run. */
  recordAttempt: () => void;
  /** Adopt the server's window, which outranks the local one. */
  holdFor: (seconds: number) => void;
} {
  const [secondsToWait, setSecondsToWait] = useState<number | null>(null);
  // Refs, not state: neither is rendered, and putting them in state would
  // re-render the button on every press for a value it never shows.
  const streak = useRef(0);
  const lastAttemptAt = useRef<number | null>(null);

  useEffect(() => {
    if (secondsToWait === null) return;
    if (secondsToWait <= 0) {
      setSecondsToWait(null);
      return;
    }
    const tick = setTimeout(() => {
      setSecondsToWait((remaining) =>
        remaining === null ? null : remaining - 1,
      );
    }, 1000);
    return () => clearTimeout(tick);
  }, [secondsToWait]);

  const recordAttempt = useCallback(() => {
    const now = Date.now();
    const previous = lastAttemptAt.current;
    if (previous !== null && now - previous > RUN_ENDS_AFTER_MS) {
      streak.current = 0;
    }
    lastAttemptAt.current = now;

    const step = Math.min(streak.current, BACKOFF_SECONDS.length - 1);
    streak.current += 1;
    setSecondsToWait(BACKOFF_SECONDS[step] ?? null);
  }, []);

  const holdFor = useCallback((seconds: number) => {
    if (seconds <= 0) return;
    // The server's window is the real one, so the run is left where it is:
    // counting this as another step would stack our wait on top of theirs.
    setSecondsToWait((local) => Math.max(local ?? 0, Math.ceil(seconds)));
  }, []);

  return {
    secondsToWait,
    isWaiting: secondsToWait !== null,
    recordAttempt,
    holdFor,
  };
}
