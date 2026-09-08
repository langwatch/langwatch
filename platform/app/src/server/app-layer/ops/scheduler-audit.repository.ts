import type { PrismaClient } from "~/generated/prisma/client";
import type {
  SchedulerAuditEntryView,
  SchedulerAuditSink,
  SchedulerControlAction,
} from "./scheduler-ops.service";

/**
 * Writes scheduler operator actions to the shared audit log (ADR-091).
 *
 * These controls are cross-tenant and can send a customer-facing artifact out
 * of band, so "why did this report send at 03:14" has to have an answer that
 * does not depend on someone remembering. `organizationId` is null: the ops
 * surface acts on a schedule by project, and inferring an organization would
 * mean a second lookup for a field nothing on this trail reads.
 */
export class SchedulerAuditRepository implements SchedulerAuditSink {
  constructor(private readonly prisma: PrismaClient) {}

  async append(entry: {
    actorUserId: string;
    action: SchedulerControlAction;
    scheduleId: string;
    projectId: string;
    slot: Date | null;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.actorUserId,
        projectId: entry.projectId,
        organizationId: null,
        action: entry.action,
        targetKind: "scheduled_job",
        targetId: entry.scheduleId,
        metadata: { slot: entry.slot?.toISOString() ?? null },
      },
    });
  }

  /**
   * The most recent scheduler control actions, newest first.
   *
   * Surfaced on the page that caused them so "why did this run at 03:14" is
   * answerable where it happened, rather than only in a log search somebody has
   * to know to run.
   */
  async listRecent({
    limit,
  }: {
    limit: number;
  }): Promise<SchedulerAuditEntryView[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { targetKind: "scheduled_job" },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        createdAt: true,
        action: true,
        targetId: true,
        projectId: true,
        userId: true,
      },
    });

    // `AuditLog.userId` is a bare scalar — the model carries no `user`
    // relation — so actors are resolved in a second bounded lookup rather than
    // a join. A trail that says `user_2Kx…` answers "who" for nobody.
    const userIds = [
      ...new Set(rows.map((row) => row.userId).filter((id) => id !== null)),
    ] as string[];
    const actors = new Map<string, string>();
    if (userIds.length > 0) {
      const users = await this.prisma.user.findMany({
        where: { id: { in: userIds } },
        select: { id: true, name: true, email: true },
      });
      for (const user of users) {
        const label = user.name ?? user.email;
        if (label) actors.set(user.id, label);
      }
    }

    return rows.map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      action: row.action,
      scheduleId: row.targetId ?? "",
      projectId: row.projectId,
      actor: row.userId ? (actors.get(row.userId) ?? null) : null,
    }));
  }
}
