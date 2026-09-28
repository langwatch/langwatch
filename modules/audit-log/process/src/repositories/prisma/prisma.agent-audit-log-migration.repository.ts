import { auditLogJsonValueSchema, type AuditLogJsonValue } from "@langwatch/audit-log-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import { fromDate } from "@langwatch/time";

import type {
  AgentAuditLogMigrationRepository,
  AgentAuditLogRow,
} from "../agent-audit-log-migration.repository.ts";

export class PrismaAgentAuditLogMigrationRepository
  extends PrismaRepository.for("AuditLog")
  implements AgentAuditLogMigrationRepository
{
  static readonly create = this.factory(
    (prisma) => new PrismaAgentAuditLogMigrationRepository(prisma),
  );

  async findLogs(input: { action: string; projectId?: string }): Promise<AgentAuditLogRow[]> {
    const logs = await this.prisma.auditLog.findMany({
      where: { action: input.action, projectId: input.projectId },
      select: { id: true, projectId: true, createdAt: true, args: true },
    });

    return logs.map((log) => ({
      id: log.id,
      projectId: log.projectId,
      createdAt: fromDate(log.createdAt),
      args: auditLogJsonValueSchema.parse(log.args),
    }));
  }

  async updateArgs(input: {
    logId: string;
    projectId: string;
    args: Record<string, AuditLogJsonValue>;
  }): Promise<void> {
    await this.prisma.auditLog.update({
      where: { id: input.logId, projectId: input.projectId },
      data: { args: input.args },
    });
  }
}
