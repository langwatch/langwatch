import {
  type LangyProgressSample,
  useLangyStore,
} from "../stores/langyStore";

export interface LangyTurnMetric {
  /** Value to roll to; the statcard rolls it up from 0 on first paint. */
  value: number;
  /** Short caption under the number, e.g. "traces", "pass rate". */
  label: string;
  /** Optional unit appended after the number, e.g. "%". */
  suffix?: string;
  /**
   * Full formatter, when a suffix cannot express the value — currency needs a
   * PREFIX, and a cost rendered as a bare `0.433` says nothing about what it
   * is. Wins over `suffix` when both are set.
   */
  format?: (value: number) => string;
}

export interface LangyTurnSignals {
  /** From `status_reported` — e.g. "Analysing 1,204 traces". */
  status: string | null;
  /** From `progress_reported` — 0..1 or 0..100. */
  progress: number | null;
  /** Measured batch timing used to interpolate between real progress samples. */
  progressSample: LangyProgressSample | null;
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
  /**
   * The model's reasoning (thinking) for the live turn, accumulated from the
   * `reasoning` stream. Ephemeral — present only while a reply streams, null
   * otherwise (it is never persisted or reloaded).
   */
  reasoning: string | null;
  /** True while replaying a buffered token tail after a refresh ("Catching up…"). */
  isCatchingUp: boolean;
}

/**
 * Single consumer point for the live turn's granular streaming signals.
 *
 * `status_reported` / `progress_reported` are classified ephemeral by the
 * backend (ADR-046): they never hit the event_log. They ride the durable token
 * buffer (as `status` / `progress` entries), which the `langy.onTurnStream`
 * subscription relays; the custom `ChatTransport` peels them off the stream —
 * they are not message parts — and writes them to the store, which this hook
 * reads. So `StreamingStatusLine` lights up with no component change.
 *
 * `metrics`/`segment` are not yet emitted by the agent (the milestone entry
 * carries no numeric rollup), so they stay null — the status line renders on
 * status/progress alone. `isCatchingUp` is likewise unused now (the buffer's
 * tail replay is instant over the subscription).
 */
export function useLangyTurnSignals(
  _conversationId: string | null,
): LangyTurnSignals {
  const status = useLangyStore((s) => s.turnStatus);
  const progress = useLangyStore((s) => s.turnProgress);
  const progressSample = useLangyStore((s) => s.turnProgressSample);
  const reasoning = useLangyStore((s) => s.turnReasoning);
  return {
    status,
    progress,
    progressSample,
    metrics: null,
    segment: progressSample
      ? { index: progressSample.current, total: progressSample.total }
      : null,
    reasoning,
    isCatchingUp: false,
  };
}
