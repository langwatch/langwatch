import type {
  Agent,
  AgentConfig,
  AgentName,
  AgentReferenceState,
  AgentType,
  UpdateAgentCommand,
} from "@langwatch/agents-contract";

export type AgentCopyRecord = {
  id: string;
  name: string;
  projectId: string;
  fullPath: string;
};

export type PersistAgentInput = {
  id: string;
  projectId: string;
  name: string;
  type: AgentType;
  config: AgentConfig;
  workflowId?: string;
  copiedFromAgentId?: string;
};

export abstract class AgentRepository {
  abstract findById(input: {
    id: string;
    projectId: string;
  }): Promise<Agent | null>;
  abstract findByIdOnly(id: string): Promise<Agent | null>;
  abstract findAll(input: { projectId: string }): Promise<Agent[]>;
  abstract findReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<AgentReferenceState[]>;
  abstract findNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<AgentName[]>;
  abstract exists(input: { id: string; projectId: string }): Promise<boolean>;
  abstract findPage(input: {
    projectId: string;
    page: number;
    limit: number;
  }): Promise<{ data: Agent[]; total: number }>;
  abstract create(input: PersistAgentInput): Promise<Agent>;
  abstract update(
    input: UpdateAgentCommand & { type: AgentType; config?: AgentConfig },
  ): Promise<Agent>;
  abstract archive(input: { id: string; projectId: string }): Promise<Agent>;
  abstract findCopies(sourceAgentId: string): Promise<AgentCopyRecord[]>;
  abstract updateNameAndConfig(input: {
    id: string;
    projectId: string;
    name: string;
    config: AgentConfig;
  }): Promise<void>;
}
