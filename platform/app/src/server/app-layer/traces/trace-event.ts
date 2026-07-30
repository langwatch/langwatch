/**
 * A span's OTel events, read trace-wide from `stored_spans` on demand rather
 * than hoisted onto the trace-summary fold (which made folding O(n²)). The
 * shared contract for `getTraceEventsByTraceId`, the trace-detail events query
 * and the trigger precondition matcher.
 */
export interface DerivedTraceEvent {
  spanId: string;
  timestamp: number;
  name: string;
  attributes: Record<string, string>;
}
