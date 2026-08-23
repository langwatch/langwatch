import {
  agentSchema,
  agentTypeSchema,
  parseAgentConfig,
  type Agent,
} from "@langwatch/agents-contract";

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
  } as Record<string, unknown>;
  if (row._count) {
    agent.copyCount = row._count.copiedAgents;
  }
  return agentSchema.parse(agent);
}
