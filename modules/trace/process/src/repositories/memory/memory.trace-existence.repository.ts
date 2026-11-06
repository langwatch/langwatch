import {
  NormalizedStatusCode,
  type SpanInsertData,
  type TraceCost,
  type TraceUsageCount,
  type TraceUsageSummary,
} from "@langwatch/trace-contract";

import { TraceExistenceRepository } from "../trace-existence.repository.ts";
import type { MemoryTraceSpanStore } from "./memory.trace-span.store.ts";

/**
 * Set membership over the spans a memory process has written. It shares the
 * one store the span storage row writes into, so a trace exists here exactly
 * when a span of it was written.
 */
export class MemoryTraceExistenceRepository extends TraceExistenceRepository {
  readonly #store: MemoryTraceSpanStore;

  static create(store: MemoryTraceSpanStore): MemoryTraceExistenceRepository {
    return new MemoryTraceExistenceRepository(store);
  }

  private constructor(store: MemoryTraceSpanStore) {
    super();
    this.#store = store;
  }

  async findExistingTraceIds(input: {
    projectId: string;
    traceIds: readonly string[];
  }): Promise<string[]> {
    return this.#store.findTraceIds({ tenantId: input.projectId, traceIds: input.traceIds });
  }

  /** A trace's cost is the sum of its written spans' costs, as the summary fold adds them. */
  async findTraceCosts(input: {
    projectId: string;
    traceIds: readonly string[];
    occurredAt: { from: number; to: number };
  }): Promise<TraceCost[]> {
    const spans = this.#store
      .findByTenants({ tenantIds: [input.projectId] })
      .filter((span) => input.traceIds.includes(span.traceId));
    return input.traceIds.flatMap((traceId) => {
      const own = spans.filter((span) => span.traceId === traceId);
      if (own.length === 0) return [];
      const occurredAtMs = Math.min(...own.map((span) => span.startTimeUnixMs));
      if (occurredAtMs < input.occurredAt.from || occurredAtMs > input.occurredAt.to) return [];
      const costs = own.flatMap((span) => (span.cost === null ? [] : [span.cost]));
      const totalCost = costs.length === 0 ? null : costs.reduce((sum, cost) => sum + cost, 0);
      return [{ traceId, totalCost }];
    });
  }

  async countUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<TraceUsageCount> {
    const spans = this.#store
      .findByTenants({ tenantIds: projectIds })
      .filter((span) => since === undefined || span.startTimeUnixMs >= since);
    return {
      traces: new Set(spans.map((span) => `${span.tenantId}/${span.traceId}`)).size,
      spans: spans.length,
    };
  }

  /**
   * The store keeps the last write of each span, so a rewritten trace counts once at its newest
   * cost. A trace occurs at its first span, and errs when any of its spans did.
   */
  async summarizeUsage({
    projectIds,
    since,
  }: {
    projectIds: readonly string[];
    since: number;
  }): Promise<TraceUsageSummary> {
    const byTrace = new Map<string, SpanInsertData[]>();
    for (const span of this.#store.findByTenants({ tenantIds: projectIds })) {
      const key = `${span.tenantId}/${span.traceId}`;
      byTrace.set(key, [...(byTrace.get(key) ?? []), span]);
    }
    const traces = [...byTrace.values()]
      .map((spans) => ({
        occurredAt: Math.min(...spans.map((span) => span.startTimeUnixMs)),
        failed: spans.some((span) => span.statusCode === NormalizedStatusCode.ERROR),
        cost: spans.reduce((sum, span) => sum + (span.cost ?? 0), 0),
      }))
      .filter((trace) => trace.occurredAt >= since);
    const failedAts = traces.filter((trace) => trace.failed).map((trace) => trace.occurredAt);
    return {
      traces: traces.length,
      errors: failedAts.length,
      totalCost: traces.reduce((sum, trace) => sum + trace.cost, 0),
      lastFailedTraceAt: failedAts.length > 0 ? Math.max(...failedAts) : null,
    };
  }
}
