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
  type AgentWorkflowConfig,
  type AgentName,
  type AgentReferenceState,
  type AgentWriteAuthor,
  AgentVersionNotFoundError,
} from "@langwatch/agent-contract";
import { generate } from "@langwatch/ksuid";
import { fromDate, nowInstant, toDate } from "@langwatch/time";

import type {
  AgentPresenceInput,
  AgentRepository,
  PersistAgentInput,
  RegisterPersistedAgentInput,
  UpdateAgentCopyInput,
  UpdatePersistedAgentInput,
  AgentCopyRecord,
  AgentLabelRecord,
  AgentVersionLookup,
  AgentVersionRecord,
} from "../agent.repository.ts";

export class MemoryAgentRepository implements AgentRepository {
  #agents = new Map<string, Agent>();
  #versions: AgentVersionRecord[] = [];
  #labels: (Omit<AgentLabelRecord, "version"> & { projectId: string })[] = [];

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

  async findProjectIdsWithHttpAgents(): Promise<string[]> {
    const live = [...this.#agents.values()].filter(
      (agent) => agent.type === "http" && agent.archivedAt === null,
    );

    return [...new Set(live.map((agent) => agent.projectId))];
  }

  async findAll(input: AgentProjectInput): Promise<Agent[]> {
    return this.#visible(input.projectId).map((agent) => ({
      ...structuredClone(agent),
      copyCount: [...this.#agents.values()].filter((copy) => copy.copiedFromAgentId === agent.id)
        .length,
    }));
  }

  async findReferenceStates(input: AgentIdsInput): Promise<AgentReferenceState[]> {
    return [...this.#agents.values()]
      .filter((agent) => agent.projectId === input.projectId && input.ids.includes(agent.id))
      .map(({ id, archivedAt, type, name, ownerUserId, lastSeenAt }) =>
        structuredClone({ id, archivedAt, type, name, ownerUserId, lastSeenAt }),
      );
  }

  async findNamesByIds(input: AgentIdsInput): Promise<AgentName[]> {
    return [...this.#agents.values()]
      .filter((agent) => agent.projectId === input.projectId && input.ids.includes(agent.id))
      .map(({ id, name }) => ({ id, name }));
  }

  async exists(input: GetAgentInput): Promise<boolean> {
    const agent = this.#agents.get(input.id);

    return agent?.projectId === input.projectId && agent.archivedAt === null;
  }

  async listPage(input: ListAgentsInput): Promise<{ data: Agent[]; total: number }> {
    const rows = this.#visible(input.projectId);
    const offset = (input.page - 1) * input.limit;

    return { data: structuredClone(rows.slice(offset, offset + input.limit)), total: rows.length };
  }

  async create(input: PersistAgentInput): Promise<Agent> {
    const identityKey = input.identity?.identityKey ?? input.identityKey;
    const identityExists =
      identityKey !== undefined &&
      [...this.#agents.values()].some(
        (agent) => agent.projectId === input.projectId && agent.identityKey === identityKey,
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
      identityKey: identityKey ?? null,
      lastSeenAt: input.identity ? now : null,
      createdById: input.author?.authorId ?? null,
      updatedById: input.author?.authorId ?? null,
    });

    this.#agents.set(agent.id, structuredClone(agent));
    this.#appendVersion({ agent, author: input.author, commitMessage: input.commitMessage });

    return structuredClone(agent);
  }

  async update(input: UpdatePersistedAgentInput): Promise<Agent> {
    const agent = this.#get(input);

    const saved = this.#save({
      ...agent,
      name: input.name ?? agent.name,
      type: input.type,
      config: input.config,
      workflowId: input.workflowId ?? agent.workflowId,
      ...(input.author ? { updatedById: input.author.authorId } : {}),
    });
    this.#appendVersion({ agent: saved, author: input.author, commitMessage: input.commitMessage });
    return saved;
  }

  updateConfigIfUnchanged(
    input: Parameters<AgentRepository["updateConfigIfUnchanged"]>[0],
  ): Promise<boolean> {
    const agent = this.#agents.get(input.id);
    if (
      !agent ||
      agent.projectId !== input.projectId ||
      agent.updatedAt.getTime() !== input.updatedAt.epochMilliseconds
    ) {
      return Promise.resolve(false);
    }
    this.#save({ ...agent, config: input.config });

    return Promise.resolve(true);
  }

  async archive(input: GetAgentInput): Promise<Agent> {
    const agent = await this.getById(input);

    return this.#save({ ...agent, archivedAt: toDate(nowInstant()) });
  }

  async findWorkflowConfigs(input: AgentWorkflowInput): Promise<AgentWorkflowConfig[]> {
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

  async findCopies(sourceAgentId: string): Promise<AgentCopyRecord[]> {
    return [...this.#agents.values()]
      .filter((agent) => agent.copiedFromAgentId === sourceAgentId && agent.archivedAt === null)
      .map(({ id, name, projectId }) => ({ id, name, projectId }));
  }

  async updateNameAndConfig(input: UpdateAgentCopyInput): Promise<void> {
    const saved = this.#save({
      ...this.#get(input),
      name: input.name,
      config: input.config,
      ...(input.author ? { updatedById: input.author.authorId } : {}),
    });
    this.#appendVersion({ agent: saved, author: input.author, commitMessage: input.commitMessage });
  }

  async findVersions(input: { projectId: string; agentId: string }): Promise<AgentVersionRecord[]> {
    // Instants are immutable and lose their prototype in structuredClone, so only config is copied.
    return this.#versions
      .filter((row) => row.projectId === input.projectId && row.agentId === input.agentId)
      .toSorted((left, right) => right.version - left.version)
      .map((row) => ({ ...row, config: structuredClone(row.config) }));
  }

  async findVersion(input: AgentVersionLookup): Promise<AgentVersionRecord | undefined> {
    const [found] = (await this.findVersions(input)).filter(
      (row) =>
        (input.version === void 0 || row.version === input.version) &&
        (input.versionId === void 0 || row.id === input.versionId),
    );
    return found;
  }

  async latestVersionNumbers(input: AgentIdsInput): Promise<Map<string, number>> {
    const numbers = new Map<string, number>();
    for (const row of this.#versions) {
      if (row.projectId !== input.projectId || !input.ids.includes(row.agentId)) continue;
      numbers.set(row.agentId, Math.max(numbers.get(row.agentId) ?? 0, row.version));
    }
    return numbers;
  }

  async findLabels(input: AgentIdsInput): Promise<AgentLabelRecord[]> {
    return this.#labels
      .filter((row) => row.projectId === input.projectId && input.ids.includes(row.agentId))
      .flatMap(({ projectId: _projectId, ...row }) => {
        const version = this.#versions.find((candidate) => candidate.id === row.versionId);
        return version ? [{ ...row, version: version.version }] : [];
      })
      .toSorted((left, right) => left.label.localeCompare(right.label));
  }

  async assignLabel(input: {
    projectId: string;
    agentId: string;
    label: string;
    versionId: string;
    actorId: string | null;
  }): Promise<AgentLabelRecord> {
    const version = await this.findVersion({
      projectId: input.projectId,
      agentId: input.agentId,
      versionId: input.versionId,
    });
    if (!version) throw new AgentVersionNotFoundError({ agentId: input.agentId });
    const row = {
      projectId: input.projectId,
      agentId: input.agentId,
      label: input.label,
      versionId: version.id,
      updatedAt: nowInstant(),
      updatedById: input.actorId,
    };
    this.#labels = [
      ...this.#labels.filter(
        (candidate) => !(candidate.agentId === input.agentId && candidate.label === input.label),
      ),
      row,
    ];
    const { projectId: _projectId, ...label } = row;
    return { ...label, version: version.version };
  }

  async removeLabel(input: {
    projectId: string;
    agentId: string;
    label: string;
  }): Promise<boolean> {
    const before = this.#labels.length;
    this.#labels = this.#labels.filter(
      (row) =>
        !(
          row.projectId === input.projectId &&
          row.agentId === input.agentId &&
          row.label === input.label
        ),
    );
    return this.#labels.length < before;
  }

  async findUnversioned(input: { afterId: string | null; limit: number }): Promise<Agent[]> {
    return structuredClone(
      [...this.#agents.values()]
        .filter((agent) => agent.type !== "connected")
        .filter((agent) => input.afterId === null || agent.id > input.afterId)
        .toSorted((left, right) => left.id.localeCompare(right.id))
        .slice(0, input.limit),
    );
  }

  async backfillFirstVersion(input: {
    agent: Agent;
    createdById: string | null;
  }): Promise<boolean> {
    const { agent } = input;
    if (this.#versions.some((row) => row.agentId === agent.id)) return false;
    this.#versions.push({
      id: generate("agentversion").toString(),
      agentId: agent.id,
      projectId: agent.projectId,
      version: 1,
      name: agent.name,
      type: agent.type,
      config: structuredClone({ ...agent.config }),
      workflowId: agent.workflowId,
      commitMessage: null,
      authorId: input.createdById,
      authorKind: input.createdById ? "user" : "system",
      createdAt: fromDate(agent.createdAt),
    });
    const stored = this.#agents.get(agent.id);
    if (stored && input.createdById && !stored.createdById) {
      this.#agents.set(agent.id, { ...stored, createdById: input.createdById });
    }
    return true;
  }

  /** Test seam: a row as an older release wrote it, with no versions and no creator. */
  seedUnversioned(agent: Agent): void {
    this.#agents.set(agent.id, structuredClone(agent));
  }

  #appendVersion(input: {
    agent: Agent;
    author: AgentWriteAuthor | undefined;
    commitMessage: string | undefined;
  }): void {
    const { agent } = input;
    if (agent.type === "connected") return;
    const latest = this.#versions
      .filter((row) => row.agentId === agent.id)
      .reduce((max, row) => Math.max(max, row.version), 0);
    this.#versions.push({
      id: generate("agentversion").toString(),
      agentId: agent.id,
      projectId: agent.projectId,
      version: latest + 1,
      name: agent.name,
      type: agent.type,
      config: structuredClone({ ...agent.config }),
      workflowId: agent.workflowId,
      commitMessage: input.commitMessage ?? null,
      authorId: input.author?.authorId ?? null,
      authorKind: input.author?.authorKind ?? "system",
      createdAt: nowInstant(),
    });
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

  async findByIdentityKey(input: { projectId: string; identityKey: string }): Promise<Agent[]> {
    return structuredClone(
      [...this.#agents.values()].filter(
        (agent) => agent.projectId === input.projectId && agent.identityKey === input.identityKey,
      ),
    );
  }

  async findConnectedInProjects(input: { projectIds: string[] }): Promise<Agent[]> {
    return structuredClone(
      input.projectIds
        .flatMap((projectId) => this.#visible(projectId))
        .filter((agent) => agent.type === "connected")
        .toSorted((left, right) => right.createdAt.getTime() - left.createdAt.getTime()),
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
      .toSorted((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime());
  }

  #save(value: unknown): Agent {
    const agent = agentSchema.parse(value);
    agent.updatedAt = toDate(nowInstant());
    this.#agents.set(agent.id, structuredClone(agent));

    return structuredClone(agent);
  }
}
