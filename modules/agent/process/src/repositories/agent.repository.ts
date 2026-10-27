import type {
  Agent,
  AgentWorkflowInput,
  AgentWorkflowConfig,
  UpdateAgentWorkflowConfigInput,
  AgentConfig,
  AgentName,
  AgentReferenceState,
  AgentType,
  ConnectedAgentIdentity,
  GetAgentInput,
  AgentProjectInput,
  AgentIdsInput,
  ListAgentsInput,
  ConnectedAgentsInput,
  ConnectedAgentsEnvironmentInput,
  UpdateAgentCommand,
  AgentVersionAuthorKind,
  AgentWriteAuthor,
} from "@langwatch/agent-contract";
import type { Instant } from "@langwatch/time";

export type AgentCopyRecord = { id: string; name: string; projectId: string };

export type PersistAgentInput = {
  id: string;
  projectId: string;
  name: string;
  type: AgentType;
  config: AgentConfig;
  workflowId?: string;
  copiedFromAgentId?: string;
  identity?: ConnectedAgentIdentity;
  /** A voice row's dedupe key; a connected row carries its key inside `identity`. */
  identityKey?: string;
  /** Who wrote it; the row's creator and its version 1 author. Connected rows record none. */
  author?: AgentWriteAuthor;
  commitMessage?: string;
};

export type UpdatePersistedAgentInput = UpdateAgentCommand & {
  type: AgentType;
  config: AgentConfig;
  author?: AgentWriteAuthor;
};
export type UpdateAgentCopyInput = GetAgentInput & {
  name: string;
  config: AgentConfig;
  author?: AgentWriteAuthor;
  commitMessage?: string;
};

/** One stored version; the agent row is always the newest. */
export type AgentVersionRecord = {
  id: string;
  agentId: string;
  projectId: string;
  version: number;
  name: string;
  type: AgentType;
  config: Record<string, unknown>;
  workflowId: string | null;
  commitMessage: string | null;
  authorId: string | null;
  authorKind: AgentVersionAuthorKind | null;
  createdAt: Instant;
};

export type AgentLabelRecord = {
  agentId: string;
  label: string;
  versionId: string;
  version: number;
  updatedAt: Instant;
  updatedById: string | null;
};

export type AgentVersionLookup = {
  projectId: string;
  agentId: string;
  version?: number;
  versionId?: string;
};
export type RegisterPersistedAgentInput = PersistAgentInput & { identity: ConnectedAgentIdentity };
export type AgentPresenceInput = GetAgentInput & { at: Instant };

export interface AgentRepository {
  findWorkflowConfigs(input: AgentWorkflowInput): Promise<AgentWorkflowConfig[]>;
  updateWorkflowConfig(input: UpdateAgentWorkflowConfigInput): Promise<void>;
  getById(input: GetAgentInput): Promise<Agent>;
  getByIdOnly(id: string): Promise<Agent>;
  getByIdIncludingArchived(input: GetAgentInput): Promise<Agent>;
  findAll(input: AgentProjectInput): Promise<Agent[]>;
  /** Every project holding a live HTTP agent, for the task that walks them all. */
  findProjectIdsWithHttpAgents(): Promise<string[]>;
  findReferenceStates(input: AgentIdsInput): Promise<AgentReferenceState[]>;
  findNamesByIds(input: AgentIdsInput): Promise<AgentName[]>;
  exists(input: GetAgentInput): Promise<boolean>;
  listPage(input: ListAgentsInput): Promise<{ data: Agent[]; total: number }>;
  create(input: PersistAgentInput): Promise<Agent>;
  update(input: UpdatePersistedAgentInput): Promise<Agent>;
  /** Writes the config only if the row is unchanged since `updatedAt`; false when it moved on. */
  updateConfigIfUnchanged(
    input: GetAgentInput & { config: AgentConfig; updatedAt: Instant },
  ): Promise<boolean>;
  archive(input: GetAgentInput): Promise<Agent>;
  findCopies(sourceAgentId: string): Promise<AgentCopyRecord[]>;
  updateNameAndConfig(input: UpdateAgentCopyInput): Promise<void>;
  findConnectedByNameAndEnvironment(input: ConnectedAgentsEnvironmentInput): Promise<Agent[]>;
  findConnectedByName(input: ConnectedAgentsInput): Promise<Agent[]>;
  findConnectedInProjects(input: { projectIds: string[] }): Promise<Agent[]>;
  registerConnected(input: RegisterPersistedAgentInput): Promise<Agent>;
  findByIdentityKey(input: { projectId: string; identityKey: string }): Promise<Agent[]>;
  touchLastSeenAt(input: AgentPresenceInput): Promise<void>;

  /** Newest first. */
  findVersions(input: { projectId: string; agentId: string }): Promise<AgentVersionRecord[]>;
  findVersion(input: AgentVersionLookup): Promise<AgentVersionRecord | undefined>;
  /** The newest version number of each agent that has any. */
  latestVersionNumbers(input: AgentIdsInput): Promise<Map<string, number>>;
  findLabels(input: AgentIdsInput): Promise<AgentLabelRecord[]>;
  /** Creates or moves the label; the version must belong to the agent. */
  assignLabel(input: {
    projectId: string;
    agentId: string;
    label: string;
    versionId: string;
    actorId: string | null;
  }): Promise<AgentLabelRecord>;
  /** True when a label was removed. */
  removeLabel(input: { projectId: string; agentId: string; label: string }): Promise<boolean>;
  /** Agents in every project that hold no version yet, by id, for the backfill. */
  findUnversioned(input: { afterId: string | null; limit: number }): Promise<Agent[]>;
  /** Writes version 1 from the row and its creator when unset; false when one already existed. */
  backfillFirstVersion(input: { agent: Agent; createdById: string | null }): Promise<boolean>;
}
