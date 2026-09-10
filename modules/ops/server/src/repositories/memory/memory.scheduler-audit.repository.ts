import { generate } from "@langwatch/ksuid";
import type { SchedulerAuditEntryView, SchedulerControlAction } from "@langwatch/ops-contract";
import { nowInstant } from "@langwatch/time";
import { SchedulerAuditSink } from "../ops-audit.repository.ts";
import type { MemoryOpsStore } from "./memory.ops.store.ts";

const SCHEDULER_AUDIT_KSUID_RESOURCE = "schedaudit";

/** The scheduler-control trail in memory, newest act first on a read. */
export class MemorySchedulerAuditRepository extends SchedulerAuditSink {
  static create({ store }: { store: MemoryOpsStore }): MemorySchedulerAuditRepository {
    return new MemorySchedulerAuditRepository(store);
  }

  private constructor(private readonly store: MemoryOpsStore) {
    super();
  }

  async append(entry: {
    actorUserId: string;
    action: SchedulerControlAction;
    scheduleId: string;
    projectId: string;
    slot: Date | null;
  }): Promise<void> {
    this.store.schedulerAudit.push({
      id: generate(SCHEDULER_AUDIT_KSUID_RESOURCE).toString(),
      at: nowInstant().toString(),
      action: entry.action,
      scheduleId: entry.scheduleId,
      projectId: entry.projectId,
      actor: entry.actorUserId,
    });
  }

  async listRecent({ limit }: { limit: number }): Promise<SchedulerAuditEntryView[]> {
    return [...this.store.schedulerAudit].reverse().slice(0, limit);
  }
}
