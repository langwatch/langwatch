import type { AuditLogJsonValue } from "@langwatch/audit-log-contract";
import type { Instant } from "@langwatch/time";

export type AgentAuditLogRow = {
  id: string;
  projectId: string | null;
  createdAt: Instant;
  args: AuditLogJsonValue;
};

export interface AgentAuditLogMigrationRepository {
  findLogs(input: { action: string; projectId?: string }): Promise<AgentAuditLogRow[]>;
  updateArgs(input: {
    logId: string;
    projectId: string;
    args: Record<string, AuditLogJsonValue>;
  }): Promise<void>;
}
