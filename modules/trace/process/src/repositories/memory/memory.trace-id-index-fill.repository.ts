import type {
  IdIndexFillReport,
  IdIndexFlags,
  IdIndexOwnerFill,
} from "@langwatch/clickhouse-client";

import { TraceIdIndexFillRepository } from "../trace-id-index-fill.repository.ts";

/** No ClickHouse, so no index and no retention to raise, and no index is ever ready to read. */
export class MemoryTraceIdIndexFillRepository extends TraceIdIndexFillRepository {
  static create(): MemoryTraceIdIndexFillRepository {
    return new MemoryTraceIdIndexFillRepository();
  }

  readonly readiness: IdIndexFlags = { isOn: () => false };

  private constructor() {
    super();
  }

  async fill({ dryRun }: IdIndexOwnerFill): Promise<IdIndexFillReport> {
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
    return { ...report, targetsDone: ["shared"] };
  }
}
