import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { ProcessAuditEntryView } from "@langwatch/ops-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { z } from "zod";

import { ProcessAuditRepository, type ProcessControlAction } from "../ops-audit.repository.ts";

const TARGET_KIND = "process_instance";

const auditMetadataSchema = z.record(z.string(), z.json());

/** Target of an act that names no single instance; the scope is in metadata. */
const FLEET_TARGET_ID = "fleet";

/** Process-manager operator actions written to audit log so delivery timing
 * is answerable without anyone's memory. */
export class PrismaProcessAuditRepository extends ProcessAuditRepository {
  static create({
    prisma,
    auditLog,
  }: {
    prisma: PrismaClient;
    auditLog: AuditLogApi;
  }): PrismaProcessAuditRepository {
    return new PrismaProcessAuditRepository(prisma, auditLog);
  }

  private constructor(
    private readonly prisma: PrismaClient,
    private readonly auditLog: AuditLogApi,
  ) {
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
    // Scheduled singletons run under `__global__`; the audit records the ref
    // verbatim rather than inventing a scope. The target triple is written
    // only when all three parts are real - a bulk act with a name but no
    // instance would otherwise read as `foo/null/null`, a nonexistent one.
    await this.auditLog.record({
      userId: entry.actorUserId,
      ...(entry.projectId === null ? {} : { projectId: entry.projectId }),
      action: entry.action,
      targetKind: TARGET_KIND,
      targetId:
        entry.processName && entry.projectId && entry.processKey
          ? `${entry.processName}/${entry.projectId}/${entry.processKey}`
          : FLEET_TARGET_ID,
      metadata: auditMetadataSchema.parse(entry.metadata ?? {}),
    });
  }

  async findRecent(params: { limit: number }): Promise<ProcessAuditEntryView[]> {
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
