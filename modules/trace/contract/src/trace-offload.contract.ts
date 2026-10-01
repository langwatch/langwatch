/**
 * Claim-check contract for trace payloads too large to carry inline (ADR-022).
 * Prefix and pointer shapes live here so multiple readers decode what writers
 * encode; policies (preview budget, attribute keys) stay with the writer.
 */

/**
 * Server-internal namespace prefix carrying an offloaded attribute's pointer.
 * Client-supplied attributes in the `langwatch.reserved.*` namespace are
 * stripped at command-worker ingestion, so a customer cannot forge one.
 */
export const EVENTREF_ATTR_PREFIX = "langwatch.reserved.eventref.";

/**
 * Spans whose serialized command payload exceeds this threshold are spooled to
 * S3 at the edge, with the command carrying `{spoolRef}` only. Matches the
 * `capOversizedAttributes` boundary.
 */
export const COMMAND_INLINE_THRESHOLD = 256 * 1024;

/**
 * What an eventref attribute's value decodes to. `field` is the payload
 * field holding the full value; `eventId` is the event_log row to read it
 * from — the read path JOINs by EventId rather than guessing.
 */
export interface TraceEventReference {
  field: string;
  eventId: string;
}

/** The reserved attribute key that carries `attrKey`'s pointer. */
export function traceEventReferenceKey(attrKey: string): string {
  return `${EVENTREF_ATTR_PREFIX}${attrKey}`;
}

/**
 * The attribute value a reader decodes. Key order is `field` then `eventId`,
 * matching every pointer already in ClickHouse; a stored-attribute equality
 * test is how codec drift would first be seen.
 */
export function serializeTraceEventReference(reference: TraceEventReference): string {
  return JSON.stringify({ field: reference.field, eventId: reference.eventId });
}
