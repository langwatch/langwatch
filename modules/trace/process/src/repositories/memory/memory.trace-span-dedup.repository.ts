import {
  type SpanDedupClaim,
  type SpanDedupRef,
  TraceSpanDedupRepository,
  type UsageRecordRef,
} from "../trace-span-dedup.repository.ts";

const dedupKey = (span: SpanDedupRef): string => `${span.tenantId}:${span.traceId}:${span.spanId}`;

const usageKey = (record: UsageRecordRef): string => `${record.tenantId}:${record.recordId}`;

/** The claim in this process only, without expiry: a claimed span id is held until released. */
export class MemoryTraceSpanDedupRepository extends TraceSpanDedupRepository {
  static create(): MemoryTraceSpanDedupRepository {
    return new MemoryTraceSpanDedupRepository();
  }

  readonly #claims = new Set<string>();
  readonly #usageHolders = new Map<string, string>();

  private constructor() {
    super();
  }

  async claimProcessing(spans: readonly SpanDedupRef[]): Promise<SpanDedupClaim[]> {
    return spans.map((span) => {
      const key = dedupKey(span);
      if (this.#claims.has(key)) return { outcome: "held" };
      this.#claims.add(key);
      return { outcome: "acquired" };
    });
  }

  async confirmProcessed(): Promise<void> {}

  async releaseOnFailure(span: SpanDedupRef): Promise<void> {
    this.#claims.delete(dedupKey(span));
  }

  async claimUsageRecord(record: UsageRecordRef): Promise<SpanDedupClaim> {
    const key = usageKey(record);
    const holder = this.#usageHolders.get(key);
    if (holder !== undefined && holder !== record.spanId) return { outcome: "held" };
    this.#usageHolders.set(key, record.spanId);
    return { outcome: "acquired" };
  }

  async releaseUsageRecord(record: UsageRecordRef): Promise<void> {
    const key = usageKey(record);
    if (this.#usageHolders.get(key) === record.spanId) this.#usageHolders.delete(key);
  }
}
