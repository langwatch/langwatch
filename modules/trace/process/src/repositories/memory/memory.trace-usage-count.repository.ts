import { TraceUsageCountRepository } from "../trace-usage-count.repository.ts";

type CountedTrace = { tenantId: string; traceId: string; createdAt: string };

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
}
