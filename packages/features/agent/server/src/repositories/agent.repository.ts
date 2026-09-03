import type {
  Agent,
  AgentConfig,
  AgentName,
  AgentReferenceState,
  AgentType,
  ConnectedAgentIdentity,
  UpdateAgentCommand,
} from "@langwatch/agent-contract";

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
  /** The identity of a connected agent (ADR-128); unset for every other type. */
  identity?: ConnectedAgentIdentity;
};

export abstract class AgentRepository {
  abstract tryFindById(input: { id: string; projectId: string }): Promise<Agent | null>;
  abstract tryFindByIdOnly(id: string): Promise<Agent | null>;
  abstract tryFindByIdIncludingArchived(input: {
    id: string;
    projectId: string;
  }): Promise<Agent | null>;
  abstract findAll(input: { projectId: string }): Promise<Agent[]>;
  abstract findReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<AgentReferenceState[]>;
  abstract findNamesByIds(input: { ids: string[]; projectId: string }): Promise<AgentName[]>;
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
  /**
   * Finds a connected agent by its identity key, whatever its state, so a
   * process that registers the same identity writes the row it already has.
   */
  abstract findByIdentityKey(input: {
    projectId: string;
    identityKey: string;
  }): Promise<Agent | null>;
  /**
   * Finds connected agents by name and environment, archived ones and ones
   * unseen for too long excluded. Several rows can answer: one per scope in
   * a development environment.
   */
  abstract findConnectedByNameAndEnvironment(input: {
    projectId: string;
    name: string;
    environment: string;
  }): Promise<Agent[]>;
  /**
   * Re-registers a connected agent on its existing row: the name and config
   * the SDK sent now, and the presence projection fresh.
   */
  abstract reregisterConnected(input: {
    id: string;
    projectId: string;
    name: string;
    config: AgentConfig;
  }): Promise<Agent>;
  /** Writes the presence projection of one agent. */
  abstract touchLastSeenAt(input: { id: string; projectId: string; at: Date }): Promise<void>;
  /** The display names of a set of users, for a connected agent's owner. */
  abstract findUserNamesByIds(ids: readonly string[]): Promise<Map<string, string | null>>;
}
