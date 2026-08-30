import { z } from "zod";
import type { Agent, PrismaClient } from "~/generated/prisma/client";
import { Prisma } from "~/generated/prisma/client";
import {
  type CodeComponentConfig,
  type ConnectedComponentConfig,
  type CustomComponentConfig,
  codeComponentSchema,
  connectedComponentSchema,
  customComponentSchema,
  type HttpComponentConfig,
  httpComponentSchema,
  type SignatureComponentConfig,
  signatureComponentSchema,
} from "~/optimization_studio/types/dsl";
import { connectedAgentVisibleWhere } from "./connected-agent-visibility";

/**
 * Agent types enum - matches ComponentType for signature/code/custom(workflow)/http,
 * plus "connected": an agent registered from code by the SDK (ADR-128).
 */
export const agentTypeSchema = z.enum([
  "signature",
  "code",
  "workflow",
  "http",
  "connected",
]);
export type AgentType = z.infer<typeof agentTypeSchema>;

/**
 * Union type for agent config - matches existing DSL node data types
 */
export type AgentComponentConfig =
  | SignatureComponentConfig
  | CodeComponentConfig
  | CustomComponentConfig
  | HttpComponentConfig
  | ConnectedComponentConfig;

/**
 * Get the appropriate config schema based on agent type
 */
export const getConfigSchemaForType = (type: AgentType) => {
  switch (type) {
    case "signature":
      return signatureComponentSchema;
    case "code":
      return codeComponentSchema;
    case "workflow":
      return customComponentSchema;
    case "http":
      return httpComponentSchema;
    case "connected":
      return connectedComponentSchema;
    default: {
      const _exhaustive: never = type;
      throw new Error(`Unknown agent type: ${_exhaustive}`);
    }
  }
};

/**
 * Validates and parses config for a given agent type
 */
const validateConfig = (
  type: AgentType,
  config: unknown,
): AgentComponentConfig => {
  const schema = getConfigSchemaForType(type);
  return schema.parse(config);
};

/**
 * Typed agent with parsed config matching DSL node data types.
 * May include _count for copy/replica UI.
 */
export type TypedAgent = Omit<Agent, "config" | "type"> & {
  type: AgentType;
  config: AgentComponentConfig;
  _count?: { copiedAgents: number };
};

/**
 * Parse a raw agent from database into typed agent.
 * Preserves _count when present (for copy/replica UI).
 */
const parseAgent = (
  agent: Agent & { _count?: { copiedAgents: number } },
): TypedAgent => {
  const type = agentTypeSchema.parse(agent.type);
  const config = validateConfig(type, agent.config);
  return {
    ...agent,
    type,
    config,
    ...(agent._count && { _count: agent._count }),
  };
};

/**
 * Input type for creating an agent
 */
export type CreateAgentInput = {
  id: string;
  projectId: string;
  name: string;
  type: AgentType;
  config: AgentComponentConfig;
  workflowId?: string;
  copiedFromAgentId?: string;
  /** The identity of a connected agent (ADR-128); unset for every other type. */
  identity?: ConnectedAgentIdentity;
};

/**
 * What tells one connected agent row from another: the environment the SDK
 * resolved, the scope of a development agent, and the key that folds them.
 */
export type ConnectedAgentIdentity = {
  environment: string;
  ownerUserId: string | null;
  hostLabel: string | null;
  identityKey: string;
};

/**
 * Input type for updating an agent
 */
export type UpdateAgentInput = {
  id: string;
  projectId: string;
  data: Partial<{
    name: string;
    type: AgentType;
    config: AgentComponentConfig;
    workflowId: string | null;
  }>;
};

/**
 * Repository layer for Agent data access.
 * Single Responsibility: Database operations for agents.
 *
 * Validates config on create/update against DSL component schemas
 * and returns typed agents with parsed config that's directly compatible
 * with the optimization studio DSL for execution.
 */
