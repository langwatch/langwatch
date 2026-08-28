import type {
  Agent,
  AgentCopy,
  AgentHistoryEntry,
  AgentWithFields,
  CreateAgentCommand,
  RelatedAgentEntities,
  UpdateAgentCommand,
} from "@langwatch/agent-contract";

export type AgentCopyInput = {
  agentId: string;
  projectId: string;
  sourceProjectId: string;
  newAgentId?: string;
};

export type AgentCopyResult = {
  id: string;
  projectId: string;
  name: string;
  copiedFromAgentId: string;
};

export type AgentCopiesInput = {
  projectId: string;
  agentId: string;
};

export type AgentPushToCopiesInput = {
  projectId: string;
  agentId: string;
  copyIds?: string[];
};

export type AgentSyncFromSourceInput = {
  projectId: string;
  agentId: string;
};

export type AgentHistoryInput = {
  agentId: string;
  projectId: string;
};

/** Browser-facing agent operations, independent of an RPC client library. */
export abstract class AgentBrowserPort {
  abstract getById(input: { id: string; projectId: string }): Promise<AgentWithFields>;

  abstract create(input: CreateAgentCommand): Promise<AgentWithFields>;

  abstract update(input: UpdateAgentCommand): Promise<AgentWithFields>;

  abstract relatedEntities(input: { id: string; projectId: string }): Promise<RelatedAgentEntities>;

  abstract cascadeArchive(input: {
    id: string;
    projectId: string;
  }): Promise<{ agent: Agent; archivedWorkflow: { id: string } | null }>;

  abstract archive(input: { id: string; projectId: string }): Promise<Agent>;

  abstract getCopies(input: AgentCopiesInput): Promise<AgentCopy[]>;

  abstract copy(input: AgentCopyInput): Promise<AgentCopyResult>;

  abstract pushToCopies(input: AgentPushToCopiesInput): Promise<{
    pushedTo: number;
    selectedCopies: number;
  }>;

  abstract syncFromSource(input: AgentSyncFromSourceInput): Promise<{ ok: true }>;

  abstract getHistory(input: AgentHistoryInput): Promise<AgentHistoryEntry[]>;
}
