import type {
  AgentFields,
  AgentHistoryEntry,
  RelatedAgentEntities,
} from "@langwatch/agent-contract";

export interface AgentsWorkflowPort {
  fields(input: {
    projectId: string;
    workflowIds: string[];
  }): Promise<Record<string, AgentFields>>;
  related(input: {
    projectId: string;
    workflowId: string;
  }): Promise<RelatedAgentEntities["workflow"]>;
  copy(input: {
    workflowId: string;
    sourceProjectId: string;
    targetProjectId: string;
    actorUserId: string;
  }): Promise<{ workflowId: string }>;
  archive(input: {
    workflowId: string;
    projectId: string;
  }): Promise<{ id: string }>;
  remove(input: { workflowId: string; projectId: string }): Promise<void>;
}

export interface AgentsAuditLogPort {
  history(input: {
    agentId: string;
    projectId: string;
    limit: number;
  }): Promise<AgentHistoryEntry[]>;
}

export type AgentsDatabase = {
  agent: {
    findFirst(args: unknown): Promise<unknown>;
    findMany(args: unknown): Promise<unknown[]>;
    count(args: unknown): Promise<number>;
    create(args: unknown): Promise<unknown>;
    update(args: unknown): Promise<unknown>;
  };
};
