import type { IdIndexFillReport } from "@langwatch/clickhouse-client";

import {
  TraceIdIndexFillRepository,
  type TraceIdIndexFillInput,
} from "../trace-id-index-fill.repository.ts";

/** No ClickHouse, so no index and no retention to raise: the shared target is flagged at once. */
export class MemoryTraceIdIndexFillRepository extends TraceIdIndexFillRepository {
  static create(): MemoryTraceIdIndexFillRepository {
    return new MemoryTraceIdIndexFillRepository();
  }

  private constructor() {
    super();
  }

  async fill({ dryRun, setFlag }: TraceIdIndexFillInput): Promise<IdIndexFillReport> {
    const report: IdIndexFillReport = {
      targetsDone: [],
      targetsFailed: [],
      cursor: null,
      done: 0,
      total: 0,
      batches: 0,
      retries: 0,
    };
    if (dryRun) return { ...report, dryRun: { partitions: 0, rows: 0 } };
    await setFlag({ target: "shared" });
    return { ...report, targetsDone: ["shared"] };
  }
}
