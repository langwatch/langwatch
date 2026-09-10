import type {
  DerivedTraceEvent,
  NormalizedSpan,
  Span,
  SpanInsertData,
} from "@langwatch/trace-contract";
import { NullSpanStorageRepository, type OccurredAtHint } from "../../span-storage.repository.ts";
import type { MemoryTraceSpanStore } from "./memory-trace-span.store.ts";

/**
 * The span storage twin over {@link MemoryTraceSpanStore}. Every read this
 * store can answer from what was written is answered here; the projections a
 * ClickHouse query computes (rollups, usage statistics, signal buckets) keep
 * the null answers this extends, so a memory process reads empty rather than
 * inventing an aggregate.
 */
export class MemorySpanStorageRepository extends NullSpanStorageRepository {
  readonly #store: MemoryTraceSpanStore;

  static create(store: MemoryTraceSpanStore): MemorySpanStorageRepository {
    return new MemorySpanStorageRepository(store);
  }

  private constructor(store: MemoryTraceSpanStore) {
    super();
    this.#store = store;
  }

  override async insertSpan(span: SpanInsertData): Promise<void> {
    this.#store.put(span);
  }

  override async insertSpans(spans: SpanInsertData[]): Promise<void> {
    for (const span of spans) this.#store.put(span);
  }

  override async getNormalizedSpansByTraceId(
    parameters: { tenantId: string; traceId: string; limit?: number } & OccurredAtHint,
  ): Promise<NormalizedSpan[]> {
    const spans = this.#store.findNormalizedByTrace(parameters);
    return typeof parameters.limit === "number" ? spans.slice(0, parameters.limit) : spans;
  }

  override async tryFindNormalizedSpanById(parameters: {
    tenantId: string;
    traceId: string;
    spanId: string;
  }): Promise<NormalizedSpan | null> {
    const spans = this.#store.findNormalizedByTrace(parameters);
    return spans.find((span) => span.spanId === parameters.spanId) ?? null;
  }

  override async getTraceEventsByTraceId(
    parameters: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<DerivedTraceEvent[]> {
    return this.#store.findDerivedEvents(parameters);
  }

  override async tryGetSpanByIds(
    _parameters: { tenantId: string; traceId: string; spanId: string } & OccurredAtHint,
  ): Promise<Span | null> {
    // The rendered span is a different shape from the row written here, and
    // this store keeps no rendering of it.
    return null;
  }
}
