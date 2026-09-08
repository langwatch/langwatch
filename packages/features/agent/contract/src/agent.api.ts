import { featureApi } from "@langwatch/runtime-composition";
import type { Agent, AgentWithFields } from "./agent.ts";
import type { AgentReferenceState } from "./agent.queries.ts";
import type {
  ArchiveAgentCommand,
  CopyAgentCommand,
  CreateAgentCommand,
  UpdateAgentCommand,
} from "./agent.commands.ts";
import type {
  AgentCopy,
  AgentHistoryEntry,
  AgentPage,
  RelatedAgentEntities,
} from "./agent.queries.ts";
import type { AgentTestRunResult, AgentTestTurnResult } from "./agent.queries.ts";

/** Callable capability exposed by the composed Agent application. */
export interface AgentApi {
  getAll(input: { projectId: string; viewerUserId?: string | null }): Promise<AgentWithFields[]>;
  getById(input: {
    id: string;
    projectId: string;
    viewerUserId?: string | null;
  }): Promise<AgentWithFields>;
  list(input: { projectId: string; page: number; limit: number }): Promise<AgentPage>;
  create(input: CreateAgentCommand): Promise<AgentWithFields>;
  update(input: UpdateAgentCommand): Promise<AgentWithFields>;
  archive(input: ArchiveAgentCommand): Promise<Agent>;
  relatedEntities(input: { id: string; projectId: string }): Promise<RelatedAgentEntities>;
  cascadeArchive(
    input: ArchiveAgentCommand,
  ): Promise<{ agent: Agent; archivedWorkflow: { id: string } | null }>;
  getCopies(input: { sourceAgentId: string; allowedProjectIds?: string[] }): Promise<AgentCopy[]>;
  getSourceOfCopy(input: { agentId: string; projectId: string }): Promise<Agent>;
  copy(input: CopyAgentCommand): Promise<{
    id: string;
    projectId: string;
    name: string;
    copiedFromAgentId: string;
  }>;
  pushToCopies(input: {
    sourceAgentId: string;
    sourceProjectId: string;
    copyIds?: string[];
  }): Promise<{ pushedTo: number; selectedCopies: number }>;
  syncFromSource(input: { agentId: string; projectId: string }): Promise<{ ok: true }>;
  getHistory(input: { agentId: string; projectId: string }): Promise<AgentHistoryEntry[]>;
  ownersOf(
    agents: readonly { ownerUserId: string | null }[],
  ): Promise<Map<string, { userId: string; name: string | null }>>;
  getNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]>;
  getReferenceStates(input: { ids: string[]; projectId: string }): Promise<AgentReferenceState[]>;
  getConnectedByNameAndEnvironment(input: {
    projectId: string;
    name: string;
    environment: string;
  }): Promise<Agent[]>;
  getConnectedByName(input: { projectId: string; name: string }): Promise<Agent[]>;
  testTurn(input: {
    id: string;
    projectId: string;
    message: string;
    params?: Record<string, string | number | boolean>;
    actorId: string;
  }): Promise<AgentTestTurnResult>;
  testRun(input: {
    agentId: string;
    projectId: string;
    actorId: string;
  }): Promise<AgentTestRunResult>;
}

export const AgentApi = featureApi<AgentApi>("agent");
