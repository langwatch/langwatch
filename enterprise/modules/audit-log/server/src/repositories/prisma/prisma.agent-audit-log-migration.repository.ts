import { auditLogJsonValueSchema, type AuditLogJsonValue } from "@langwatch/audit-log-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { scopedPrismaClient, type ScopedPrismaClient } from "@langwatch/prisma-client/ownership";
import type {
  AgentAuditLogCandidateQuery,
  AgentAuditLogMigrationRepository,
} from "../agent-audit-log-migration.repository.ts";

export type AgentAuditLogMigrationDatabase = PrismaClient;

export class PrismaAgentAuditLogMigrationRepository implements AgentAuditLogMigrationRepository {
  readonly #database: ScopedPrismaClient<["AuditLog", "Agent"]>;

  private constructor(database: PrismaClient) {
    // Historical repair reads Agent candidates; it never installs ownership of Agent tables.
    this.#database = scopedPrismaClient(database, ["AuditLog", "Agent"]);
  }

  static create(database: PrismaClient) {
    return new PrismaAgentAuditLogMigrationRepository(database);
  }

  async listLogs(input: { action: string; projectId?: string }) {
    const logs = await this.#database.auditLog.findMany({
      where: { action: input.action, projectId: input.projectId },
      select: { id: true, projectId: true, createdAt: true, args: true },
    });

    return logs.map((log) => ({
      id: log.id,
      projectId: log.projectId,
      createdAt: log.createdAt,
      args: auditLogJsonValueSchema.parse(log.args),
    }));
  }

  listCandidates(input: AgentAuditLogCandidateQuery) {
    return this.#database.agent.findMany({
      where: {
        projectId: input.projectId,
        createdAt: input.window,
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
  }) {
    await this.#database.auditLog.update({
      where: { id: input.logId, projectId: input.projectId },
      data: { args: input.args },
    });
  }
}
