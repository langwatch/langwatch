import type { AuditLogJsonValue } from "@langwatch/audit-log-contract";

import type {
  AgentAuditLogMigrationRepository,
  AgentAuditLogRow,
} from "../agent-audit-log-migration.repository.ts";
import type { MemoryAuditLogStore } from "./memory.audit-log.store.ts";

export class MemoryAgentAuditLogMigrationRepository implements AgentAuditLogMigrationRepository {
  private constructor(private readonly store: MemoryAuditLogStore) {}

  static create({ store }: { store: MemoryAuditLogStore }): MemoryAgentAuditLogMigrationRepository {
    return new MemoryAgentAuditLogMigrationRepository(store);
  }

  async findLogs(input: { action: string; projectId?: string }): Promise<AgentAuditLogRow[]> {
    return this.store.rows
      .filter((row) => row.action === input.action)
      .filter((row) => input.projectId === void 0 || row.projectId === input.projectId)
      .map((row) => ({
        id: row.id,
        projectId: row.projectId ?? null,
        createdAt: row.createdAt,
        args: row.args ?? null,
      }));
  }

  async updateArgs(input: {
    logId: string;
    projectId: string;
    args: Record<string, AuditLogJsonValue>;
  }): Promise<void> {
    const row = this.store.rows.find(
      (candidate) => candidate.id === input.logId && candidate.projectId === input.projectId,
    );
    if (row) row.args = input.args;
  }
}
