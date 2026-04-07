import type { PrismaClient } from "@prisma/client";
import {
  type AgentComponentConfig,
  type AgentCopyRow,
  type AgentType,
  AgentRepository,
  type CreateAgentInput,
} from "./agent.repository";
import { AgentNotFoundError } from "./errors";

/**
 * Service layer for Agent business logic.
 * Single Responsibility: Agent lifecycle management.
 *
 * Framework-agnostic - no tRPC dependencies.
 */
export class AgentService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: AgentRepository,
  ) {}

  /**
   * Static factory method for creating an AgentService with proper DI.
   */
  static create(prisma: PrismaClient): AgentService {
    const repository = new AgentRepository(prisma);
    return new AgentService(prisma, repository);
  }

  /**
   * Gets an agent by ID and projectId.
   */
  get getById() {
    return this.repository.findById.bind(this.repository);
  }

  /**
   * Gets an agent by ID only (any project). For syncFromSource source lookup.
   */
  async getByIdOnly(id: string) {
    return this.repository.findByIdOnly(id);
  }

  /**
   * Gets all agents for a project.
   */
  get getAll() {
    return this.repository.findAll.bind(this.repository);
  }

  /**
   * Creates a new agent.
   */
  get create() {
    return this.repository.create.bind(this.repository);
  }

  /**
   * Updates an existing agent.
   */
  get update() {
    return this.repository.update.bind(this.repository);
  }

  /**
   * Soft deletes an agent.
   */
  get softDelete() {
    return this.repository.softDelete.bind(this.repository);
  }

  /**
   * Lists agents with pagination. Used by REST API.
   */
  async listAgents(input: {
    projectId: string;
    page: number;
    limit: number;
  }): Promise<{
    data: Array<{
      id: string;
      name: string;
      type: string;
      config: AgentComponentConfig;
      createdAt: Date;
      updatedAt: Date;
    }>;
    pagination: { page: number; limit: number; total: number; totalPages: number };
  }> {
    const { data, total } = await this.repository.findAllPaginated(input);

    return {
      data: data.map((agent) => ({
        id: agent.id,
        name: agent.name,
        type: agent.type,
        config: agent.config,
        createdAt: agent.createdAt,
        updatedAt: agent.updatedAt,
      })),
      pagination: {
        page: input.page,
        limit: input.limit,
        total,
        totalPages: Math.ceil(total / input.limit),
      },
    };
  }

  /**
   * Gets an agent by ID or throws AgentNotFoundError. Used by REST API.
   */
  async getByIdOrThrow(input: { id: string; projectId: string }) {
    const agent = await this.repository.findById(input);
    if (!agent) {
      throw new AgentNotFoundError();
    }
    return agent;
  }

  /**
   * Soft deletes an agent or throws AgentNotFoundError. Used by REST API.
   */
  async archiveAgent(input: { id: string; projectId: string }) {
    const agent = await this.repository.findById(input);
    if (!agent) {
      throw new AgentNotFoundError();
    }
    return this.repository.softDelete(input);
  }

  /**
   * Updates an agent or throws AgentNotFoundError. Used by REST API.
   */
  async updateOrThrow(input: {
    id: string;
    projectId: string;
    data: Partial<{
      name: string;
      type: AgentType;
      config: AgentComponentConfig;
      workflowId: string | null;
    }>;
  }) {
    try {
      return await this.repository.update(input);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("not found")
      ) {
        throw new AgentNotFoundError();
      }
      throw error;
    }
  }

  /**
   * Gets all copies (replicas) of an agent for push-to-replicas UI.
   * Returns rows with project/team/org; caller is responsible for permission filtering.
   */
  async getCopies(sourceAgentId: string): Promise<AgentCopyRow[]> {
    return this.repository.findCopiesBySourceAgentId(sourceAgentId);
  }

  /**
   * Copy (replicate) an agent to another project. If the agent is workflow-type,
   * copies the workflow via the injected copyWorkflow callback.
   * Throws if source agent not found.
   */
  async copyAgent(
    input: {
      sourceAgentId: string;
      sourceProjectId: string;
      targetProjectId: string;
      newAgentId: string;
    },
    deps: {
      copyWorkflow: (opts: {
        workflow: {
          id: string;
          name: string;
          icon: string | null;
          description: string | null;
          latestVersion: { dsl: unknown } | null;
        };
        targetProjectId: string;
        sourceProjectId: string;
        copiedFromWorkflowId: string;
      }) => Promise<{ workflowId: string }>;
    },
  ): Promise<{ id: string; projectId: string; name: string; copiedFromAgentId: string }> {
    const source = await this.repository.findByIdWithWorkflow(
      input.sourceAgentId,
      input.sourceProjectId,
    );
    if (!source) {
      throw new Error("Agent not found");
    }

    let newWorkflowId: string | null = null;
    try {
      if (
        source.type === "workflow" &&
        source.workflowId &&
        source.workflow?.latestVersion?.dsl
      ) {
        const { workflowId } = await deps.copyWorkflow({
          workflow: {
            id: source.workflow.id,
            name: source.workflow.name,
            icon: source.workflow.icon,
            description: source.workflow.description,
            latestVersion: source.workflow.latestVersion,
          },
          targetProjectId: input.targetProjectId,
          sourceProjectId: input.sourceProjectId,
          copiedFromWorkflowId: source.workflowId,
        });
        newWorkflowId = workflowId;
      }

      const copied = await this.repository.create({
        id: input.newAgentId,
        projectId: input.targetProjectId,
        name: source.name,
        type: source.type as AgentType,
        config: source.config as AgentComponentConfig,
        workflowId: newWorkflowId ?? undefined,
        copiedFromAgentId: source.id,
      });

      return {
        id: copied.id,
        projectId: input.targetProjectId,
        name: copied.name,
        copiedFromAgentId: source.id,
      };
    } catch (createError) {
      if (newWorkflowId != null) {
        await this.deleteCopiedWorkflow(
          newWorkflowId,
          input.targetProjectId,
        ).catch(() => {});
      }
      throw createError;
    }
  }

  /**
   * Deletes a workflow and its versions (e.g. to clean up after a failed agent create).
   */
  private async deleteCopiedWorkflow(
    workflowId: string,
    projectId: string,
  ): Promise<void> {
    await this.prisma.workflow.update({
      where: { id: workflowId, projectId },
      data: { currentVersionId: null, latestVersionId: null },
    });
    await this.prisma.workflowVersion.updateMany({
      where: { workflowId, projectId },
      data: { parentId: null },
    });
    await this.prisma.workflowVersion.deleteMany({
      where: { workflowId, projectId },
    });
    await this.prisma.workflow.delete({
      where: { id: workflowId, projectId },
    });
  }

  /**
   * Push source agent name/config to selected copies. Caller must filter copyIds by permission.
   * When copyIds is omitted, pushes to all copies. Throws if source not found or no copies.
   */
  async pushToCopies(
    sourceAgentId: string,
    sourceProjectId: string,
    copyIds?: string[],
  ): Promise<{ pushedTo: number; selectedCopies: number }> {
    const source = await this.repository.findById({
      id: sourceAgentId,
      projectId: sourceProjectId,
    });
    if (!source) {
      throw new Error("Agent not found");
    }
    const copies =
      await this.repository.findCopiesBySourceAgentId(sourceAgentId);
    if (copies.length === 0) {
      throw new Error("This agent has no copies to push to");
    }
    const toUpdate = copyIds
      ? copies.filter((c) => copyIds.includes(c.id))
      : copies;
    if (toUpdate.length === 0) {
      throw new Error("No valid copies selected to push to");
    }
    for (const c of toUpdate) {
      await this.repository.updateNameAndConfig(c.id, c.projectId, {
        name: source.name,
        config: source.config,
      });
    }
    return {
      pushedTo: toUpdate.length,
      selectedCopies: copyIds?.length ?? copies.length,
    };
  }

  /**
   * Returns recent audit log history for a specific agent, enriched with user info.
   * Capped at the 100 most recent entries.
   */
  async getHistory(
    agentId: string,
    projectId: string,
  ): Promise<
    {
      id: string;
      action: string;
      createdAt: Date;
      args: unknown;
      user: { id: string; name: string | null; email: string | null } | null;
    }[]
  > {
    const logs = await this.prisma.auditLog.findMany({
      where: {
        projectId,
        action: { startsWith: "agents." },
        OR: [
          { args: { path: ["id"], equals: agentId } },
          { args: { path: ["agentId"], equals: agentId } },
          { args: { path: ["newAgentId"], equals: agentId } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });

    const userIds = [...new Set(logs.map((l) => l.userId))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true, email: true },
    });
    const usersById = Object.fromEntries(users.map((u) => [u.id, u]));

    return logs.map((log) => ({
      id: log.id,
      action: log.action,
      createdAt: log.createdAt,
      args: log.args,
      user: usersById[log.userId] ?? null,
    }));
  }

  /**
   * Sync a copied agent from its source (pull name/config from source).
   * Throws if agent is not a copy or source not found.
   */
  async syncFromSource(
    agentId: string,
    projectId: string,
  ): Promise<{ ok: true }> {
    const copy = await this.repository.findById({ id: agentId, projectId });
    if (!copy?.copiedFromAgentId) {
      throw new Error(
        "This agent is not a copy and has no source to sync from",
      );
    }
    const source = await this.repository.findByIdOnly(copy.copiedFromAgentId);
    if (!source) {
      throw new Error("Source agent has been deleted");
    }
    await this.repository.updateNameAndConfig(agentId, projectId, {
      name: source.name,
      config: source.config,
    });
    return { ok: true };
  }
}
