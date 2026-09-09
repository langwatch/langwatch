import type { AgentCallSignal } from "./connected-agent.connection.ts";
import { moduleApi } from "@langwatch/runtime-composition";
import type { Instant } from "@langwatch/time";
import type { AgentPresence } from "./connected-agent.view.ts";
import type { AgentCallInput, AgentCallContext, AgentCallResult } from "./connected-agent.call.ts";
import type {
  AgentConnection,
  AgentConnectCredentials,
  AgentConnectFramesInput,
  AgentConnectPollInput,
  AgentConnectPollAnswer,
  AgentConnectRegisterAnswer,
} from "./connected-agent.connection.ts";
import type { CallOutcome, DispatchAgent, DispatchCall } from "./connected-agent.dispatch.ts";
import type { RegisterConnectedAgentInput } from "./agent.commands.ts";
import type { HttpAgentTestInput } from "./agent.commands.ts";
import type { HttpProxyResult } from "./agent.queries.ts";
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
  AgentOverview,
  AgentOverviewPage,
  RelatedAgentEntities,
} from "./agent.queries.ts";
import type { AgentTestRunResult, AgentTestTurnResult } from "./agent.queries.ts";

/** Callable capability exposed by the composed Agent application. */
export interface AgentApi {
  listWorkflowConfigs(input: AgentWorkflowInput): Promise<AgentWorkflowConfig[]>;
  updateWorkflowConfig(input: UpdateAgentWorkflowConfigInput): Promise<void>;
  getPresence(input: {
    projectId: string;
    agents: readonly { id: string; type: string }[];
  }): Promise<Map<string, AgentPresence>>;
  call(input: AgentCallInput, context: AgentCallContext): Promise<AgentCallResult>;
  acceptConnection(
    connection: AgentConnection,
    credentials: AgentConnectCredentials,
  ): Promise<void>;
  connectRegister(
    body: unknown,
    credentials: AgentConnectCredentials,
  ): Promise<AgentConnectRegisterAnswer>;
  connectPoll(
    input: AgentConnectPollInput,
    credentials: AgentConnectCredentials,
  ): Promise<AgentConnectPollAnswer>;
  connectFrames(
    input: AgentConnectFramesInput,
    credentials: AgentConnectCredentials,
  ): Promise<{ accepted: number }>;
  callConnected(input: {
    projectId: string;
    agent: DispatchAgent;
    call: DispatchCall;
    signal?: AgentCallSignal;
  }): Promise<CallOutcome>;
  exists(input: { id: string; projectId: string }): Promise<boolean>;
  registerConnected(input: RegisterConnectedAgentInput): Promise<Agent>;
  touchLastSeenAt(input: { id: string; projectId: string; at: Instant }): Promise<void>;
  executeHttpTest(input: HttpAgentTestInput & { actorId: string }): Promise<HttpProxyResult>;
  listWithPresence(input: {
    projectId: string;
    page: number;
    limit: number;
    viewerUserId?: string | null;
  }): Promise<AgentOverviewPage>;
  getCopiesForActor(input: {
    agentId: string;
    projectId: string;
    actorId: string;
  }): Promise<AgentCopy[]>;
  copyForActor(
    input: CopyAgentCommand & { actorId: string },
  ): Promise<import("./agent.queries.ts").AgentCopyCreated>;
  pushToCopiesForActor(input: {
    agentId: string;
    projectId: string;
    copyIds?: string[];
    actorId: string;
  }): Promise<import("./agent.queries.ts").AgentPushToCopies>;
  syncFromSourceForActor(input: {
    agentId: string;
    projectId: string;
    actorId: string;
  }): Promise<{ ok: true }>;
  getAll(input: { projectId: string; viewerUserId?: string | null }): Promise<AgentOverview[]>;
  getById(input: {
    id: string;
    projectId: string;
    viewerUserId?: string | null;
  }): Promise<AgentOverview>;
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
  /** The platform's own deep link to this agent's editor drawer. */
  platformUrl(input: { projectSlug: string; agentId: string; agentType: string }): string;
}

export const AgentApi = moduleApi<AgentApi>("agent");

export type AgentWorkflowInput = { projectId: string; workflowId: string };
export type AgentWorkflowConfig = { id: string; config: Record<string, unknown> };
export type UpdateAgentWorkflowConfigInput = AgentWorkflowInput & AgentWorkflowConfig;
