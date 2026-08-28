import type {
  SchedulerAuditEntryView,
  SchedulerControlAction,
} from "@langwatch/ops-contract";
import { SchedulerAuditSink } from "../../ports/scheduler-audit.sink";

/** Writes scheduler controls to the shared audit log. */
export type SchedulerAuditDatabase = {
  auditLog: {
    create(input: {
      data: {
        userId: string;
        projectId: string;
        organizationId: null;
        action: SchedulerControlAction;
        targetKind: string;
        targetId: string;
        metadata: { slot: string | null };
      };
    }): Promise<unknown>;
    findMany(input: {
      where: { targetKind: string };
      orderBy: { createdAt: "desc" };
      take: number;
      select: {
        id: true;
        createdAt: true;
        action: true;
        targetId: true;
        projectId: true;
        userId: true;
      };
    }): Promise<
      Array<{
        id: string;
        createdAt: Date;
        action: string;
        targetId: string | null;
        projectId: string | null;
        userId: string | null;
      }>
    >;
  };
  user: {
    findMany(input: {
      where: { id: { in: string[] } };
      select: { id: true; name: true; email: true };
    }): Promise<Array<{ id: string; name: string | null; email: string | null }>>;
  };
};

export class PrismaSchedulerAuditRepository extends SchedulerAuditSink {
  private constructor(private readonly database: SchedulerAuditDatabase) {
    super();
  }

  static create(database: SchedulerAuditDatabase): PrismaSchedulerAuditRepository {
    return new PrismaSchedulerAuditRepository(database);
  }

  async append(entry: {
    actorUserId: string;
    action: SchedulerControlAction;
    scheduleId: string;
    projectId: string;
    slot: Date | null;
  }): Promise<void> {
    await this.database.auditLog.create({
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

  async listRecent({ limit }: { limit: number }): Promise<SchedulerAuditEntryView[]> {
    const rows = await this.database.auditLog.findMany({
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

    const userIds = [
      ...new Set(rows.map((row) => row.userId).filter((id): id is string => id !== null)),
    ];
    const actors = new Map<string, string>();
    if (userIds.length > 0) {
      const users = await this.database.user.findMany({
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
