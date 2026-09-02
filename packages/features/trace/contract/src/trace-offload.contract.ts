/**
 * The claim-check contract for trace payloads too large to carry inline
 * (ADR-022).
 *
 * Two things are offloaded and both leave a pointer behind. A span whose whole
 * serialised command exceeds `COMMAND_INLINE_THRESHOLD` is spooled at the
 * collector edge and the command carries a `spoolRef`. An individual
 * input/output attribute over the projection's preview budget is replaced with
 * a preview and gains a `langwatch.reserved.eventref.<attrKey>` attribute
 * naming the event log row that still holds the whole value.
 *
 * THE PREFIX AND THE POINTER SHAPE LIVE IN THE CONTRACT, NOT BESIDE THE
 * TRANSFORM THAT WRITES THEM, for the same reason the media-reference shape
 * does: they have more readers than writers, and every reader must strip and
 * decode exactly what the writer wrote. The write side is the projection lean
 * (`@langwatch/trace-server`); the read side is the full-record repository, its
 * mapper, the event-payload repository and the trace read path's offloaded
 * resolvers. Those four each carried their own copy of the string. A prefix one
 * reader spells differently is an offloaded value that resolves to nothing —
 * the customer sees the 64 KB preview and is told nothing was truncated.
 *
 * Nothing here is a policy: the preview BUDGET, which attribute keys earn it
 * and how a preview is shaped are the lean transform's business and stay with
 * it. What is here is only what both sides have to agree on.
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
 * What an eventref attribute's value decodes to.
 *
 * `field` is the payload field on the stored event that holds the full value;
 * `eventId` is the event log row to read it from. The read path needs BOTH —
 * it JOINs event_log by EventId rather than guessing which event of the trace
 * carried the attribute.
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
 * matching every pointer already written to ClickHouse — readers parse JSON so
 * order is not load-bearing for them, but a stored-attribute equality test is
 * how a drift in this codec would first be seen.
 */
export function serializeTraceEventReference(reference: TraceEventReference): string {
  return JSON.stringify({ field: reference.field, eventId: reference.eventId });
}
