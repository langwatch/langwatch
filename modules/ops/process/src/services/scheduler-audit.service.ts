import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { SchedulerAuditEntryView, SchedulerControlAction } from "@langwatch/ops-contract";

import type { SchedulerAuditRepository } from "../repositories/ops-audit.repository.ts";

/** Scheduler operator acts: written through the audit log, listed from ops' trail. */
export class SchedulerAuditService {
  static create({
    auditLog,
    history,
  }: {
    auditLog: Pick<AuditLogApi, "record">;
    history: SchedulerAuditRepository;
  }): SchedulerAuditService {
    return new SchedulerAuditService(auditLog, history);
  }

  private constructor(
    private readonly auditLog: Pick<AuditLogApi, "record">,
    private readonly history: SchedulerAuditRepository,
  ) {}

  async append(entry: {
    actorUserId: string;
    action: SchedulerControlAction;
    scheduleId: string;
    projectId: string;
    slot: string | null;
  }): Promise<void> {
    await this.auditLog.record({
      userId: entry.actorUserId,
      projectId: entry.projectId,
      action: entry.action,
      targetKind: "scheduled_job",
      targetId: entry.scheduleId,
      metadata: { slot: entry.slot },
    });
  }

  findRecent(params: { limit: number }): Promise<SchedulerAuditEntryView[]> {
    return this.history.findRecent(params);
  }
}
