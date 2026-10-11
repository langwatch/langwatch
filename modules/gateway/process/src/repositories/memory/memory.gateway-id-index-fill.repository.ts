import type { FillIdIndexesOptions, IdIndexFillReport } from "@langwatch/clickhouse-client";

import { GatewayIdIndexFillRepository } from "../gateway-id-index-fill.repository.ts";

/** Nothing to fill in memory: no view fills an index, and no read consults one. */
export class MemoryGatewayIdIndexFillRepository extends GatewayIdIndexFillRepository {
  static create(): MemoryGatewayIdIndexFillRepository {
    return new MemoryGatewayIdIndexFillRepository();
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
