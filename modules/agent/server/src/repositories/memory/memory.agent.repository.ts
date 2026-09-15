import {
  AgentAlreadyExistsError,
  type AgentWorkflowInput,
  type UpdateAgentWorkflowConfigInput,
  AgentNotFoundError,
  AgentSourceNotFoundError,
  agentSchema,
  isConnectedAgentStale,
  type Agent,
  type AgentIdsInput,
  type AgentProjectInput,
  type ConnectedAgentsEnvironmentInput,
  type ConnectedAgentsInput,
  type GetAgentInput,
  type ListAgentsInput,
} from "@langwatch/agent-contract";
import { nowInstant, toDate } from "@langwatch/time";
import type {
  AgentPresenceInput,
  AgentRepository,
  PersistAgentInput,
  RegisterPersistedAgentInput,
  UpdateAgentCopyInput,
  UpdatePersistedAgentInput,
} from "../agent.repository.ts";

export class MemoryAgentRepository implements AgentRepository {
  #agents = new Map<string, Agent>();

  private constructor() {}

  static create(): MemoryAgentRepository {
    return new MemoryAgentRepository();
  }

  async getById(input: GetAgentInput): Promise<Agent> {
    const agent = this.#get(input);

    if (agent.archivedAt !== null) {
      throw new AgentNotFoundError(input.id, input.projectId);
    }

    return structuredClone(agent);
  }

  async getByIdOnly(id: string): Promise<Agent> {
    const agent = this.#agents.get(id);

    if (!agent || agent.archivedAt !== null) {
      throw new AgentSourceNotFoundError(id);
    }

    return structuredClone(agent);
  }

