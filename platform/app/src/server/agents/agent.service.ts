// biome-ignore-all lint/suspicious/noEmptyBlockStatements: the empty blocks in this file are deliberate no-ops.

import type { PrismaClient } from "~/generated/prisma/client";
import type {
  ConnectedComponentConfig,
  Workflow,
} from "~/optimization_studio/types/dsl";
import type { ScenarioParameterDefinition } from "~/server/scenarios/parameters";
import type { RunActor } from "~/server/scenarios/run-actor";
import {
  type AgentComponentConfig,
  type AgentCopyRow,
  AgentRepository,
  type AgentType,
  type ConnectedAgentIdentity,
  type CreateAgentInput,
  type TypedAgent,
  type UpdateAgentInput,
} from "./agent.repository";
import {
  type AgentWithFields,
  linkedWorkflowId,
  resolveAgentFields,
} from "./agent-fields";
import {
  type AgentTestRunResult,
  createAgentTestRunDeps,
  scheduleAgentTestRun,
} from "./agent-test-run";
import { AgentNotFoundError, AgentRegisterOnlyError } from "./errors";

/**
 * One agent as the REST list and read answer it: the row, plus the identity
 * and the declared parameters of a connected agent, absent on the others.
 */
export type AgentListRow = {
  id: string;
  name: string;
  type: string;
  config: AgentComponentConfig;
  environment: string | null;
  ownerUserId: string | null;
  hostLabel: string | null;
  lastSeenAt: Date | null;
  parameters: ScenarioParameterDefinition[];
  createdAt: Date;
  updatedAt: Date;
};

/** The parameters a connected agent declares; every other type declares none. */
export function declaredAgentParameters(
  agent: Pick<TypedAgent, "type" | "config">,
): ScenarioParameterDefinition[] {
  if (agent.type !== "connected") return [];
  return (agent.config as ConnectedComponentConfig).parameters ?? [];
}

export function toAgentListRow(agent: TypedAgent): AgentListRow {
  return {
    id: agent.id,
    name: agent.name,
    type: agent.type,
    config: agent.config,
    environment: agent.environment,
    ownerUserId: agent.ownerUserId,
    hostLabel: agent.hostLabel,
    lastSeenAt: agent.lastSeenAt,
    parameters: declaredAgentParameters(agent),
    createdAt: agent.createdAt,
    updatedAt: agent.updatedAt,
  };
}

/**
 * Service layer for Agent business logic.
 * Single Responsibility: Agent lifecycle management.
 *
 * Framework-agnostic - no tRPC dependencies.
 */
/**
 * Whether Prisma refused a write because a unique index already holds the
 * value. The row the caller wanted exists, written by somebody else.
 */
function isUniqueConstraintViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as { code?: unknown }).code === "P2002"
  );
}

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
   * Gets an agent by ID and projectId, with the fields it reads and produces.
   */
  async getById(input: {
    id: string;
    projectId: string;
  }): Promise<AgentWithFields | null> {
    const agent = await this.repository.findById(input);
    if (!agent) return null;
    const [enriched] = await this.withFields({
      agents: [agent],
      projectId: input.projectId,
    });
    return enriched ?? null;
  }

  /**
   * The owner of every personal development agent given, by user id.
   *
   * One read for the whole list: the agents page labels every personal row
   * with its owner, and the run refusal names the owner too.
   */
  async ownersOf(
    agents: readonly { ownerUserId: string | null }[],
  ): Promise<Map<string, { userId: string; name: string | null }>> {
    const userIds = [
      ...new Set(
        agents
          .map((agent) => agent.ownerUserId)
          .filter((id): id is string => !!id),
      ),
    ];
    if (userIds.length === 0) return new Map();
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, name: true },
    });
    return new Map(
      users.map((user) => [user.id, { userId: user.id, name: user.name }]),
    );
  }

  /**
   * Gets an agent by ID only (any project). For syncFromSource source lookup.
   */
  async getByIdOnly(id: string) {
    return this.repository.findByIdOnly(id);
  }

  /**
   * Gets all agents for a project, with the fields each reads and produces.
   */
  async getAll(input: { projectId: string }): Promise<AgentWithFields[]> {
    const agents = await this.repository.findAll(input);
    return this.withFields({ agents, projectId: input.projectId });
  }

  /**
   * Attach each agent's input and output fields.
   *
   * Every workflow agent in the batch is resolved with one query rather than
   * one per agent: the agent list drawer loads a whole project's agents at
   * once, and a project with fifty workflow agents would otherwise fan out
   * into fifty workflow lookups on every open.
   */
  private async withFields({
    agents,
    projectId,
  }: {
    agents: TypedAgent[];
    projectId: string;
  }): Promise<AgentWithFields[]> {
    const workflowIds = agents.flatMap((agent) =>
      agent.type === "workflow" ? [linkedWorkflowId(agent)] : [],
    );
    const presentIds = workflowIds.filter((id): id is string => !!id);

    const dslByWorkflowId = new Map<string, Workflow>();
    if (presentIds.length > 0) {
      const workflows = await this.prisma.workflow.findMany({
        where: { id: { in: presentIds }, projectId, archivedAt: null },
        include: { currentVersion: true },
      });
      for (const workflow of workflows) {
        const dsl = workflow.currentVersion?.dsl;
        if (dsl) dslByWorkflowId.set(workflow.id, dsl as unknown as Workflow);
      }
    }

    return agents.map((agent) => {
      const workflowId = linkedWorkflowId(agent);
      return {
        ...agent,
        ...resolveAgentFields({
          type: agent.type,
          config: agent.config,
          dsl: workflowId ? dslByWorkflowId.get(workflowId) : undefined,
        }),
      };
    });
  }

  /**
   * Creates a new agent.
   *
   * A connected agent is never created here: the SDK registers it from the
   * process that runs it, through {@link registerConnected}.
   */
  async create(input: CreateAgentInput): Promise<AgentWithFields> {
    if (input.type === "connected") throw new AgentRegisterOnlyError();
    const agent = await this.repository.create(input);
    const [enriched] = await this.withFields({
      agents: [agent],
      projectId: input.projectId,
    });
    return enriched!;
  }

  /**
   * Updates an existing agent.
   *
   * A connected agent takes no edit at all: the row is what the SDK
   * registered, so an edit is refused with `agent_register_only`.
   */
  async update(input: UpdateAgentInput): Promise<AgentWithFields> {
    await this.refuseConnectedUpdate(input);
    const agent = await this.repository.update(input);
    const [enriched] = await this.withFields({
      agents: [agent],
      projectId: input.projectId,
    });
    return enriched!;
  }

  /**
   * Creates or re-registers a connected agent on the row its identity key
   * names. The re-register writes `lastSeenAt`, so a row unseen for too long
   * is listed again, and it clears `archivedAt`, so a row deleted by hand
   * comes back when the process connects again.
   *
   * Several instances of one agent normally start together, so two of them
   * can read no row and both go on to create one. `(projectId, identityKey)`
   * is unique, so the loser of that race is answered with the row the winner
   * wrote rather than with a constraint violation.
   */
  async registerConnected(input: {
    id: string;
    projectId: string;
    name: string;
    config: ConnectedComponentConfig;
    identity: ConnectedAgentIdentity;
  }): Promise<TypedAgent> {
    const existing = await this.repository.findByIdentityKey({
      projectId: input.projectId,
      identityKey: input.identity.identityKey,
    });
    if (existing) {
      return this.reregister({ existingId: existing.id, input });
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
      if (!isUniqueConstraintViolation(error)) throw error;
      const raced = await this.repository.findByIdentityKey({
        projectId: input.projectId,
        identityKey: input.identity.identityKey,
      });
      if (!raced) throw error;
      return this.reregister({ existingId: raced.id, input });
    }
  }

  private reregister({
    existingId,
    input,
  }: {
    existingId: string;
    input: {
      projectId: string;
      name: string;
      config: ConnectedComponentConfig;
    };
  }): Promise<TypedAgent> {
    return this.repository.reregisterConnected({
      id: existingId,
      projectId: input.projectId,
      name: input.name,
      config: input.config,
    });
  }

  /**
   * Refuses an edit of a connected agent. Its type, name, environment and
   * parameters are what the process that runs it declared, so the only way to
   * change them is to change the code and register again.
   */
  private async refuseConnectedUpdate(input: UpdateAgentInput): Promise<void> {
    if (input.data.type === "connected") throw new AgentRegisterOnlyError();
    // Archived rows included: an archived connected agent is still the SDK's
    // to change, and it comes back on the next register.
    const existing = await this.repository.findByIdIncludingArchived({
      id: input.id,
      projectId: input.projectId,
    });
    if (existing?.type === "connected") throw new AgentRegisterOnlyError();
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
    data: Array<AgentListRow>;
    pagination: {
      page: number;
      limit: number;
      total: number;
      totalPages: number;
    };
  }> {
    const { data, total } = await this.repository.findAllPaginated(input);

    return {
      data: data.map(toAgentListRow),
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
   * Runs one scripted scenario against the agent and answers with the run's
   * ids, saving nothing. The person who asked is the run's actor; a personal
   * development agent of someone else is refused.
   *
   * @throws {AgentNotFoundError} when no such agent is in the project
   * @throws {AgentTestRefusedError} when the agent cannot be run as it is
   * @throws {AgentOwnerOnlyError} when the agent belongs to someone else
   */
  async testRun(input: {
    projectId: string;
    agentId: string;
    actor: RunActor | undefined;
  }): Promise<AgentTestRunResult> {
    return scheduleAgentTestRun({
      ...input,
      deps: createAgentTestRunDeps({
        prisma: this.prisma,
        readAgent: (params) => this.getById(params),
      }),
    });
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
    const existing = await this.repository.findById({
      id: input.id,
      projectId: input.projectId,
    });
    if (!existing) {
      throw new AgentNotFoundError();
    }
    await this.refuseConnectedUpdate(input);
    return this.repository.update(input);
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
          isEvaluator?: boolean;
          isComponent?: boolean;
          latestVersion: { dsl: unknown } | null;
        };
        targetProjectId: string;
        sourceProjectId: string;
        copiedFromWorkflowId: string;
      }) => Promise<{ workflowId: string }>;
    },
  ): Promise<{
    id: string;
    projectId: string;
    name: string;
    copiedFromAgentId: string;
  }> {
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
            isEvaluator: source.workflow.isEvaluator,
            isComponent: source.workflow.isComponent,
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

    const userIds = [
      ...new Set(logs.map((l) => l.userId).filter((id): id is string => !!id)),
    ];
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
      user: log.userId ? (usersById[log.userId] ?? null) : null,
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
