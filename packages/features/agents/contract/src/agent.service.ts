import type { Agent, AgentWithFields } from "./agent";
import type {
  ArchiveAgentCommand,
  CopyAgentCommand,
  CreateAgentCommand,
  UpdateAgentCommand,
} from "./agent.commands";
import type {
  AgentCopy,
  AgentHistoryEntry,
  AgentName,
  AgentPage,
  AgentReferenceState,
  RelatedAgentEntities,
} from "./agent.queries";

export abstract class AgentService {
  abstract getById(input: {
    id: string;
    projectId: string;
  }): Promise<AgentWithFields>;
  abstract getAll(input: { projectId: string }): Promise<AgentWithFields[]>;
  abstract getReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<AgentReferenceState[]>;
  abstract getNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<AgentName[]>;
  abstract exists(input: { id: string; projectId: string }): Promise<boolean>;
  abstract list(input: {
    projectId: string;
    page: number;
    limit: number;
  }): Promise<AgentPage>;
  abstract create(input: CreateAgentCommand): Promise<AgentWithFields>;
  abstract update(input: UpdateAgentCommand): Promise<AgentWithFields>;
  abstract archive(input: ArchiveAgentCommand): Promise<Agent>;
  abstract relatedEntities(input: {
    id: string;
    projectId: string;
  }): Promise<RelatedAgentEntities>;
  abstract cascadeArchive(
    input: ArchiveAgentCommand,
  ): Promise<{ agent: Agent; archivedWorkflow: { id: string } | null }>;
  abstract getCopies(input: {
    sourceAgentId: string;
    allowedProjectIds?: string[];
  }): Promise<AgentCopy[]>;
  abstract getSourceOfCopy(input: {
    agentId: string;
    projectId: string;
  }): Promise<Agent>;
  abstract copy(input: CopyAgentCommand): Promise<{
    id: string;
    projectId: string;
    name: string;
    copiedFromAgentId: string;
  }>;
  abstract pushToCopies(input: {
    sourceAgentId: string;
    sourceProjectId: string;
    copyIds?: string[];
  }): Promise<{ pushedTo: number; selectedCopies: number }>;
  abstract syncFromSource(input: {
    agentId: string;
    projectId: string;
  }): Promise<{ ok: true }>;
  abstract getHistory(input: {
    agentId: string;
    projectId: string;
  }): Promise<AgentHistoryEntry[]>;
}
