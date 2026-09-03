import type { ProcessAuditEntryView } from "@langwatch/ops-contract";

import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";

export type ProcessControlAction =
  | "process_wake_now"
  | "process_redrive_dead_instance"
  | "process_redrive_dead_message"
  | "process_discard_dead_message"
  /** Fleet-scoped acts record a pseudo-ref (`__fleet__`/`__all__`), the same
   *  shape scheduled singletons use for their `__global__` pseudo-project;
   *  the count moved lives in metadata. */
  | "process_redrive_dead_letters"
  | "process_discard_dead_letters"
  | "process_release_lapsed_lease";

export interface ProcessAuditSink {
  append(entry: {
    actorUserId: string;
    action: ProcessControlAction;
    /** Null for a fleet-scoped act, which belongs to no one process. */
    processName: string | null;
    /** Null for a cross-tenant act. Never a placeholder: a made-up id in
     *  this column reads as a real project to everything that queries it. */
    projectId: string | null;
    processKey: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void>;
  listRecent(params: { limit: number }): Promise<ProcessAuditEntryView[]>;
}

const TARGET_KIND = "process_instance";

/** Target of an act that names no single instance; the scope is in metadata. */
const FLEET_TARGET_ID = "fleet";

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
    processName: string | null;
    projectId: string | null;
    processKey: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        userId: entry.actorUserId,
        // Scheduled singletons run under the `__global__` pseudo-project; the
        // audit row records the ref verbatim rather than inventing a scope.
        // A fleet-scoped act has no project at all and records null, the same
        // as the queue sink: a placeholder here would read as a real project
        // to every query over this column.
        projectId: entry.projectId,
        organizationId: null,
        action: entry.action,
        targetKind: TARGET_KIND,
        // The triple only when all three parts are real. A process-scoped
        // bulk act has a name but no instance, and `foo/null/null` would
        // read as an instance that does not exist; the scope is in metadata.
        targetId:
          entry.processName && entry.projectId && entry.processKey
            ? `${entry.processName}/${entry.projectId}/${entry.processKey}`
            : FLEET_TARGET_ID,
        metadata: (entry.metadata ?? {}) as Prisma.InputJsonValue,
      },
    });
  }

  async listRecent(params: { limit: number }): Promise<ProcessAuditEntryView[]> {
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
