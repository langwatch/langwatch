import { nowInstant } from "@langwatch/time";
import type { TraceAttributeMatch } from "@langwatch/trace-contract";

import { TraceUsageCountRepository } from "../trace-usage-count.repository.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;

type CountedTrace = {
  tenantId: string;
  traceId: string;
  createdAt: string;
  occurredAtMs?: number;
  attributes?: Readonly<Record<string, string>>;
};

/** Exact where ClickHouse's `uniq` is approximate, so small test data stays deterministic. */
export class MemoryTraceUsageCountRepository extends TraceUsageCountRepository {
  readonly #traces: CountedTrace[] = [];

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

  async countDistinctTraces(input: {
    tenantId: string;
    startDate: string;
    endDate: string;
  }): Promise<number> {
    const traceIds = this.#traces
      .filter(
        (trace) =>
          trace.tenantId === input.tenantId &&
          trace.createdAt >= input.startDate &&
          trace.createdAt < input.endDate,
      )
      .map((trace) => trace.traceId);

    return new Set(traceIds).size;
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
