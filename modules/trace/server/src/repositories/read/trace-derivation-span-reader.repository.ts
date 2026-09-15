import type { DerivedTraceEvent, NormalizedSpan } from "@langwatch/trace-contract";

/**
 * All spans of one trace for derivations. occurredAtMs partitions the scan;
 * returns spans with empty events and links.
 */
export abstract class TraceDerivationSpanReaderRepository {
  abstract findNormalizedSpansByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
    limit?: number;
  }): Promise<NormalizedSpan[]>;

  /**
   * Trace span events flattened (span read deliberately returns them empty).
   */
  abstract findDerivedEventsByTraceId(input: {
    tenantId: string;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<DerivedTraceEvent[]>;
}
