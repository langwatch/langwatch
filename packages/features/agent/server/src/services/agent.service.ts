import {
  AgentCopiesNotFoundError,
  AgentCopySelectionError,
  AgentIsNotCopyError,
  AgentNotFoundError,
  AgentSourceNotFoundError,
  InvalidAgentConfigError,
  type Agent,
  type AgentFields,
  AgentService as AgentServiceContract,
  type AgentWithFields,
  createAgentCommandSchema,
  copyAgentCommandSchema,
  linkedWorkflowId,
  parseAgentConfig,
  updateAgentCommandSchema,
} from "@langwatch/agent-contract";
import { nanoid } from "nanoid";
import type {
  AgentsAuditLogPort,
  AgentsWorkflowPort,
} from "../ports/agent.port";
import type { AgentRepository } from "../repositories/agent.repository";

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

  private constructor(
    private readonly repository: AgentRepository,
    private readonly workflows: AgentsWorkflowPort,
    private readonly auditLog: AgentsAuditLogPort,
    private readonly generateId: () => string = () => `agent_${nanoid()}`,
  ) {
    super();
  }

  async getById(input: {
    id: string;
    projectId: string;
  }): Promise<AgentWithFields> {
    const agent = await this.getAgent(input);
    return this.withFields(agent, input.projectId);
  }

  async getAll(input: { projectId: string }): Promise<AgentWithFields[]> {
    const agents = await this.repository.findAll(input);
    const fields = await this.workflowFields(agents, input.projectId);
    return agents.map((agent) => this.withResolvedFields(agent, fields));
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

  exists(input: {
    id: string;
    projectId: string;
  }): ReturnType<AgentServiceContract["exists"]> {
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
    const commandResult = updateAgentCommandSchema.safeParse(input);
    if (!commandResult.success) {
      const existingType = input.type ?? "signature";
      throw new InvalidAgentConfigError(
        existingType,
        commandResult.error.issues,
      );
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
    if (!workflowId) return { workflow: null };
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
    if (!input.allowedProjectIds) return copies;
    return copies.filter((copy) =>
      input.allowedProjectIds?.includes(copy.projectId),
    );
  }

  async copy(
    input: Parameters<AgentServiceContract["copy"]>[0],
  ): ReturnType<AgentServiceContract["copy"]> {
    const command = copyAgentCommandSchema.parse(input);
    const source = await this.getAgent({
      id: command.sourceAgentId,
      projectId: command.sourceProjectId,
    });
    let workflowId: string | undefined;
    const sourceWorkflowId = linkedWorkflowId(source);
    if (source.type === "workflow" && sourceWorkflowId) {
      const copiedWorkflow = await this.workflows.copy({
        workflowId: sourceWorkflowId,
        sourceProjectId: command.sourceProjectId,
        targetProjectId: command.targetProjectId,
        actorUserId: command.actorUserId,
      });
      workflowId = copiedWorkflow.workflowId;
    }
    try {
      const copy = await this.repository.create({
        id: command.newAgentId ?? this.generateId(),
        projectId: command.targetProjectId,
        name: source.name,
        type: source.type,
        config: source.config,
        workflowId,
        copiedFromAgentId: source.id,
      });
      return {
        id: copy.id,
        projectId: copy.projectId,
        name: copy.name,
        copiedFromAgentId: source.id,
      };
    } catch (error) {
      if (workflowId) {
        await this.workflows
          .remove({ workflowId, projectId: command.targetProjectId })
          .catch(() => undefined);
      }
      throw error;
    }
  }

  async pushToCopies(
    input: Parameters<AgentServiceContract["pushToCopies"]>[0],
  ): ReturnType<AgentServiceContract["pushToCopies"]> {
    const source = await this.getAgent({
      id: input.sourceAgentId,
      projectId: input.sourceProjectId,
    });
    const copies = await this.repository.findCopies(input.sourceAgentId);
    if (copies.length === 0) {
      throw new AgentCopiesNotFoundError(input.sourceAgentId);
    }
    let selected = copies;
    if (input.copyIds) {
      selected = copies.filter((copy) => input.copyIds?.includes(copy.id));
    }
    if (selected.length === 0) {
      throw new AgentCopySelectionError(input.sourceAgentId);
    }
    for (const copy of selected) {
      await this.repository.updateNameAndConfig({
        id: copy.id,
        projectId: copy.projectId,
        name: source.name,
        config: source.config,
      });
    }
    return {
      pushedTo: selected.length,
      selectedCopies: input.copyIds?.length ?? copies.length,
    };
  }

  async getSourceOfCopy(input: {
    agentId: string;
    projectId: string;
  }): ReturnType<AgentServiceContract["getSourceOfCopy"]> {
    const copy = await this.getAgent({
      id: input.agentId,
      projectId: input.projectId,
    });
    if (!copy.copiedFromAgentId) {
      throw new AgentIsNotCopyError(input.agentId, input.projectId);
    }
    const source = await this.getSourceAgent(copy.copiedFromAgentId);
    return source;
  }

  async syncFromSource(
    input: Parameters<AgentServiceContract["syncFromSource"]>[0],
  ): ReturnType<AgentServiceContract["syncFromSource"]> {
    const copy = await this.getById({
      id: input.agentId,
      projectId: input.projectId,
    });
    const source = await this.getSourceOfCopy(input);
    await this.repository.updateNameAndConfig({
      id: copy.id,
      projectId: copy.projectId,
      name: source.name,
      config: source.config,
    });
    return { ok: true as const };
  }

  async getHistory(input: {
    agentId: string;
    projectId: string;
  }): ReturnType<AgentServiceContract["getHistory"]> {
    await this.getById({ id: input.agentId, projectId: input.projectId });
    return this.auditLog.history({ ...input, limit: 100 });
  }

  private async getAgent(input: {
    id: string;
    projectId: string;
  }): Promise<Agent> {
    const agent = await this.repository.tryFindById(input);
    if (!agent) throw new AgentNotFoundError(input.id, input.projectId);
    return agent;
  }

  private async getSourceAgent(id: string): Promise<Agent> {
    const source = await this.repository.tryFindByIdOnly(id);
    if (!source) throw new AgentSourceNotFoundError(id);
    return source;
  }

  private async withFields(
    agent: Agent,
    projectId: string,
  ): Promise<AgentWithFields> {
    const fields = await this.workflowFields([agent], projectId);
    return this.withResolvedFields(agent, fields);
  }

  private async workflowFields(
    agents: Agent[],
    projectId: string,
  ): Promise<Record<string, AgentFields>> {
    const workflowIds: string[] = [];
    for (const agent of agents) {
      if (agent.type !== "workflow") continue;
      const workflowId = linkedWorkflowId(agent);
      if (workflowId) workflowIds.push(workflowId);
    }
    if (workflowIds.length === 0) return {};
    return this.workflows.fields({ projectId, workflowIds });
  }

  private withResolvedFields(
    agent: Agent,
    fields: Record<string, AgentFields>,
  ): AgentWithFields {
    if (agent.type !== "workflow") {
      return {
        ...agent,
        inputFields: agent.config.inputs ?? [],
        outputFields: agent.config.outputs ?? [],
        fieldsResolved: true,
      };
    }
    const workflowId = linkedWorkflowId(agent);
    if (workflowId && fields[workflowId]) {
      return { ...agent, ...fields[workflowId] };
    }
    return {
      ...agent,
      inputFields: [],
      outputFields: [],
      fieldsResolved: false,
    };
  }
}
