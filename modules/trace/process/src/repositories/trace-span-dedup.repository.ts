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

/** The ingestion doors' duplicate claim; confirming and releasing are best-effort. */
export abstract class TraceSpanDedupRepository {
  abstract claimProcessing(span: SpanDedupRef): Promise<SpanDedupClaim>;

  abstract confirmProcessed(span: SpanDedupRef): Promise<void>;

  abstract releaseOnFailure(span: SpanDedupRef): Promise<void>;
}
