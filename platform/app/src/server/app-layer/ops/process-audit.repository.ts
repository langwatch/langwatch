import type { Prisma, PrismaClient } from "~/generated/prisma/client";

export type ProcessControlAction =
  | "process_wake_now"
  | "process_redrive_dead_instance"
  | "process_redrive_dead_message"
  | "process_release_lapsed_lease";

export interface ProcessAuditEntryView {
  id: string;
  createdAt: number;
  action: string;
  targetId: string;
  actorUserId: string | null;
  metadata: unknown;
}

export interface ProcessAuditSink {
  append(entry: {
    actorUserId: string;
    action: ProcessControlAction;
    processName: string;
    projectId: string;
    processKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  listRecent(params: { limit: number }): Promise<ProcessAuditEntryView[]>;
}

const TARGET_KIND = "process_instance";

/** For app presets that run without Postgres. */
export class NullProcessAuditSink implements ProcessAuditSink {
  async append(): Promise<void> {
    // no-op
  }
  async listRecent(): Promise<ProcessAuditEntryView[]> {
    return [];
  }
}

/**
 * Writes process-manager operator actions to the shared audit log, the same
 * contract the scheduler controls follow (ADR-091): a redriven intent is a
 * customer-visible effect re-emitted out of band, so "why did this deliver at
 * 03:14" must be answerable without anyone's memory.
 */
export class ProcessAuditRepository implements ProcessAuditSink {
  constructor(private readonly prisma: PrismaClient) {}

  async append(entry: {
    actorUserId: string;
    action: ProcessControlAction;
    processName: string;
    projectId: string;
    processKey: string;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.actorUserId,
        // Scheduled singletons run under the `__global__` pseudo-project; the
        // audit row records the ref verbatim rather than inventing a scope.
        projectId: entry.projectId,
        organizationId: null,
        action: entry.action,
        targetKind: TARGET_KIND,
        targetId: `${entry.processName}/${entry.projectId}/${entry.processKey}`,
        metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async listRecent(params: {
    limit: number;
  }): Promise<ProcessAuditEntryView[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: { targetKind: TARGET_KIND },
      orderBy: { createdAt: "desc" },
      take: params.limit,
      select: {
        id: true,
        createdAt: true,
        action: true,
        targetId: true,
        userId: true,
        metadata: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt.getTime(),
      action: r.action,
      targetId: r.targetId ?? "",
      actorUserId: r.userId,
      metadata: r.metadata,
    }));
  }
}
