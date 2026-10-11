import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";

import { CodingAgentIdIndexFillRepository } from "../coding-agent-id-index-fill.repository.ts";

/** Nothing to fill in memory: no view fills an index, and no read consults one. */
export class MemoryCodingAgentIdIndexFillRepository extends CodingAgentIdIndexFillRepository {
  static create(): MemoryCodingAgentIdIndexFillRepository {
    return new MemoryCodingAgentIdIndexFillRepository();
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
