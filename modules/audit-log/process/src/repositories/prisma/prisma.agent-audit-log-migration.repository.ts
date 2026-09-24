import { auditLogJsonValueSchema, type AuditLogJsonValue } from "@langwatch/audit-log-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { scopedPrismaClient, type ScopedPrismaClient } from "@langwatch/prisma-client/ownership";
import { fromDate, toDate } from "@langwatch/time";

import type {
  AgentAuditLogCandidateQuery,
  AgentAuditLogMigrationRepository,
  AgentAuditLogRow,
} from "../agent-audit-log-migration.repository.ts";

export type AgentAuditLogMigrationDatabase = PrismaClient;

export class PrismaAgentAuditLogMigrationRepository implements AgentAuditLogMigrationRepository {
  readonly #database: ScopedPrismaClient<["AuditLog", "Agent"]>;

  private constructor(database: PrismaClient) {
    // Historical repair reads Agent candidates; it never installs ownership of Agent tables.
    this.#database = scopedPrismaClient(database, ["AuditLog", "Agent"]);
  }

  static create(database: PrismaClient): PrismaAgentAuditLogMigrationRepository {
    return new PrismaAgentAuditLogMigrationRepository(database);
  }

  async findLogs(input: { action: string; projectId?: string }): Promise<AgentAuditLogRow[]> {
    const logs = await this.#database.auditLog.findMany({
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

  findCandidates(input: AgentAuditLogCandidateQuery): Promise<{ id: string }[]> {
    return this.#database.agent.findMany({
      where: {
        projectId: input.projectId,
        createdAt: {
          gte: toDate(input.window.gte),
          lte: toDate(input.window.lte),
        },
        copiedFromAgentId: input.copiedFromAgentId,
      },
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });
  }

  async updateArgs(input: {
    logId: string;
    projectId: string;
    args: Record<string, AuditLogJsonValue>;
  }): Promise<void> {
    await this.#database.auditLog.update({
      where: { id: input.logId, projectId: input.projectId },
      data: { args: input.args },
    });
  }
}
