import type { PrismaClient } from "@prisma/client";
import {
  type AgentComponentConfig,
  type AgentCopyRow,
  type AgentType,
  AgentRepository,
  type CreateAgentInput,
} from "./agent.repository";

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
  ): Promise<{ id: string; name: string; copiedFromAgentId: string }> {
    const source = await this.repository.findByIdWithWorkflow(
      input.sourceAgentId,
      input.sourceProjectId,
    );
    if (!source) {
      throw new Error("Agent not found");
    }

    let newWorkflowId: string | null = null;
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
      name: copied.name,
      copiedFromAgentId: source.id,
    };
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
    const copies = await this.repository.findCopiesBySourceAgentId(sourceAgentId);
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
