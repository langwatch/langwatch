import {
  agentSchema,
  agentTypeSchema,
  parseAgentConfig,
  type Agent,
} from "@langwatch/agent-contract";

export type AgentRow = {
  id: string;
  projectId: string;
  name: string;
  type: unknown;
  config: unknown;
  workflowId?: string | null;
  copiedFromAgentId?: string | null;
  archivedAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
  _count?: { copiedAgents: number };
  /** Connected agents only (ADR-128); absent on every other row. */
  environment?: string | null;
  ownerUserId?: string | null;
  hostLabel?: string | null;
  identityKey?: string | null;
  lastSeenAt?: Date | null;
};

export function mapAgentRow(row: AgentRow): Agent {
  const type = agentTypeSchema.parse(row.type);
  const agent = {
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    type,
    config: parseAgentConfig(type, row.config),
    workflowId: row.workflowId ?? null,
    copiedFromAgentId: row.copiedFromAgentId ?? null,
    archivedAt: row.archivedAt ?? null,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    environment: row.environment ?? null,
    ownerUserId: row.ownerUserId ?? null,
    hostLabel: row.hostLabel ?? null,
    identityKey: row.identityKey ?? null,
    lastSeenAt: row.lastSeenAt ?? null,
  } as Record<string, unknown>;
  if (row._count) {
    agent.copyCount = row._count.copiedAgents;
  }
  return agentSchema.parse(agent);
}
