import type {
  IdIndexFillReport,
  IdIndexFlags,
  IdIndexOwnerFill,
} from "@langwatch/clickhouse-client";

import { SuiteIdIndexFillRepository } from "../suite-id-index-fill.repository.ts";

/** Nothing to fill in memory: no view fills an index, and no read consults one. */
export class MemorySuiteIdIndexFillRepository extends SuiteIdIndexFillRepository {
  readonly readiness: IdIndexFlags = { isOn: () => false };

  static create(): MemorySuiteIdIndexFillRepository {
    return new MemorySuiteIdIndexFillRepository();
  }

  private constructor() {
    super();
  }

  fill(_input: IdIndexOwnerFill): Promise<IdIndexFillReport> {
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
