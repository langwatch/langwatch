import {
  auditLogExportEntrySchema,
  auditLogHistoryEntrySchema,
  auditLogTargetEntrySchema,
  type AuditLogEntry,
  type AuditLogExportEntry,
  type AuditLogHistoryEntry,
  type AuditLogTargetEntry,
  type FindAuditLogByTargetKindInput,
  type FindAuditLogForOrganizationInput,
  type ListAuditLogEntityHistoryInput,
  type RecordedAuditLogEntry,
  type RecordedSinceInput,
} from "@langwatch/audit-log-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import { Prisma } from "@langwatch/prisma-client/generated";

import type { AuditLogRepository } from "../audit-log.repository.ts";

const historySelect = {
  id: true,
  userId: true,
  action: true,
  createdAt: true,
  args: true,
} as const;

const auditLogHistoryEntriesSchema = auditLogHistoryEntrySchema.array();

const targetSelect = {
  id: true,
  createdAt: true,
  action: true,
  targetId: true,
  projectId: true,
  userId: true,
  metadata: true,
} as const;

const auditLogTargetEntriesSchema = auditLogTargetEntrySchema.array();

const exportSelect = {
  id: true,
  createdAt: true,
  userId: true,
  actorUserId: true,
  organizationId: true,
  projectId: true,
  action: true,
  error: true,
  ipAddress: true,
  userAgent: true,
  targetKind: true,
  targetId: true,
} as const;

const auditLogExportEntriesSchema = auditLogExportEntrySchema.array();

/** The entry as a row; a JSON `null` is stored as JSON, not as an absent column. */
function rowData(entry: AuditLogEntry) {
  const json = (value: AuditLogEntry["args"]) => (value === null ? Prisma.JsonNull : value);
  return {
    ...entry,
    args: json(entry.args),
    metadata: json(entry.metadata),
    before: json(entry.before),
    after: json(entry.after),
  };
}

export class PrismaAuditLogRepository
  extends PrismaRepository.for("AuditLog")
  implements AuditLogRepository
{
  static readonly create = this.factory((prisma) => new PrismaAuditLogRepository(prisma));

  async create(entry: AuditLogEntry): Promise<RecordedAuditLogEntry> {
    const row = await this.prisma.auditLog.create({
      data: rowData(entry),
      select: { id: true, createdAt: true },
    });
    return { id: row.id, occurredAt: row.createdAt.getTime() };
  }

  async createOnce({
    entry,
    idempotencyKey,
    occurredAt,
  }: {
    entry: AuditLogEntry;
    idempotencyKey: string;
    occurredAt: number;
  }): Promise<RecordedAuditLogEntry> {
    try {
      const row = await this.prisma.auditLog.create({
        data: { ...rowData(entry), idempotencyKey, createdAt: new Date(occurredAt) },
        select: { id: true, createdAt: true },
      });
      return { id: row.id, occurredAt: row.createdAt.getTime() };
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== "P2002") {
        throw error;
      }
      const row = await this.prisma.auditLog.findUniqueOrThrow({
        where: { idempotencyKey },
        select: { id: true, createdAt: true },
      });
      return { id: row.id, occurredAt: row.createdAt.getTime() };
    }
  }

  async hasRecordedSince(input: RecordedSinceInput): Promise<boolean> {
    const recent = await this.prisma.auditLog.findFirst({
      where: {
        userId: input.userId,
        action: input.action,
        targetKind: input.targetKind,
        targetId: input.targetId,
        createdAt: { gte: new Date(input.sinceMs) },
      },
      select: { id: true },
    });
    return recent !== null;
  }

  async findEntityHistory(input: ListAuditLogEntityHistoryInput): Promise<AuditLogHistoryEntry[]> {
    const entries = await this.prisma.auditLog.findMany({
      where: {
        projectId: input.projectId,
        action: { startsWith: input.actionPrefix },
        OR: input.argumentNames.map((name) => ({ args: { path: [name], equals: input.entityId } })),
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
      select: historySelect,
    });

    return auditLogHistoryEntriesSchema.parse(entries);
  }

  async findByTargetKind(input: FindAuditLogByTargetKindInput): Promise<AuditLogTargetEntry[]> {
    const entries = await this.prisma.auditLog.findMany({
      where: { targetKind: input.targetKind },
      orderBy: { createdAt: "desc" },
      take: input.limit,
      select: targetSelect,
    });

    return auditLogTargetEntriesSchema.parse(entries);
  }

  /** Served by the (organizationId, createdAt) and projectId indexes; ties break by id. */
  async findForOrganization(
    input: FindAuditLogForOrganizationInput,
  ): Promise<AuditLogExportEntry[]> {
    const after = new Date(input.afterMs);
    const entries = await this.prisma.auditLog.findMany({
      where: {
        AND: [
          {
            OR: [
              { organizationId: input.organizationId },
              ...(input.projectIds.length > 0 ? [{ projectId: { in: input.projectIds } }] : []),
            ],
          },
          {
            OR: [{ createdAt: { gt: after } }, { createdAt: after, id: { gt: input.afterId } }],
          },
          ...(input.untilMs !== undefined ? [{ createdAt: { lt: new Date(input.untilMs) } }] : []),
        ],
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      take: input.limit,
      select: exportSelect,
    });

    return auditLogExportEntriesSchema.parse(entries);
  }
}
