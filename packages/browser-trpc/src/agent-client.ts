/**
 * The browser's agent client: the operations a screen may ask of an agent, the
 * typed tRPC hooks that answer them, and the one predicate a picker asks of a
 * row before it offers it.
 */

import type {
  Agent,
  AgentApiAgentInput,
  AgentApiAgentReferenceInput,
  AgentApiCopyRequest,
  AgentApiPushToCopiesInput,
  AgentCascadeArchive,
  AgentCopy,
  AgentCopyCreated,
  AgentHistoryEntry,
  AgentPushToCopies,
  AgentSyncFromSource,
  AgentWithFields,
  CreateAgentCommand,
  RelatedAgentEntities,
  UpdateAgentCommand,
  agentTrpc,
} from "@langwatch/agent-contract";
import {
  createModuleApi,
  type ContractApiMap,
  type ModuleApi,
  type WireOf,
} from "@langwatch/api/web";

export type AgentBrowser = WireOf<AgentWithFields>;

export type AgentCopyInput = AgentApiCopyRequest;
export type AgentCopyResult = AgentCopyCreated;
export type AgentCopiesInput = AgentApiAgentReferenceInput;
export type AgentPushToCopiesInput = AgentApiPushToCopiesInput;
export type AgentSyncFromSourceInput = AgentApiAgentReferenceInput;
export type AgentHistoryInput = AgentApiAgentReferenceInput;

/** Browser-facing agent operations, independent of an RPC client library. */
export interface AgentClient {
  getById(input: AgentApiAgentInput): Promise<AgentWithFields>;

  create(input: CreateAgentCommand): Promise<AgentWithFields>;

  update(input: UpdateAgentCommand): Promise<AgentWithFields>;

  relatedEntities(input: AgentApiAgentInput): Promise<RelatedAgentEntities>;

  cascadeArchive(input: AgentApiAgentInput): Promise<AgentCascadeArchive>;

  archive(input: AgentApiAgentInput): Promise<Agent>;

  getCopies(input: AgentCopiesInput): Promise<AgentCopy[]>;

  copy(input: AgentCopyInput): Promise<AgentCopyResult>;

  pushToCopies(input: AgentPushToCopiesInput): Promise<AgentPushToCopies>;

  syncFromSource(input: AgentSyncFromSourceInput): Promise<AgentSyncFromSource>;

  getHistory(input: AgentHistoryInput): Promise<AgentHistoryEntry[]>;
}

export function agentHasDevTunnel(agent: { type: string; config?: unknown }): boolean {
  if (agent.type !== "http") return false;
  const config = agent.config;
  return Boolean(
    config &&
    typeof config === "object" &&
    "devTunnel" in config &&
    (config as { devTunnel?: unknown }).devTunnel,
  );
}

export type AgentApiMap = ContractApiMap<typeof agentTrpc>;

export const agentApi: ModuleApi<AgentApiMap> = createModuleApi<AgentApiMap>();
