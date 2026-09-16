import type {
  DerivedTraceEvent,
  NormalizedSpan,
  Span,
  SpanInsertData,
} from "@langwatch/trace-contract";
import { NullSpanStorageRepository, type OccurredAtHint } from "../../span-storage.repository.ts";
import type { MemoryTraceSpanStore } from "./memory-trace-span.store.ts";

/**
 * The span storage twin over {@link MemoryTraceSpanStore}. Every read the
 * store can answer is answered; ClickHouse-only projections (rollups, usage
 * stats, signal buckets) keep the null answers this extends — empty, not invented.
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

  override async findNormalizedSpansByTraceId(
    parameters: { tenantId: string; traceId: string; limit?: number } & OccurredAtHint,
  ): Promise<NormalizedSpan[]> {
    const spans = this.#store.findNormalizedByTrace(parameters);
    return typeof parameters.limit === "number" ? spans.slice(0, parameters.limit) : spans;
  }

  override async findNormalizedSpanById(parameters: {
    tenantId: string;
    traceId: string;
    spanId: string;
  }): Promise<NormalizedSpan | null> {
    const spans = this.#store.findNormalizedByTrace(parameters);
    return spans.find((span) => span.spanId === parameters.spanId) ?? null;
  }

  override async findTraceEventsByTraceId(
    parameters: { tenantId: string; traceId: string } & OccurredAtHint,
  ): Promise<DerivedTraceEvent[]> {
    return this.#store.findDerivedEvents(parameters);
  }

  override async findSpanByIds(
    _parameters: { tenantId: string; traceId: string; spanId: string } & OccurredAtHint,
  ): Promise<Span | null> {
    // The rendered span is a different shape from the row written here, and
    // this store keeps no rendering of it.
    return null;
  }
}
