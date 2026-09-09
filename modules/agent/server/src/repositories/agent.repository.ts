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
};

export type UpdatePersistedAgentInput = UpdateAgentCommand & {
  type: AgentType;
  config: AgentConfig;
};
export type UpdateAgentCopyInput = GetAgentInput & { name: string; config: AgentConfig };
export type RegisterPersistedAgentInput = PersistAgentInput & { identity: ConnectedAgentIdentity };
export type AgentPresenceInput = GetAgentInput & { at: Instant };

export interface AgentRepository {
  listWorkflowConfigs(input: AgentWorkflowInput): Promise<AgentWorkflowConfig[]>;
  updateWorkflowConfig(input: UpdateAgentWorkflowConfigInput): Promise<void>;
  getById(input: GetAgentInput): Promise<Agent>;
  getByIdOnly(id: string): Promise<Agent>;
  getByIdIncludingArchived(input: GetAgentInput): Promise<Agent>;
  findAll(input: AgentProjectInput): Promise<Agent[]>;
  findReferenceStates(input: AgentIdsInput): Promise<AgentReferenceState[]>;
  findNamesByIds(input: AgentIdsInput): Promise<AgentName[]>;
  exists(input: GetAgentInput): Promise<boolean>;
  findPage(input: ListAgentsInput): Promise<{ data: Agent[]; total: number }>;
  create(input: PersistAgentInput): Promise<Agent>;
  update(input: UpdatePersistedAgentInput): Promise<Agent>;
  archive(input: GetAgentInput): Promise<Agent>;
  findCopies(sourceAgentId: string): Promise<AgentCopyRecord[]>;
  updateNameAndConfig(input: UpdateAgentCopyInput): Promise<void>;
  findConnectedByNameAndEnvironment(input: ConnectedAgentsEnvironmentInput): Promise<Agent[]>;
  findConnectedByName(input: ConnectedAgentsInput): Promise<Agent[]>;
  registerConnected(input: RegisterPersistedAgentInput): Promise<Agent>;
  touchLastSeenAt(input: AgentPresenceInput): Promise<void>;
}
