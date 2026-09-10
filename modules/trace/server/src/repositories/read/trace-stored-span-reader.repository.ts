import type { NormalizedSpan } from "@langwatch/trace-contract";

/**
 * One stored span, read back by its own identity.
 *
 * Declared separately from {@link TraceSpanStoragePort} because the two have
 * different consumers and different failure modes: the write port is on the
 * ingestion hot path, and this is a REDELIVERY path — a derivation consumer
 * that was handed a span REFERENCE rather than a payload and has to resolve it
 * before it can contribute anything.
 *
 * `occurredAtMs` is required rather than optional, and it is the SPAN'S OWN
 * start. The table it reads is partitioned on that column, so a caller that
 * passed its envelope's ingest time instead would silently miss every span
 * whose duration plus export lag exceeded the window — spans export on end —
 * and would miss it on every retry, forever.
 *
 * ABSENCE IS AN ANSWER, not a failure: a span that has not landed yet is a
 * `null`, and the caller decides whether to wait for redelivery or move on.
 */
export abstract class TraceStoredSpanReaderPort {
  abstract tryGetNormalizedSpan(input: {
    tenantId: string;
    traceId: string;
    spanId: string;
    occurredAtMs: number;
  }): Promise<NormalizedSpan | null>;
}
