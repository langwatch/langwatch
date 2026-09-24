import type { AuditLogJsonValue } from "@langwatch/audit-log-contract";
import type { Instant } from "@langwatch/time";

export type AgentAuditLogRow = {
  id: string;
  projectId: string | null;
  createdAt: Instant;
  args: AuditLogJsonValue;
};

export type AgentAuditLogCandidateQuery = {
  projectId: string;
  window: { gte: Instant; lte: Instant };
  copiedFromAgentId?: string;
};

export interface AgentAuditLogMigrationRepository {
  findLogs(input: { action: string; projectId?: string }): Promise<AgentAuditLogRow[]>;
  findCandidates(input: AgentAuditLogCandidateQuery): Promise<{ id: string }[]>;
  updateArgs(input: {
    logId: string;
    projectId: string;
    args: Record<string, AuditLogJsonValue>;
  }): Promise<void>;
}
