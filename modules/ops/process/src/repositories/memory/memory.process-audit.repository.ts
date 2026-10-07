import type { ProcessAuditEntryView } from "@langwatch/ops-contract";

import { ProcessAuditRepository } from "../ops-audit.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/** The process-control trail in memory, as a test or a seed placed it, newest first. */
export class MemoryProcessAuditRepository extends ProcessAuditRepository {
  static create({ store }: { store: MemoryOpsStore }): MemoryProcessAuditRepository {
    return new MemoryProcessAuditRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async findRecent({ limit }: { limit: number }): Promise<ProcessAuditEntryView[]> {
    return [...this.store.processAudit]
      .toSorted((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);
  }
}
