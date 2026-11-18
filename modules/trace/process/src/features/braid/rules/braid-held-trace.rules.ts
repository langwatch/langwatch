/** A span's place in its trace, as the held rule reads it. */
export type LinkedSpan = Readonly<{
  spanId: string;
  parentSpanId: string | null;
  startTimeMs: number;
}>;

/** One span id in one trace, the key a link between two projects' spans is matched on. */
export type TraceSpanKey = Readonly<{ traceId: string; spanId: string }>;

/**
 * Whether a reader span and an owner span in one trace are parent and child, either way: the
 * only way a reader holds a trace for a braid; a shared trace id alone holds nothing (ADR-201 §3).
 * As the live fence, only spans starting at or after `fromMs` link.
 */
export function readerHoldsTrace({
  readerSpans,
  ownerSpans,
  fromMs,
}: {
  readerSpans: readonly LinkedSpan[];
  ownerSpans: readonly LinkedSpan[];
  fromMs: number;
}): boolean {
  const linkable = (span: LinkedSpan) => isSetSpanId(span.spanId) && span.startTimeMs >= fromMs;
  const readers = readerSpans.filter(linkable);
  const owners = ownerSpans.filter(linkable);
  const readerIds = new Set(readers.map((span) => span.spanId));
  const ownerIds = new Set(owners.map((span) => span.spanId));
  const linked = (spans: readonly LinkedSpan[], ids: ReadonlySet<string>) =>
    spans.some((span) => isSetSpanId(span.parentSpanId) && ids.has(span.parentSpanId));
  return linked(owners, readerIds) || linked(readers, ownerIds);
}

/** Whether a span id can link at all: an empty or all-zero id equals nothing (ADR-201 §3). */
export function isSetSpanId(spanId: string | null): spanId is string {
  return spanId !== null && spanId !== "" && !/^0+$/.test(spanId);
}

/**
 * The reader traces held for one owner, in the reader's order: each linked through an owner span
 * whose parent is a reader span, or a reader span whose parent is an owner span.
 */
export function heldTraceIdsOf({
  traceIds,
  heldThroughReader,
  heldThroughOwner,
}: {
  traceIds: readonly string[];
  heldThroughReader: readonly string[];
  heldThroughOwner: readonly string[];
}): string[] {
  const held = new Set([...heldThroughReader, ...heldThroughOwner]);
  return traceIds.filter((traceId) => held.has(traceId));
}
