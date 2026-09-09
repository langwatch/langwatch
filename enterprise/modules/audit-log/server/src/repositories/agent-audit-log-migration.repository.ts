import type { AuditLogJsonValue } from "@langwatch/audit-log-contract";

export type AgentAuditLogRow = {
  id: string;
  projectId: string | null;
  createdAt: Date;
  args: AuditLogJsonValue;
};

export type AgentAuditLogCandidateQuery = {
  projectId: string;
  window: { gte: Date; lte: Date };
  copiedFromAgentId?: string;
};

export interface AgentAuditLogMigrationRepository {
  listLogs(input: { action: string; projectId?: string }): Promise<AgentAuditLogRow[]>;
  listCandidates(input: AgentAuditLogCandidateQuery): Promise<{ id: string }[]>;
  updateArgs(input: {
    logId: string;
    projectId: string;
    args: Record<string, AuditLogJsonValue>;
  }): Promise<void>;
}
