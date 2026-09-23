import {
  auditLogHistoryEntrySchema,
  type AuditLogEntry,
  type AuditLogHistoryEntry,
  type ListAuditLogEntityHistoryInput,
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

export class PrismaAuditLogRepository
  extends PrismaRepository.for("AuditLog")
  implements AuditLogRepository
{
  static readonly create = this.factory((prisma) => new PrismaAuditLogRepository(prisma));

  async create(entry: AuditLogEntry): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        ...entry,
        args: entry.args === null ? Prisma.JsonNull : entry.args,
        metadata: entry.metadata === null ? Prisma.JsonNull : entry.metadata,
      },
    });
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

    return auditLogHistoryEntrySchema.array().parse(entries);
  }
}
