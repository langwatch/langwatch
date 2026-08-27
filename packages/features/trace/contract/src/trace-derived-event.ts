/**
 * Trace-level event shape, derived from a span's OTel events.
 *
 * The trace summary fold no longer hoists span events onto its state (that grew
 * the fold O(span-count) and made folding O(n^2)). The list is now read from
 * stored_spans on demand via an events-only ClickHouse query
 * (`getTraceEventsByTraceId`); this type is the shared contract for that read,
 * used by the trace-detail events query and the trigger precondition matcher.
 */
export interface DerivedTraceEvent {
  spanId: string;
  timestamp: number;
  name: string;
  attributes: Record<string, string>;
}
