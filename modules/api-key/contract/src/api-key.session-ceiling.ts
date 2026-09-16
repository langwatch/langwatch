/**
 * When a CLI login key's session runs out. Pure so both the mint path
 * and the hourly sweep — which re-derives a live key's expiry from a
 * changed policy — share one rule instead of two computing it differently.
 */

/**
 * The sooner of the refresh window from now and the org's max session
 * duration from session start. A refresh recomputes with a new `nowMs`,
 * sliding the window; the ceiling itself does not move.
 */
export function loginKeyExpiresAt({
  nowMs,
  sessionStartedAtMs,
  maxSessionDurationDays,
  refreshWindowMs,
}: {
  nowMs: number;
  sessionStartedAtMs: number;
  maxSessionDurationDays: number;
  refreshWindowMs: number;
}): Date {
  const refreshBoundMs = nowMs + refreshWindowMs;
  if (maxSessionDurationDays <= 0) return new Date(refreshBoundMs);
  const ceilingMs = sessionStartedAtMs + maxSessionDurationDays * 24 * 60 * 60 * 1000;
  return new Date(Math.min(refreshBoundMs, ceilingMs));
}
