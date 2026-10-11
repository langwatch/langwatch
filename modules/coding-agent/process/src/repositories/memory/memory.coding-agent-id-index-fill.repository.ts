import type {
  IdIndexFillReport,
  IdIndexFlags,
  IdIndexOwnerFill,
} from "@langwatch/clickhouse-client";

import { CodingAgentIdIndexFillRepository } from "../coding-agent-id-index-fill.repository.ts";

/** Nothing to fill in memory: no view fills an index, and no read consults one. */
export class MemoryCodingAgentIdIndexFillRepository extends CodingAgentIdIndexFillRepository {
  static create(): MemoryCodingAgentIdIndexFillRepository {
    return new MemoryCodingAgentIdIndexFillRepository();
  }

  readonly readiness: IdIndexFlags = { isOn: () => false };

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
