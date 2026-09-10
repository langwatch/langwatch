import {
  normalizedSpanSchema,
  type DerivedTraceEvent,
  type NormalizedSpan,
  type SpanInsertData,
} from "@langwatch/trace-contract";

function spanKey(tenantId: string, traceId: string, spanId: string): string {
  return `${tenantId} ${traceId} ${spanId}`;
}

/**
 * The stored_spans twin for a process with no ClickHouse: the last write per
 * tenant, trace and span, answered back to every read that shares it. The
 * span storage, existence and derivation rows are handed the SAME instance,
 * the way one ClickHouse connection serves all three.
 */
export class MemoryTraceSpanStore {
  readonly #spans = new Map<string, SpanInsertData>();

  static create(): MemoryTraceSpanStore {
    return new MemoryTraceSpanStore();
  }

  put(span: SpanInsertData): void {
    this.#spans.set(spanKey(span.tenantId, span.traceId, span.spanId), span);
  }

  findByTrace(input: { tenantId: string; traceId: string }): SpanInsertData[] {
    return [...this.#spans.values()]
      .filter((span) => span.tenantId === input.tenantId && span.traceId === input.traceId)
      .sort((left, right) => left.startTimeUnixMs - right.startTimeUnixMs);
  }

  findTraceIds(input: { tenantId: string; traceIds: readonly string[] }): string[] {
    const held = new Set(
      [...this.#spans.values()]
        .filter((span) => span.tenantId === input.tenantId)
        .map((span) => span.traceId),
    );
    return input.traceIds.filter((traceId) => held.has(traceId));
  }

  /**
   * Only the rows that satisfy the normalized shape come back: a span this
   * build cannot normalise reads as absent rather than as a half-parsed span.
   */
  findNormalizedByTrace(input: { tenantId: string; traceId: string }): NormalizedSpan[] {
    const normalized: NormalizedSpan[] = [];
    for (const span of this.findByTrace(input)) {
      const parsed = normalizedSpanSchema.safeParse({
        ...span,
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      });
      if (parsed.success) normalized.push(parsed.data);
    }
    return normalized;
  }

  findDerivedEvents(input: { tenantId: string; traceId: string }): DerivedTraceEvent[] {
    return this.findByTrace(input).flatMap((span) =>
      span.events.map((event) => ({
        spanId: span.spanId,
        timestamp: event.timeUnixMs,
        name: event.name,
        attributes: Object.fromEntries(
          Object.entries(event.attributes).map(([key, value]) => [key, String(value)]),
        ),
      })),
    );
  }
}
