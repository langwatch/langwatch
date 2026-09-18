import {
  AgentRegisterOnlyError,
  type AgentWorkflowInput,
  type AgentWorkflowConfig,
  type UpdateAgentWorkflowConfigInput,
  InvalidAgentConfigError,
  createAgentCommandSchema,
  agentConfigSchema,
  updateAgentCommandSchema,
  type GetAgentInput,
  type AgentProjectInput,
  type AgentIdsInput,
  type ListAgentsInput,
  type CreateAgentCommand,
  type UpdateAgentCommand,
  type ConnectedAgentsInput,
  type ConnectedAgentsEnvironmentInput,
  type RegisterConnectedAgentInput,
  type Agent,
  type AgentReferenceState,
  type AgentName,
  type AgentPage,
} from "@langwatch/agent-contract";
import type { AgentRepository, AgentPresenceInput } from "../repositories/agent.repository.ts";
import { nextAgentId } from "../rules/agent-id.rules.ts";

export class AgentService {
  #repository: AgentRepository;

  private constructor(repository: AgentRepository) {
    this.#repository = repository;
  }

  static create(repository: AgentRepository): AgentService {
    return new AgentService(repository);
  }

  getById(input: GetAgentInput): Promise<Agent> {
    return this.#repository.getById(input);
  }

  listWorkflowConfigs(input: AgentWorkflowInput): Promise<AgentWorkflowConfig[]> {
    return this.#repository.listWorkflowConfigs(input);
  }

  updateWorkflowConfig(input: UpdateAgentWorkflowConfigInput): Promise<void> {
    return this.#repository.updateWorkflowConfig(input);
  }

  getAll(input: AgentProjectInput): Promise<Agent[]> {
    return this.#repository.findAll(input);
  }

  getReferenceStates(input: AgentIdsInput): Promise<AgentReferenceState[]> {
    return this.#repository.findReferenceStates(input);
  }

  getNamesByIds(input: AgentIdsInput): Promise<AgentName[]> {
    return this.#repository.findNamesByIds(input);
  }

  exists(input: GetAgentInput): Promise<boolean> {
    return this.#repository.exists(input);
  }

  async list(input: ListAgentsInput): Promise<AgentPage> {
    const { data, total } = await this.#repository.findPage(input);

    return {
      data,
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  create(input: CreateAgentCommand): Promise<Agent> {
    if (input.type === "connected") throw new AgentRegisterOnlyError();

    const result = createAgentCommandSchema.safeParse(input);
    if (!result.success) throw new InvalidAgentConfigError(input.type, result.error.issues);

    const command = result.data;
    return this.#repository.create({ ...command, id: command.id ?? nextAgentId() });
  }

  async update(input: UpdateAgentCommand): Promise<Agent> {
    if (input.type === "connected") throw new AgentRegisterOnlyError();

    const existing = await this.#repository.getByIdIncludingArchived({
      id: input.id,
      projectId: input.projectId,
    });
    if (existing.type === "connected") throw new AgentRegisterOnlyError();

    const parsed = updateAgentCommandSchema.safeParse(input);
    if (!parsed.success)
      throw new InvalidAgentConfigError(input.type ?? "signature", parsed.error.issues);

    await this.#repository.getById({ id: input.id, projectId: input.projectId });
    const type = parsed.data.type ?? existing.type;
    const checked = agentConfigSchema.safeParse({
      type,
      config: parsed.data.config ?? existing.config,
    });
    if (!checked.success) throw new InvalidAgentConfigError(type, checked.error.issues);
    const config = checked.data.config;

    return this.#repository.update({ ...parsed.data, type, config });
  }

  archive(input: GetAgentInput): Promise<Agent> {
    return this.#repository.archive(input);
  }

  registerConnected(input: RegisterConnectedAgentInput): Promise<Agent> {
    return this.#repository.registerConnected({ ...input, type: "connected" });
  }

  getConnectedByNameAndEnvironment(input: ConnectedAgentsEnvironmentInput): Promise<Agent[]> {
    return this.#repository.findConnectedByNameAndEnvironment(input);
  }

  getConnectedByName(input: ConnectedAgentsInput): Promise<Agent[]> {
    return this.#repository.findConnectedByName(input);
  }

  touchLastSeenAt(input: AgentPresenceInput): Promise<void> {
    return this.#repository.touchLastSeenAt(input);
  }
}
