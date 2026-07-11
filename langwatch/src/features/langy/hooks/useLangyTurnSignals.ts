export interface LangyTurnMetric {
  /** Value to roll to; the statcard rolls it up from 0 on first paint. */
  value: number;
  /** Short caption under the number, e.g. "traces", "pass rate". */
  label: string;
  /** Optional unit appended after the number, e.g. "%". */
  suffix?: string;
}

export interface LangyTurnSignals {
  /** From `status_reported` — e.g. "Analysing 1,204 traces". */
  status: string | null;
  /** From `progress_reported` — 0..1 or 0..100. */
  progress: number | null;
  /**
   * From metric events — the compact statcard values a turn surfaces mid-flight
   * (traces scanned, pass-rate). Null until the turn reports any; the statcard
   * renders only when this is a non-empty array (no fabricated numbers).
   */
  metrics: LangyTurnMetric[] | null;
  /**
   * From `progress_reported` segment framing — powers the "segment 7 / 11"
   * suffix on the progress percent. Null when the turn reports a bare percent.
   */
  segment: { index: number; total: number } | null;
  /** True while replaying a buffered token tail after a refresh ("Catching up…"). */
  isCatchingUp: boolean;
}

/**
 * Single consumer point for the live turn's granular streaming signals.
 *
 * `status_reported`, `progress_reported` and metric events are classified
 * ephemeral by the backend (ADR-046): they never hit the event_log and are
 * routed through a TTL'd Redis buffer transport that lands in PR3, along with
 * the resume-after-refresh token-tail replay. Until that transport is wired,
 * this hook returns no live status/progress/metrics (the shimmer
 * ThinkingIndicator covers the gap) and `isCatchingUp: false`. Keeping the seam
 * here means the panel, StreamingStatusLine and StreamingStatCard consume a
 * stable shape now and light up when PR3 lands — no UI change required at that
 * point.
 */
export function useLangyTurnSignals(
  _conversationId: string | null,
): LangyTurnSignals {
  return {
    status: null,
    progress: null,
    metrics: null,
    segment: null,
    isCatchingUp: false,
  };
}
