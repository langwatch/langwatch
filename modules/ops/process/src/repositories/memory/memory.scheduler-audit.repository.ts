import type { SchedulerAuditEntryView } from "@langwatch/ops-contract";

import { SchedulerAuditRepository } from "../ops-audit.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

/** The scheduler-control trail in memory, as a test or a seed placed it, newest first. */
export class MemorySchedulerAuditRepository extends SchedulerAuditRepository {
  static create({ store }: { store: MemoryOpsStore }): MemorySchedulerAuditRepository {
    return new MemorySchedulerAuditRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async findRecent({ limit }: { limit: number }): Promise<SchedulerAuditEntryView[]> {
    return [...this.store.schedulerAudit].reverse().slice(0, limit);
  }
}
