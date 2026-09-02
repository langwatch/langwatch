import type { DerivedTraceEvent, NormalizedSpan } from "@langwatch/trace-contract";

/**
 * Every stored span of ONE trace, read back for a derivation.
 *
 * Declared separately from {@link TraceStoredSpanReaderPort}, which resolves a
 * single span by its own identity on a redelivery path. This one answers a
 * whole trace, and the difference is not cosmetic: the result is multi-MB for a
 * large trace, so a consumer that asks per span instead of per trace turns one
 * read into hundreds — the read amplification that saturated ClickHouse during
 * a backlog drain.
 *
 * `occurredAtMs` is the trace's EARLIEST span time and is a partition hint, not
 * a freshness cutoff: `stored_spans` is partitioned on `toYearWeek(StartTime)`,
 * so it narrows which partitions are scanned and bounds nothing about which
 * spans come back. Absent, the read falls through to every partition including
 * the cold tier, which is what this hint exists to avoid.
 *
 * RETURNS SPANS WITH EMPTY `events` AND `links`. The projection is the scalar
 * columns a derivation reads; the nested groups are what production throws
 * `Attempt to read after eof` on. Do not reach for this to render a span.
 */
export abstract class TraceDerivationSpanReaderPort {
  abstract findNormalizedSpansByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<NormalizedSpan[]>;

  /**
   * The same trace's span EVENTS, flattened, without its spans.
   *
   * A filter on `events.*` needs the event tuples and nothing else, and the
   * span read above deliberately returns them empty — so asking for events
   * through it would return a confident, wrong answer of "no events". This is
   * the read that answers that question, and it is cheap for the reason the
   * span read is not: it touches three nested columns rather than the whole
   * row.
   */
  abstract findDerivedEventsByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<DerivedTraceEvent[]>;
}
