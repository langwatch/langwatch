import type { Authorization } from "@langwatch/authorization";
import { fenceFor } from "@langwatch/authorization/tenant-fence";
import type {
  DerivedTraceEvent,
  NormalizedSpan,
  Span,
  SpanInsertData,
} from "@langwatch/trace-contract";

import {
  NullSpanStorageRepository,
  type NormalizedSpanByIdParams,
  type OccurredAtHint,
} from "../span-storage.repository.ts";
import type { MemoryTraceSpanStore } from "./memory.trace-span.store.ts";

/** One tenant a proof reads, and the window its rows must start in (none for an own project). */
type TenantWindow = { tenantId: string; from: number; until: number | null };

/**
 * The span storage twin over {@link MemoryTraceSpanStore}, reading through the proof's fence
 * like the ClickHouse reader (ADR-175). ClickHouse-only projections (rollups, usage stats,
 * signal buckets) keep the null answers this extends: empty, not invented.
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
    parameters: { authorization: Authorization; traceId: string; limit?: number } & OccurredAtHint,
  ): Promise<NormalizedSpan[]> {
    const spans = this.#normalizedSpansUnder(parameters);
    return typeof parameters.limit === "number" ? spans.slice(0, parameters.limit) : spans;
  }

  override async findNormalizedSpanById(
    parameters: NormalizedSpanByIdParams,
  ): Promise<NormalizedSpan | null> {
    const spans = this.#normalizedSpansUnder(parameters);
    return spans.find((span) => span.spanId === parameters.spanId) ?? null;
  }

  override async findTraceEventsByTraceId(
    parameters: { authorization: Authorization; traceId: string } & OccurredAtHint,
  ): Promise<DerivedTraceEvent[]> {
    return this.#windowsOf(parameters.authorization)
      .flatMap((window) => {
        const visible = new Set(
          this.#store
            .findByTrace({ tenantId: window.tenantId, traceId: parameters.traceId })
            .filter((span) => inWindow({ window, startTimeUnixMs: span.startTimeUnixMs }))
            .map((span) => span.spanId),
        );
        return this.#store
          .findDerivedEvents({ tenantId: window.tenantId, traceId: parameters.traceId })
          .filter((event) => visible.has(event.spanId));
      })
      .toSorted((left, right) => left.timestamp - right.timestamp);
  }

  override async findSpanByIds(
    _parameters: { authorization: Authorization; traceId: string; spanId: string } & OccurredAtHint,
  ): Promise<Span | null> {
    // The rendered span is a different shape from the row written here, and
    // this store keeps no rendering of it.
    return null;
  }

  /** Every tenant the proof reads: own projects outright, shared ones inside their window. */
  #windowsOf(authorization: Authorization): TenantWindow[] {
    const fence = fenceFor({ authorization, reads: "traces" });
    return [
      ...fence.own.map((tenantId) => ({ tenantId, from: 0, until: null })),
      ...fence.shared.map((window) => ({
        tenantId: window.projectId,
        from: window.from,
        until: window.until,
      })),
    ];
  }

  #normalizedSpansUnder({
    authorization,
    traceId,
  }: {
    authorization: Authorization;
    traceId: string;
  }): NormalizedSpan[] {
    return this.#windowsOf(authorization)
      .flatMap((window) =>
        this.#store
          .findNormalizedByTrace({ tenantId: window.tenantId, traceId })
          .filter((span) => inWindow({ window, startTimeUnixMs: span.startTimeUnixMs })),
      )
      .toSorted((left, right) => left.startTimeUnixMs - right.startTimeUnixMs);
  }
}

function inWindow({
  window,
  startTimeUnixMs,
}: {
  window: TenantWindow;
  startTimeUnixMs: number;
}): boolean {
  if (startTimeUnixMs < window.from) return false;
  return window.until === null || startTimeUnixMs < window.until;
}
