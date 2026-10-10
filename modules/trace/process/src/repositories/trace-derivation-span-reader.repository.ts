import type { Authorization } from "@langwatch/authorization";
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
   * Trace span events flattened (span read deliberately returns them empty), read in the
   * proof's own project.
   */
  abstract findDerivedEventsByTraceId(input: {
    authorization: Authorization;
    traceId: string;
    occurredAtMs?: number;
  }): Promise<DerivedTraceEvent[]>;
}
