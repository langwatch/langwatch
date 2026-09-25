import {
  auditLogHistoryEntrySchema,
  type AuditLogEntry,
  type AuditLogHistoryEntry,
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

export class PrismaAuditLogRepository
  extends PrismaRepository.for("AuditLog")
  implements AuditLogRepository
{
  static readonly create = this.factory((prisma) => new PrismaAuditLogRepository(prisma));

  async create(entry: AuditLogEntry): Promise<RecordedAuditLogEntry> {
    const row = await this.prisma.auditLog.create({
      data: {
        ...entry,
        args: entry.args === null ? Prisma.JsonNull : entry.args,
        metadata: entry.metadata === null ? Prisma.JsonNull : entry.metadata,
      },
      select: { id: true, createdAt: true },
    });
    return { id: row.id, occurredAt: row.createdAt.getTime() };
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
}
