import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";

import { ScenarioIdIndexFillRepository } from "../scenario-id-index-fill.repository.ts";

/** Nothing to fill in memory: no view fills an index, and no read consults one. */
export class MemoryScenarioIdIndexFillRepository extends ScenarioIdIndexFillRepository {
  readonly indexes = [];

  static create(): MemoryScenarioIdIndexFillRepository {
    return new MemoryScenarioIdIndexFillRepository();
  }

  private constructor() {
    super();
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
