import type { ProcessAuditEntryView } from "@langwatch/ops-contract";

import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { ProcessAuditSink, type ProcessControlAction } from "../../ports/process-audit.sink";

const TARGET_KIND = "process_instance";

/** Target of an act that names no single instance; the scope is in metadata. */
const FLEET_TARGET_ID = "fleet";

/**
 * Writes process-manager operator actions to the shared audit log, the same customer-visible effect re-emitted out
 * of band, so "why did this deliver at 03:14" must be answerable without anyone's memory.
 * contract the scheduler controls follow (ADR-091): a redriven intent is a
 */
export class ProcessAuditRepository extends ProcessAuditSink {
  static create({ prisma }: { prisma: PrismaClient }): ProcessAuditRepository {
    return new ProcessAuditRepository(prisma);
  }

  private constructor(private readonly prisma: PrismaClient) {
    super();
  }

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
