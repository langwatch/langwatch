import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";

import { EventLogIdIndexFillRepository } from "../event-log-id-index-fill.repository.ts";

/** Nothing to fill in memory: no view fills the index, and no read consults one. */
export class MemoryEventLogIdIndexFillRepository extends EventLogIdIndexFillRepository {
  static create(): MemoryEventLogIdIndexFillRepository {
    return new MemoryEventLogIdIndexFillRepository();
  }

  private constructor() {
    super();
  }

  indexesWithCopiedRetention(): string[] {
    return [];
  }

  fill(
    _input: Omit<FillIdIndexesOptions, "statements" | "targets" | "indexes">,
  ): Promise<IdIndexFillReport> {
    return Promise.resolve({
      targetsDone: [],
      targetsFailed: [],
      cursor: null,
      done: 0,
      total: 0,
      batches: 0,
      retries: 0,
    });
  }
}
