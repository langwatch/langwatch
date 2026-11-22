/** One span's dedup identity: a span id names the same span only within its trace and tenant. */
export type SpanDedupRef = {
  tenantId: string;
  traceId: string;
  spanId: string;
};

/**
 * What claiming a span for processing answered. `unknown` is a store that could not be reached:
 * the caller ingests anyway, because losing a duplicate is worse than recording one.
 */
export type SpanDedupClaim =
  | Readonly<{ outcome: "acquired" }>
  | Readonly<{ outcome: "held" }>
  | Readonly<{ outcome: "unknown" }>;

/**
 * A usage record two spans can both report, and the span claiming it. It is keyed by project
 * alone: the spans that share one need not share a trace.
 */
export type UsageRecordRef = {
  tenantId: string;
  recordId: string;
  spanId: string;
};

/**
 * The ingestion doors' duplicate claims; confirming and releasing are best-effort. A usage record
 * is held by the first span that claims it, and that same span claiming again acquires it.
 */
export abstract class TraceSpanDedupRepository {
  /** Claims a batch of spans in one round trip; the answers follow the order asked. */
  abstract claimProcessing(spans: readonly SpanDedupRef[]): Promise<SpanDedupClaim[]>;

  /** Marks a batch of ingested spans processed, in one round trip. */
  abstract confirmProcessed(spans: readonly SpanDedupRef[]): Promise<void>;

  abstract releaseOnFailure(span: SpanDedupRef): Promise<void>;

  abstract claimUsageRecord(record: UsageRecordRef): Promise<SpanDedupClaim>;

  abstract releaseUsageRecord(record: UsageRecordRef): Promise<void>;
}
