import { auditLogJsonValueSchema } from "@langwatch/audit-log-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import { fromDate } from "@langwatch/time";

import type {
  FindRecentTouchesInput,
  RecentTouch,
  RecentTouchRepository,
} from "../recent-touch.repository.ts";

export class PrismaRecentTouchRepository
  extends PrismaRepository.for("AuditLog")
  implements RecentTouchRepository
{
  static readonly create = this.factory((prisma) => new PrismaRecentTouchRepository(prisma));

  async findRecentTouches(input: FindRecentTouchesInput): Promise<RecentTouch[]> {
    const rows = await this.prisma.auditLog.findMany({
      where: {
        userId: input.userId,
        projectId: input.projectId,
        OR: input.actionPrefixes.map((prefix) => ({ action: { startsWith: prefix } })),
      },
      orderBy: { createdAt: "desc" },
      take: input.limit,
      select: { action: true, args: true, createdAt: true },
    });

    return rows.map((row) => ({
      action: row.action,
      args: auditLogJsonValueSchema.parse(row.args ?? null),
      createdAt: fromDate(row.createdAt),
    }));
  }
}
