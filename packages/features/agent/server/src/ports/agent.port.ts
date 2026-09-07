import type {
  AgentFields,
  AgentHistoryEntry,
  RelatedAgentEntities,
} from "@langwatch/agent-contract";

export abstract class AgentsWorkflowPort {
  abstract fields(input: {
    projectId: string;
    workflowIds: string[];
  }): Promise<Record<string, AgentFields>>;
  abstract related(input: {
    projectId: string;
    workflowId: string;
  }): Promise<RelatedAgentEntities["workflow"]>;
  abstract copy(input: {
    workflowId: string;
    sourceProjectId: string;
    targetProjectId: string;
    actorUserId: string;
  }): Promise<{ workflowId: string }>;
  abstract archive(input: { workflowId: string; projectId: string }): Promise<{ id: string }>;
  abstract remove(input: { workflowId: string; projectId: string }): Promise<void>;
}

export abstract class AgentsAuditLogPort {
  abstract history(input: {
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
  user: {
    findMany(args: unknown): Promise<unknown[]>;
  };
};
