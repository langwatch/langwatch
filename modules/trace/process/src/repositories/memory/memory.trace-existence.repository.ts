import type { TraceCost, TracePresence, TraceUsageCount } from "@langwatch/trace-contract";

import { TraceExistenceRepository, type TraceProjectCount } from "../trace-existence.repository.ts";
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

  async findProjectsHoldingTrace(input: {
    projectIds: readonly string[];
    traceId: string;
  }): Promise<string[]> {
    const holding = new Set(
      this.#store
        .findByTenants({ tenantIds: input.projectIds })
        .filter((span) => span.traceId === input.traceId)
        .map((span) => span.tenantId),
    );
    return input.projectIds.filter((projectId) => holding.has(projectId));
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

  /** A trace occurs at its earliest written span's start, as the summary fold dates it. */
  async countTracesByProject({
    projectIds,
    since,
    until,
  }: {
    projectIds: readonly string[];
    since: number;
    until: number;
  }): Promise<TraceProjectCount[]> {
    return [...new Set(projectIds)].map((projectId) => {
      const occurredAt = new Map<string, number>();
      for (const span of this.#store.findByTenants({ tenantIds: [projectId] })) {
        const earliest = occurredAt.get(span.traceId);
        if (earliest === undefined || span.startTimeUnixMs < earliest) {
          occurredAt.set(span.traceId, span.startTimeUnixMs);
        }
      }
      const inRange = [...occurredAt.values()].filter((at) => at >= since && at < until);
      return {
        projectId,
        traces: inRange.length,
        lastTraceAt: inRange.length === 0 ? null : Math.max(...inRange),
      };
    });
  }

  /** The memory store keeps no write stamps, so arrival reads as the spans' own times. */
  async findTracePresence({
    projectId,
    traceId,
  }: {
    projectId: string;
    traceId: string;
  }): Promise<TracePresence[]> {
    const spans = this.#store
      .findByTenants({ tenantIds: [projectId] })
      .filter((span) => span.traceId === traceId);
    if (spans.length === 0) return [];
    return [
      {
        traceId,
        projectId,
        firstSeenAt: Math.min(...spans.map((span) => span.startTimeUnixMs)),
        lastSeenAt: Math.max(...spans.map((span) => span.endTimeUnixMs)),
        spanCount: new Set(spans.map((span) => span.spanId)).size,
      },
    ];
  }
}
