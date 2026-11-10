import { nowInstant, Temporal } from "@langwatch/time";
import type { TraceAttributeMatch, TraceUsageDay } from "@langwatch/trace-contract";

import { TraceUsageCountRepository } from "../trace-usage-count.repository.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;

type CountedTrace = {
  tenantId: string;
  traceId: string;
  createdAt: string;
  occurredAtMs?: number;
  attributes?: Readonly<Record<string, string>>;
};

/** One rollup row: a minute bucket of a project's spans. */
type RollupBucket = {
  tenantId: string;
  bucketStartMs: number;
  traceCount: number;
  errorCount: number;
  cost: number;
};

/** In-memory twin of the trace count reads, exact over the rows a test records. */
export class MemoryTraceUsageCountRepository extends TraceUsageCountRepository {
  readonly #traces: CountedTrace[] = [];
  readonly #buckets: RollupBucket[] = [];

  static create(): MemoryTraceUsageCountRepository {
    return new MemoryTraceUsageCountRepository();
  }

  private constructor() {
    super();
  }

  /** Seeds one trace summary row; `createdAt` uses the window's own DateTime64(3) spelling. */
  record(trace: CountedTrace): void {
    this.#traces.push(trace);
  }

  /** Seeds one rollup bucket, as the rollup projection appends it. */
  recordBucket(bucket: RollupBucket): void {
    this.#buckets.push(bucket);
  }

  async findTraceUsageByDay(input: {
    organizationId: string;
    projectIds: readonly string[];
    sinceMs: number;
  }): Promise<TraceUsageDay[]> {
    const days = new Map<string, TraceUsageDay>();
    for (const bucket of this.#buckets) {
      if (!input.projectIds.includes(bucket.tenantId) || bucket.bucketStartMs < input.sinceMs) {
        continue;
      }
      const day = Temporal.Instant.fromEpochMilliseconds(bucket.bucketStartMs)
        .toString()
        .slice(0, 10);
      const known = days.get(day);
      const failedAt = bucket.errorCount > 0 ? bucket.bucketStartMs : null;
      days.set(day, {
        day,
        traceCount: (known?.traceCount ?? 0) + bucket.traceCount,
        errorCount: (known?.errorCount ?? 0) + bucket.errorCount,
        totalCost: (known?.totalCost ?? 0) + bucket.cost,
        lastTraceAt: Math.max(known?.lastTraceAt ?? 0, bucket.bucketStartMs),
        lastFailedTraceAt:
          failedAt === null
            ? (known?.lastFailedTraceAt ?? null)
            : Math.max(known?.lastFailedTraceAt ?? 0, failedAt),
      });
    }
    return [...days.values()].toSorted((a, b) => a.day.localeCompare(b.day));
  }

  async findTraceIdsFirstSeen(input: {
    tenantId: string;
    fromMs: number;
    toMs: number;
    afterTraceId: string;
    limit: number;
  }): Promise<string[]> {
    const firstSeen = new Map<string, number>();
    for (const trace of this.#traces) {
      if (trace.tenantId !== input.tenantId) continue;
      const createdAtMs = Temporal.Instant.from(
        `${trace.createdAt.replace(" ", "T")}Z`,
      ).epochMilliseconds;
      const known = firstSeen.get(trace.traceId);
      if (known === undefined || createdAtMs < known) firstSeen.set(trace.traceId, createdAtMs);
    }
    return [...firstSeen]
      .filter(
        ([traceId, at]) => traceId > input.afterTraceId && at >= input.fromMs && at < input.toMs,
      )
      .map(([traceId]) => traceId)
      .toSorted()
      .slice(0, input.limit);
  }

  async countTracesInLastDay(input: { tenantId: string }): Promise<number> {
    const sinceMs = nowInstant().epochMilliseconds - DAY_MS;
    return new Set(this.#since({ tenantId: input.tenantId, sinceMs }).map((trace) => trace.traceId))
      .size;
  }

  async hasTraceWithAttribute(input: {
    tenantId: string;
    sinceMs: number;
    attribute: TraceAttributeMatch;
  }): Promise<boolean> {
    return this.#matching(input).length > 0;
  }

  async findTraceCountsByAttribute(input: {
    tenantId: string;
    sinceMs: number;
    attribute: TraceAttributeMatch;
    groupByKey: string;
  }): Promise<{ value: string; count: number }[]> {
    const counts = new Map<string, number>();
    for (const trace of this.#matching(input)) {
      const value = trace.attributes?.[input.groupByKey] ?? "";
      counts.set(value, (counts.get(value) ?? 0) + 1);
    }

    return [...counts.entries()]
      .map(([value, count]) => ({ value, count }))
      .toSorted((a, b) => b.count - a.count);
  }

  #since(input: { tenantId: string; sinceMs: number }): CountedTrace[] {
    return this.#traces.filter(
      (trace) => trace.tenantId === input.tenantId && (trace.occurredAtMs ?? -1) >= input.sinceMs,
    );
  }

  #matching(input: {
    tenantId: string;
    sinceMs: number;
    attribute: TraceAttributeMatch;
  }): CountedTrace[] {
    return this.#since(input).filter(
      (trace) => trace.attributes?.[input.attribute.key] === input.attribute.value,
    );
  }
}
