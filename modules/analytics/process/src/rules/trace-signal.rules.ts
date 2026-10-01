export const MAX_PROCESSED_SPANS = 512;

export const TRACE_ANALYTICS_HAS_SIGNAL_SQL =
  `(SpanCount > 0` +
  ` OR EarliestSpanStartMs > 0` +
  ` OR Attributes['langwatch.reserved.log_record_count'] NOT IN ('', '0')` +
  ` OR Version < '2026-07-27')`;
