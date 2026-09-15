/**
 * When a CLI login key's session runs out.
 *
 * Pure so both the mint path and the hourly sweep that re-derives a live
 * key's expiry from a changed policy can share one rule instead of two
 * places computing "when does this session end" differently.
 */

/**
 * The sooner of the refresh window from now and the organization's max
 * session duration from the session start. A refresh recomputes it with a
 * new `nowMs`, so the refresh window slides and the session ceiling does
 * not. No ceiling (`maxSessionDurationDays <= 0`) leaves the refresh window
 * alone.
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
