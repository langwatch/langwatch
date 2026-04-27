/**
 * Span name used by the `/api/track_event` endpoint for synthetic event spans.
 *
 * These spans represent user-tracked events (e.g. thumbs-up), not actual
 * execution, and must be excluded from trace timing calculations.
 */
export const TRACK_EVENT_SPAN_NAME = "langwatch.track_event";

/** Span names that represent synthetic events, not real execution. */
export const SYNTHETIC_SPAN_NAMES: ReadonlySet<string> = new Set([
  TRACK_EVENT_SPAN_NAME,
]);
