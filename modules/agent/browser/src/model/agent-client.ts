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
  AgentLabel,
  AgentPushToCopies,
  AgentVersions,
  AssignAgentLabelInput,
  AgentSyncFromSource,
  AgentWithFields,
  CreateAgentCommand,
  ConnectedAgentView,
  RelatedAgentEntities,
  RemoveAgentLabelInput,
  UpdateAgentCommand,
} from "@langwatch/agent-contract";
import type { WireOf } from "@langwatch/api/web";

export type AgentBrowser = WireOf<AgentWithFields>;
export type ConnectedAgentBrowser = WireOf<ConnectedAgentView>;

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

  listVersions(input: AgentHistoryInput): Promise<AgentVersions>;

  assignLabel(input: AssignAgentLabelInput): Promise<AgentLabel>;

  removeLabel(input: RemoveAgentLabelInput): Promise<void>;
}