export class AgentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Find multiple agents by IDs regardless of archived status.
   * Returns only id and archivedAt for lightweight classification.
   */
  async findManyIncludingArchived(input: {
    ids: string[];
    projectId: string;
  }): Promise<AgentIdentityRow[]> {
    const rows = await this.prisma.agent.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: IDENTITY_SELECT,
    });
    return rows.map((row) => ({ ...row, type: row.type as AgentType }));
  }

  /**
   * Find agent names by IDs regardless of archived status, with the
   * environment and owner a connected agent's label reads.
   * Used for displaying human-readable names in UI warnings.
   */
  async findNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<AgentNameRow[]> {
    return this.prisma.agent.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: { id: true, name: true, environment: true, ownerUserId: true },
    });
  }

  /**
   * Checks whether a non-archived agent exists for the given id and project.
   * Lightweight: does NOT parse config through Zod.
   */
  async exists(input: { id: string; projectId: string }): Promise<boolean> {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
        archivedAt: null,
      },
      select: { id: true },
    });
    return agent !== null;
  }

  /**
   * Finds a single agent by id within a project.
   * Excludes archived agents by default.
   * Returns typed agent with parsed config.
   */
  async findById(input: {
    id: string;
    projectId: string;
  }): Promise<TypedAgent | null> {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
        archivedAt: null,
      },
    });

    if (!agent) return null;
    return parseAgent(agent);
  }

  /**
   * Finds all agents for a project with copy-count for replica UI.
   * Excludes archived agents and connected agents unseen for too long.
   * Orders by most recently updated.
   * Returns typed agents with parsed config.
   */
  async findAll(input: { projectId: string }): Promise<TypedAgent[]> {
    const agents = await this.prisma.agent.findMany({
      where: {
        projectId: input.projectId,
        archivedAt: null,
        ...connectedAgentVisibleWhere(),
      },
      orderBy: {
        updatedAt: "desc",
      },
      include: {
        _count: { select: { copiedAgents: true } },
      },
    });

    return agents.map(parseAgent);
  }

  /**
   * Finds agents for a project with pagination.
   * Excludes archived agents and connected agents unseen for too long.
   * Orders by most recently updated.
   */
  async findAllPaginated(input: {
    projectId: string;
    page: number;
    limit: number;
  }): Promise<{ data: TypedAgent[]; total: number }> {
    const where = {
      projectId: input.projectId,
      archivedAt: null,
      ...connectedAgentVisibleWhere(),
    };

    const [agents, total] = await Promise.all([
      this.prisma.agent.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.agent.count({ where }),
    ]);

    return { data: agents.map(parseAgent), total };
  }

  /**
   * Creates a new agent.
   * Validates config matches the specified type's DSL schema.
   */
  async create(input: CreateAgentInput): Promise<TypedAgent> {
    // Validate type
    const type = agentTypeSchema.parse(input.type);

    // Validate config matches type's DSL schema
    const validatedConfig = validateConfig(type, input.config);

    const agent = await this.prisma.agent.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        type,
        config: validatedConfig as unknown as Prisma.InputJsonValue,
        workflowId: input.workflowId,
        ...(input.copiedFromAgentId && {
          copiedFromAgentId: input.copiedFromAgentId,
        }),
        ...(input.identity && {
          environment: input.identity.environment,
          ownerUserId: input.identity.ownerUserId,
          hostLabel: input.identity.hostLabel,
          identityKey: input.identity.identityKey,
          lastSeenAt: new Date(),
        }),
      },
    });

    return parseAgent(agent);
  }

  /**
   * Finds a connected agent by its identity key, whatever its state, so a
   * process that registers the same identity writes the row it already has.
   */
  async findByIdentityKey(input: {
    projectId: string;
    identityKey: string;
  }): Promise<TypedAgent | null> {
    const agent = await this.prisma.agent.findFirst({
      where: { projectId: input.projectId, identityKey: input.identityKey },
    });
    if (!agent) return null;
    return parseAgent(agent);
  }

  /**
   * Finds connected agents by name and environment, archived ones and ones
   * unseen for too long excluded.
   *
   * Several rows can answer: one per scope in a development environment. The
   * caller decides which of them a reference addresses.
   */
  async findConnectedByNameAndEnvironment(input: {
    projectId: string;
    name: string;
    environment: string;
  }): Promise<TypedAgent[]> {
    const agents = await this.prisma.agent.findMany({
      where: {
        projectId: input.projectId,
        type: "connected",
        name: input.name,
        environment: input.environment,
        archivedAt: null,
        ...connectedAgentVisibleWhere(),
      },
    });
    return agents.map(parseAgent);
  }

  /**
   * Re-registers a connected agent on its existing row: the name and the
   * config the SDK sent now, and the presence projection fresh. A row unseen
   * for too long is listed again because `lastSeenAt` moved, not because a
   * flag was cleared.
   */
  async reregisterConnected(input: {
    id: string;
    projectId: string;
    name: string;
    config: AgentComponentConfig;
  }): Promise<TypedAgent> {
    const validatedConfig = validateConfig("connected", input.config);
    const agent = await this.prisma.agent.update({
      where: { id: input.id, projectId: input.projectId },
      data: {
        name: input.name,
        config: validatedConfig as unknown as Prisma.InputJsonValue,
        lastSeenAt: new Date(),
      },
    });
    return parseAgent(agent);
  }

  /** Writes the presence projection of one agent. */
  async touchLastSeenAt(input: {
    id: string;
    projectId: string;
    at: Date;
  }): Promise<void> {
    await this.prisma.agent.updateMany({
      where: { id: input.id, projectId: input.projectId },
      data: { lastSeenAt: input.at },
    });
  }

  /**
   * Updates an existing agent.
   * Validates that the agent belongs to the specified project.
   * Validates config if provided.
   */
  async update(input: UpdateAgentInput): Promise<TypedAgent> {
    // Get existing agent to know its type for config validation
    const existing = await this.prisma.agent.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
    });

    if (!existing) {
      throw new Error(
        `Agent ${input.id} not found in project ${input.projectId}`,
      );
    }

    // Determine the type (use new type if provided, otherwise existing)
    const type = input.data.type
      ? agentTypeSchema.parse(input.data.type)
      : agentTypeSchema.parse(existing.type);

    // Validate config if provided
    let configToStore: Prisma.InputJsonValue | undefined;
    if (input.data.config) {
      const validatedConfig = validateConfig(type, input.data.config);
      configToStore = validatedConfig as unknown as Prisma.InputJsonValue;
    }

    const agent = await this.prisma.agent.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: {
        ...(input.data.name && { name: input.data.name }),
        ...(input.data.type && { type }),
        ...(configToStore && { config: configToStore }),
        ...(input.data.workflowId !== undefined && {
          workflowId: input.data.workflowId,
        }),
      },
    });

    return parseAgent(agent);
  }

  /**
   * Soft deletes an agent by setting archivedAt.
   */
  async softDelete(input: {
    id: string;
    projectId: string;
  }): Promise<TypedAgent> {
    const agent = await this.prisma.agent.update({
      where: {
        id: input.id,
        projectId: input.projectId,
      },
      data: {
        archivedAt: new Date(),
      },
    });

    return parseAgent(agent);
  }

  /**
   * Finds an agent by id and projectId with workflow and latestVersion for copy.
   * Returns raw agent + workflow (for copyWorkflowWithDatasets); config/type not parsed.
   */
  async findByIdWithWorkflow(
    id: string,
    projectId: string,
  ): Promise<AgentWithWorkflow | null> {
    const agent = await this.prisma.agent.findFirst({
      where: {
        id,
        projectId,
        archivedAt: null,
      },
      include: {
        workflow: { include: { latestVersion: true } },
      },
    });
    return agent as AgentWithWorkflow | null;
  }

  /**
   * Finds an agent by id only (any project). For syncFromSource source lookup.
   */
  async findByIdOnly(id: string): Promise<TypedAgent | null> {
    const agent = await this.prisma.agent.findFirst({
      where: { id, archivedAt: null },
    });
    if (!agent) return null;
    return parseAgent(agent);
  }

  /**
   * Updates only name and config of an agent (for pushToCopies / syncFromSource).
   * config null is stored as Prisma.JsonNull.
   */
  async updateNameAndConfig(
    agentId: string,
    projectId: string,
    data: { name: string; config: AgentComponentConfig | null },
  ): Promise<void> {
    const existing = await this.prisma.agent.findFirst({
      where: { id: agentId, projectId },
    });
    if (!existing) {
      throw new Error(`Agent ${agentId} not found in project ${projectId}`);
    }
    const type = agentTypeSchema.parse(existing.type);
    const configToStore =
      data.config === null
        ? Prisma.JsonNull
        : (validateConfig(
            type,
            data.config,
          ) as unknown as Prisma.InputJsonValue);
    await this.prisma.agent.update({
      where: { id: agentId, projectId },
      data: { name: data.name, config: configToStore },
    });
  }

  /**
   * Finds all non-archived agents that are copies of the given source agent,
   * with project/team/org for building fullPath. Used by getCopies (push-to-replicas UI).
   */
  async findCopiesBySourceAgentId(
    sourceAgentId: string,
  ): Promise<AgentCopyRow[]> {
    const copies = await this.prisma.agent.findMany({
      where: {
        copiedFromAgentId: sourceAgentId,
        archivedAt: null,
      },
      select: {
        id: true,
        name: true,
        projectId: true,
        project: {
          select: {
            name: true,
            team: {
              select: {
                name: true,
                organization: { select: { name: true } },
              },
            },
          },
        },
      },
    });
    return copies as AgentCopyRow[];
  }
}