  async getByIdIncludingArchived(input: GetAgentInput): Promise<Agent> {
    return structuredClone(this.#get(input));
  }

  async findAll(input: AgentProjectInput): Promise<Agent[]> {
    return this.#visible(input.projectId).map((agent) => ({
      ...structuredClone(agent),
      copyCount: [...this.#agents.values()].filter((copy) => copy.copiedFromAgentId === agent.id)
        .length,
    }));
  }

  async findReferenceStates(input: AgentIdsInput) {
    return [...this.#agents.values()]
      .filter((agent) => agent.projectId === input.projectId && input.ids.includes(agent.id))
      .map(({ id, archivedAt, type, name, ownerUserId, lastSeenAt }) =>
        structuredClone({ id, archivedAt, type, name, ownerUserId, lastSeenAt }),
      );
  }

  async findNamesByIds(input: AgentIdsInput) {
    return [...this.#agents.values()]
      .filter((agent) => agent.projectId === input.projectId && input.ids.includes(agent.id))
      .map(({ id, name }) => ({ id, name }));
  }

  async exists(input: GetAgentInput): Promise<boolean> {
    const agent = this.#agents.get(input.id);

    return agent?.projectId === input.projectId && agent.archivedAt === null;
  }

  async findPage(input: ListAgentsInput) {
    const rows = this.#visible(input.projectId);
    const offset = (input.page - 1) * input.limit;

    return { data: structuredClone(rows.slice(offset, offset + input.limit)), total: rows.length };
  }

  async create(input: PersistAgentInput): Promise<Agent> {
    const identityExists =
      input.identity &&
      [...this.#agents.values()].some(
        (agent) =>
          agent.projectId === input.projectId && agent.identityKey === input.identity?.identityKey,
      );

    if (this.#agents.has(input.id) || identityExists) {
      throw new AgentAlreadyExistsError(input.id, input.projectId);
    }

    const now = toDate(nowInstant());
    const agent = agentSchema.parse({
      ...input,
      workflowId: input.workflowId ?? null,
      copiedFromAgentId: input.copiedFromAgentId ?? null,
      archivedAt: null,
      createdAt: now,
      updatedAt: now,
      environment: input.identity?.environment ?? null,
      ownerUserId: input.identity?.ownerUserId ?? null,
      hostLabel: input.identity?.hostLabel ?? null,
      identityKey: input.identity?.identityKey ?? null,
      lastSeenAt: input.identity ? now : null,
    });

    this.#agents.set(agent.id, structuredClone(agent));

    return structuredClone(agent);
  }

  async update(input: UpdatePersistedAgentInput): Promise<Agent> {
    const agent = this.#get(input);

    return this.#save({
      ...agent,
      name: input.name ?? agent.name,
      type: input.type,
      config: input.config,
      workflowId: input.workflowId ?? agent.workflowId,
    });
  }

  async archive(input: GetAgentInput): Promise<Agent> {
    const agent = await this.getById(input);

    return this.#save({ ...agent, archivedAt: toDate(nowInstant()) });
  }

  async listWorkflowConfigs(input: AgentWorkflowInput) {
    return [...this.#agents.values()]
      .filter(
        (agent) =>
          agent.projectId === input.projectId &&
          agent.workflowId === input.workflowId &&
          agent.archivedAt === null,
      )
      .map(({ id, config }) => ({ id, config: structuredClone({ ...config }) }));
  }

  async updateWorkflowConfig(input: UpdateAgentWorkflowConfigInput): Promise<void> {
    const agent = this.#get(input);
    if (agent.workflowId !== input.workflowId) {
      throw new AgentNotFoundError(input.id, input.projectId);
    }

    const updated = agentSchema.parse({ ...agent, config: input.config });
    Object.assign(updated.config, structuredClone(input.config));
    updated.updatedAt = toDate(nowInstant());
    this.#agents.set(agent.id, updated);
  }

  async findCopies(sourceAgentId: string) {
    return [...this.#agents.values()]
      .filter((agent) => agent.copiedFromAgentId === sourceAgentId && agent.archivedAt === null)
      .map(({ id, name, projectId }) => ({ id, name, projectId }));
  }

  async updateNameAndConfig(input: UpdateAgentCopyInput): Promise<void> {
    this.#save({ ...this.#get(input), name: input.name, config: input.config });
  }

  async findConnectedByNameAndEnvironment(
    input: ConnectedAgentsEnvironmentInput,
  ): Promise<Agent[]> {
    const agents = await this.findConnectedByName(input);

    return agents.filter((agent) => agent.environment === input.environment);
  }

  async findConnectedByName(input: ConnectedAgentsInput): Promise<Agent[]> {
    return structuredClone(
      this.#visible(input.projectId).filter(
        (agent) => agent.type === "connected" && agent.name === input.name,
      ),
    );
  }

  async registerConnected(input: RegisterPersistedAgentInput): Promise<Agent> {
    const existing = [...this.#agents.values()].find(
      (agent) =>
        agent.projectId === input.projectId && agent.identityKey === input.identity.identityKey,
    );

    if (!existing) {
      return this.create(input);
    }

    return this.#save({
      ...existing,
      name: input.name,
      config: input.config,
      archivedAt: null,
      lastSeenAt: toDate(nowInstant()),
    });
  }

  async touchLastSeenAt(input: AgentPresenceInput): Promise<void> {
    this.#save({ ...this.#get(input), lastSeenAt: toDate(input.at) });
  }

  #get(input: GetAgentInput): Agent {
    const agent = this.#agents.get(input.id);

    if (!agent || agent.projectId !== input.projectId) {
      throw new AgentNotFoundError(input.id, input.projectId);
    }

    return agent;
  }

  #visible(projectId: string): Agent[] {
    return [...this.#agents.values()]
      .filter((agent) => agent.projectId === projectId && agent.archivedAt === null)
      .filter(
        (agent) =>
          agent.type !== "connected" || !isConnectedAgentStale({ lastSeenAt: agent.lastSeenAt }),
      )
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  #save(value: unknown): Agent {
    const agent = agentSchema.parse(value);
    agent.updatedAt = toDate(nowInstant());
    this.#agents.set(agent.id, structuredClone(agent));

    return structuredClone(agent);
  }
}
