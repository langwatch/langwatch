import type { NormalizedSpan } from "@langwatch/trace-contract";

// Read span by reference during redelivery; occurredAtMs must be span's own start
// time, not ingest time, since the table is partitioned on that column.
export abstract class TraceStoredSpanReaderRepository {
  abstract findNormalizedSpan(input: {
    tenantId: string;
    traceId: string;
    spanId: string;
    occurredAtMs: number;
  }): Promise<NormalizedSpan | null>;
}
