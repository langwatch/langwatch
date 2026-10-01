/**
 * The countdown math for a live voice call: how much time is left, and when the
 * timer turns red. Pure and dependency-free so both the browser panel and a
 * test import it, and the red-window rule lives in exactly one place (AC12).
 */

/** The call ends when this many seconds have elapsed; the panel shows red for
 *  the final window below. */
export const RED_COUNTDOWN_SECONDS = 60;

/** Seconds left before the call limit ends it, never negative. */
export function remainingSeconds({
  elapsedMs,
  maxCallSeconds,
}: {
  elapsedMs: number;
  maxCallSeconds: number;
}): number {
  return Math.max(0, maxCallSeconds - Math.floor(elapsedMs / 1000));
}

/**
 * Whether the timer is in the final-60-seconds red window. False once the limit
 * has elapsed (remaining 0): the panel has left the live view by then, and a
 * red zero would read as an error rather than a countdown.
 */
export function isRedCountdown(remaining: number): boolean {
  return remaining > 0 && remaining <= RED_COUNTDOWN_SECONDS;
}
