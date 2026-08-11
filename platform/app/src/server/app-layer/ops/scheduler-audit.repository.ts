import type { PrismaClient } from "@prisma/client";
import type {
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
  }): Promise<SchedulerAuditEntry[]> {
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
        user: { select: { name: true, email: true } },
      },
    });

    return rows.map((row) => ({
      id: row.id,
      at: row.createdAt.toISOString(),
      action: row.action,
      scheduleId: row.targetId ?? "",
      projectId: row.projectId,
      // Name first, email as the fallback: an operator reading a trail wants to
      // know WHO, and a bare user id answers that for nobody.
      actor: row.user?.name ?? row.user?.email ?? null,
    }));
  }
}

/** One operator action as the scheduler page lists it. */
export interface SchedulerAuditEntry {
  id: string;
  at: string;
  action: string;
  scheduleId: string;
  projectId: string | null;
  actor: string | null;
}
