import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { SchedulerAuditEntryView, SchedulerControlAction } from "@langwatch/ops-contract";
import type { UserApi } from "@langwatch/user-contract";

const TARGET_KIND = "scheduled_job";

/** Scheduler operator acts: written to and listed from the audit log, each named by its actor. */
export class SchedulerAuditService {
  static create({
    auditLog,
    users,
  }: {
    auditLog: Pick<AuditLogApi, "record" | "findByTargetKind">;
    users: Pick<UserApi, "getProfiles">;
  }): SchedulerAuditService {
    return new SchedulerAuditService(auditLog, users);
  }

  private constructor(
    private readonly auditLog: Pick<AuditLogApi, "record" | "findByTargetKind">,
    private readonly users: Pick<UserApi, "getProfiles">,
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
      targetKind: TARGET_KIND,
      targetId: entry.scheduleId,
      metadata: { slot: entry.slot },
    });
  }

  async findRecent({ limit }: { limit: number }): Promise<SchedulerAuditEntryView[]> {
    const entries = await this.auditLog.findByTargetKind({ targetKind: TARGET_KIND, limit });
    const actors = await this.actorLabels({
      userIds: [...new Set(entries.flatMap((entry) => (entry.userId ? [entry.userId] : [])))],
    });

    return entries.map((entry) => ({
      id: entry.id,
      at: entry.createdAt.toISOString(),
      action: entry.action,
      scheduleId: entry.targetId ?? "",
      projectId: entry.projectId,
      actor: entry.userId ? (actors.get(entry.userId) ?? null) : null,
    }));
  }

  /** Name, else address; an account that is gone, or has neither, names no one. */
  private async actorLabels({ userIds }: { userIds: string[] }): Promise<Map<string, string>> {
    if (userIds.length === 0) return new Map();
    const profiles = await this.users.getProfiles({ userIds });

    return new Map(
      profiles.flatMap(({ id, name, email }) => {
        const label = name ?? email;
        return label ? [[id, label] as const] : [];
      }),
    );
  }
}
