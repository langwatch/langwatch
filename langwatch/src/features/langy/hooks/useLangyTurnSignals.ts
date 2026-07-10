export interface LangyTurnSignals {
  /** From `status_reported` — e.g. "Analysing 1,204 traces". */
  status: string | null;
  /** From `progress_reported` — 0..1 or 0..100. */
  progress: number | null;
  /** True while replaying a buffered token tail after a refresh ("Catching up…"). */
  isCatchingUp: boolean;
}

/**
 * Single consumer point for the live turn's granular streaming signals.
 *
 * `status_reported` and `progress_reported` are classified ephemeral by the
 * backend (ADR-046): they never hit the event_log and are routed through a
 * TTL'd Redis buffer transport that lands in PR3, along with the resume-after-
 * refresh token-tail replay. Until that transport is wired, this hook returns
 * no live status/progress (the shimmer ThinkingIndicator covers the gap) and
 * `isCatchingUp: false`. Keeping the seam here means the panel and
 * StreamingStatusLine consume a stable shape now and light up when PR3 lands —
 * no UI change required at that point.
 */
export function useLangyTurnSignals(_conversationId: string | null): LangyTurnSignals {
  return { status: null, progress: null, isCatchingUp: false };
}