/**
 * What a run reads off an agent before it schedules. Returned by
 * findManyIncludingArchived; the config is raw so an archived or malformed
 * row still classifies instead of failing the read.
 */
const IDENTITY_SELECT = {
  id: true,
  name: true,
  type: true,
  config: true,
  environment: true,
  ownerUserId: true,
  hostLabel: true,
  lastSeenAt: true,
  archivedAt: true,
} as const;

/** What a label reads off an agent: its name, and for a connected one its
 *  environment and owner. */
export type AgentNameRow = {
  id: string;
  name: string;
  environment: string | null;
  ownerUserId: string | null;
};

export type AgentIdentityRow = {
  id: string;
  name: string;
  type: AgentType;
  config: Prisma.JsonValue;
  environment: string | null;
  ownerUserId: string | null;
  hostLabel: string | null;
  lastSeenAt: Date | null;
  archivedAt: Date | null;
};

/**
 * Row shape for agent copies (with project/team/org for fullPath).
 * Returned by findCopiesBySourceAgentId.
 */
export type AgentCopyRow = {
  id: string;
  name: string;
  projectId: string;
  project: {
    name: string;
    team: {
      name: string;
      organization: { name: string };
    };
  };
};

/**
 * Agent with workflow and latestVersion for copy. Returned by findByIdWithWorkflow.
 */
export type AgentWithWorkflow = Agent & {
  workflow: {
    id: string;
    name: string;
    icon: string | null;
    description: string | null;
    isEvaluator: boolean;
    isComponent: boolean;
    latestVersion: { dsl: unknown } | null;
  } | null;
};
