import {
  AgentNotFoundError,
  AgentRegisterOnlyError,
  InvalidAgentConfigError,
  type Agent,
  type AgentFields,
  AgentService as AgentServiceContract,
  type AgentWithFields,
  type ConnectedAgentConfig,
  type ConnectedAgentIdentity,
  createAgentCommandSchema,
  linkedWorkflowId,
  parseAgentConfig,
  updateAgentCommandSchema,
} from "@langwatch/agent-contract";
import { nanoid } from "nanoid";
import type { AgentsAuditLogPort, AgentsWorkflowPort } from "../ports/agent.port";
import type { AgentRepository } from "../repositories/agent.repository";
import { AgentCopyService } from "./agent-copy.service";
import { agentWithResolvedFields, isUniqueConstraintViolation } from "../rules/agent-view.rules";

type AgentServiceOptions = {
  repository: AgentRepository;
  workflows: AgentsWorkflowPort;
  auditLog: AgentsAuditLogPort;
  generateId?: () => string;
};

export class AgentService extends AgentServiceContract {
  static create(options: AgentServiceOptions): AgentService {
    return new AgentService(
      options.repository,
      options.workflows,
      options.auditLog,
      options.generateId,
    );
  }

  private readonly copies: AgentCopyService;

  private constructor(
    private readonly repository: AgentRepository,
    private readonly workflows: AgentsWorkflowPort,
    private readonly auditLog: AgentsAuditLogPort,
    private readonly generateId: () => string = () => `agent_${nanoid()}`,
  ) {
    super();
    this.copies = AgentCopyService.create({
      repository,
      workflows,
      generateId: this.generateId,
      getAgent: (input) => this.getAgent(input),
    });
  }

  async getById(input: { id: string; projectId: string }): Promise<AgentWithFields> {
    const agent = await this.getAgent(input);

    return this.withFields(agent, input.projectId);
  }

  async getAll(input: { projectId: string }): Promise<AgentWithFields[]> {
    const agents = await this.repository.findAll(input);
    const fields = await this.workflowFields(agents, input.projectId);

    return agents.map((agent) => agentWithResolvedFields(agent, fields));
  }

  getReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): ReturnType<AgentServiceContract["getReferenceStates"]> {
    return this.repository.findReferenceStates(input);
  }

  getNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): ReturnType<AgentServiceContract["getNamesByIds"]> {
    return this.repository.findNamesByIds(input);
  }

  exists(input: { id: string; projectId: string }): ReturnType<AgentServiceContract["exists"]> {
    return this.repository.exists(input);
  }

  async list(input: {
    projectId: string;
    page: number;
    limit: number;
  }): ReturnType<AgentServiceContract["list"]> {
    const { data, total } = await this.repository.findPage(input);

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

  async create(
    input: Parameters<AgentServiceContract["create"]>[0],
  ): ReturnType<AgentServiceContract["create"]> {
    if (input.type === "connected") {
      throw new AgentRegisterOnlyError();
    }

    const result = createAgentCommandSchema.safeParse(input);
    if (!result.success) {
      throw new InvalidAgentConfigError(input.type, result.error.issues);
    }

    const command = result.data;
    const agent = await this.repository.create({
      ...command,
      id: command.id ?? this.generateId(),
    });

    return this.withFields(agent, command.projectId);
  }

  async update(
    input: Parameters<AgentServiceContract["update"]>[0],
  ): ReturnType<AgentServiceContract["update"]> {
    await this.refuseConnectedUpdate(input);
    const commandResult = updateAgentCommandSchema.safeParse(input);
    if (!commandResult.success) {
      const existingType = input.type ?? "signature";

      throw new InvalidAgentConfigError(existingType, commandResult.error.issues);
    }

    const existing = await this.getAgent({
      id: input.id,
      projectId: input.projectId,
    });
    const type = commandResult.data.type ?? existing.type;
    let config = existing.config;
    if (commandResult.data.config !== undefined) {
      try {
        config = parseAgentConfig(type, commandResult.data.config);
      } catch (error) {
        throw new InvalidAgentConfigError(type, error);
      }
    } else if (commandResult.data.type && commandResult.data.type !== existing.type) {
      // A type-only update must not persist the old type's config under a new
      // discriminator. Keep it valid only when that config also matches the
      // requested type.
      try {
        config = parseAgentConfig(type, existing.config);
      } catch (error) {
        throw new InvalidAgentConfigError(type, error);
      }
    }

    const updated = await this.repository.update({
      ...commandResult.data,
      type,
      config,
    });

    return this.withFields(updated, input.projectId);
  }

  async archive(input: {
    id: string;
    projectId: string;
  }): ReturnType<AgentServiceContract["archive"]> {
    await this.getById(input);

    return this.repository.archive(input);
  }

  async relatedEntities(input: {
    id: string;
    projectId: string;
  }): ReturnType<AgentServiceContract["relatedEntities"]> {
    const agent = await this.getById(input);
    const workflowId = linkedWorkflowId(agent);
    if (!workflowId) {
      return { workflow: null };
    }

    const workflow = await this.workflows.related({
      projectId: input.projectId,
      workflowId,
    });

    return { workflow };
  }

  async cascadeArchive(input: {
    id: string;
    projectId: string;
  }): ReturnType<AgentServiceContract["cascadeArchive"]> {
    const agent = await this.getById(input);
    const workflowId = linkedWorkflowId(agent);
    let archivedWorkflow: { id: string } | null = null;
    if (workflowId) {
      archivedWorkflow = await this.workflows.archive({
        workflowId,
        projectId: input.projectId,
      });
    }

    return {
      agent: await this.repository.archive(input),
      archivedWorkflow,
    };
  }

  async getCopies(input: {
    sourceAgentId: string;
    allowedProjectIds?: string[];
  }): ReturnType<AgentServiceContract["getCopies"]> {
    const copies = await this.repository.findCopies(input.sourceAgentId);
    if (!input.allowedProjectIds) {
      return copies;
    }

    return copies.filter((copy) => input.allowedProjectIds?.includes(copy.projectId));
  }

  async copy(
    input: Parameters<AgentServiceContract["copy"]>[0],
  ): ReturnType<AgentServiceContract["copy"]> {
    return this.copies.copy(input);
  }

  async pushToCopies(
    input: Parameters<AgentServiceContract["pushToCopies"]>[0],
  ): ReturnType<AgentServiceContract["pushToCopies"]> {
    return this.copies.pushToCopies(input);
  }

  async getSourceOfCopy(input: {
    agentId: string;
    projectId: string;
  }): ReturnType<AgentServiceContract["getSourceOfCopy"]> {
    return this.copies.getSourceOfCopy(input);
  }

  async syncFromSource(
    input: Parameters<AgentServiceContract["syncFromSource"]>[0],
  ): ReturnType<AgentServiceContract["syncFromSource"]> {
    return this.copies.syncFromSource(input);
  }

  async getHistory(input: {
    agentId: string;
    projectId: string;
  }): ReturnType<AgentServiceContract["getHistory"]> {
    await this.getById({ id: input.agentId, projectId: input.projectId });

    return this.auditLog.history({ ...input, limit: 100 });
  }

  /**
   * Creates or re-registers a connected agent on the row its identity key names.
   */
  async registerConnected(input: {
    id: string;
    projectId: string;
    name: string;
    config: ConnectedAgentConfig;
    identity: ConnectedAgentIdentity;
  }): Promise<Agent> {
    const existing = await this.repository.tryFindByIdentityKey({
      projectId: input.projectId,
      identityKey: input.identity.identityKey,
    });
    if (existing) {
      return this.reregister(existing.id, input);
    }

    try {
      return await this.repository.create({
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        type: "connected",
        config: input.config,
        identity: input.identity,
      });
    } catch (error) {
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }

      const raced = await this.repository.tryFindByIdentityKey({
        projectId: input.projectId,
        identityKey: input.identity.identityKey,
      });
      if (!raced) {
        throw error;
      }

      return this.reregister(raced.id, input);
    }
  }

  private reregister(
    existingId: string,
    input: { projectId: string; name: string; config: ConnectedAgentConfig },
  ): Promise<Agent> {
    return this.repository.reregisterConnected({
      id: existingId,
      projectId: input.projectId,
      name: input.name,
      config: input.config,
    });
  }

  /**
   * Refuses an edit of a connected agent. Its type, name, environment and
   * parameters are what the process that runs it declared, so the only way
   * to change them is to change the code and register again.
   */
  private async refuseConnectedUpdate(input: {
    id: string;
    projectId: string;
    type?: string;
  }): Promise<void> {
    if (input.type === "connected") {
      throw new AgentRegisterOnlyError();
    }

    // Archived rows included: an archived connected agent is still the
    // SDK's to change, and it comes back on the next register.
    const existing = await this.repository.tryFindByIdIncludingArchived({
      id: input.id,
      projectId: input.projectId,
    });
    if (existing?.type === "connected") {
      throw new AgentRegisterOnlyError();
    }
  }

  ownersOf(
    agents: readonly { ownerUserId: string | null }[],
  ): ReturnType<AgentServiceContract["ownersOf"]> {
    return this.doOwnersOf(agents);
  }

  private async doOwnersOf(
    agents: readonly { ownerUserId: string | null }[],
  ): Promise<Map<string, { userId: string; name: string | null }>> {
    const userIds = [
      ...new Set(agents.map((agent) => agent.ownerUserId).filter((id): id is string => !!id)),
    ];
    const names = await this.repository.findUserNamesByIds(userIds);

    return new Map(userIds.map((userId) => [userId, { userId, name: names.get(userId) ?? null }]));
  }

  getConnectedByNameAndEnvironment(input: {
    projectId: string;
    name: string;
    environment: string;
  }): ReturnType<AgentServiceContract["getConnectedByNameAndEnvironment"]> {
    return this.repository.findConnectedByNameAndEnvironment(input);
  }

  getConnectedByName(input: {
    projectId: string;
    name: string;
  }): ReturnType<AgentServiceContract["getConnectedByName"]> {
    return this.repository.findConnectedByName(input);
  }

  private async getAgent(input: { id: string; projectId: string }): Promise<Agent> {
    const agent = await this.repository.tryFindById(input);
    if (!agent) {
      throw new AgentNotFoundError(input.id, input.projectId);
    }

    return agent;
  }

  private async withFields(agent: Agent, projectId: string): Promise<AgentWithFields> {
    const fields = await this.workflowFields([agent], projectId);

    return agentWithResolvedFields(agent, fields);
  }

  private async workflowFields(
    agents: Agent[],
    projectId: string,
  ): Promise<Record<string, AgentFields>> {
    const workflowIds: string[] = [];
    for (const agent of agents) {
      if (agent.type !== "workflow") {
        continue;
      }

      const workflowId = linkedWorkflowId(agent);
      if (workflowId) {
        workflowIds.push(workflowId);
      }
    }

    if (workflowIds.length === 0) {
      return {};
    }

    return this.workflows.fields({ projectId, workflowIds });
  }
}
