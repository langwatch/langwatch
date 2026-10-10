import {
  type SpanDedupClaim,
  type SpanDedupRef,
  TraceSpanDedupRepository,
} from "../trace-span-dedup.repository.ts";

const dedupKey = (span: SpanDedupRef): string => `${span.tenantId}:${span.traceId}:${span.spanId}`;

/** The claim in this process only, without expiry: a claimed span id is held until released. */
export class MemoryTraceSpanDedupRepository extends TraceSpanDedupRepository {
  static create(): MemoryTraceSpanDedupRepository {
    return new MemoryTraceSpanDedupRepository();
  }

  readonly #claims = new Set<string>();

  private constructor() {
    super();
  }

  async claimProcessing(span: SpanDedupRef): Promise<SpanDedupClaim> {
    const key = dedupKey(span);
    if (this.#claims.has(key)) return { outcome: "held" };
    this.#claims.add(key);
    return { outcome: "acquired" };
  }

  async confirmProcessed(): Promise<void> {}

  async releaseOnFailure(span: SpanDedupRef): Promise<void> {
    this.#claims.delete(dedupKey(span));
  }
}
