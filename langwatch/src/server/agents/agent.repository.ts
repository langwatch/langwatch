import { Prisma } from "@prisma/client";
import type { Agent, PrismaClient } from "@prisma/client";
import { z } from "zod";
import {
  type CodeComponentConfig,
  type CustomComponentConfig,
  codeComponentSchema,
  customComponentSchema,
  type HttpComponentConfig,
  httpComponentSchema,
  type SignatureComponentConfig,
  signatureComponentSchema,
} from "~/optimization_studio/types/dsl";

/**
 * Agent types enum - matches ComponentType for signature/code/custom(workflow)/http
 */
export const agentTypeSchema = z.enum([
  "signature",
  "code",
  "workflow",
  "http",
]);
export type AgentType = z.infer<typeof agentTypeSchema>;

/**
 * Union type for agent config - matches existing DSL node data types
 */
export type AgentComponentConfig =
  | SignatureComponentConfig
  | CodeComponentConfig
  | CustomComponentConfig
  | HttpComponentConfig;

/**
 * Get the appropriate config schema based on agent type
 */
const getConfigSchemaForType = (type: AgentType) => {
  switch (type) {
    case "signature":
      return signatureComponentSchema;
    case "code":
      return codeComponentSchema;
    case "workflow":
      return customComponentSchema;
    case "http":
      return httpComponentSchema;
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
   * Excludes archived agents. Orders by most recently updated.
   * Returns typed agents with parsed config.
   */
  async findAll(input: { projectId: string }): Promise<TypedAgent[]> {
    const agents = await this.prisma.agent.findMany({
      where: {
        projectId: input.projectId,
        archivedAt: null,
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
      },
    });

    return parseAgent(agent);
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
        : (validateConfig(type, data.config) as unknown as Prisma.InputJsonValue);
    await this.prisma.agent.update({
      where: { id: agentId, projectId },
      data: { name: data.name, config: configToStore },
    });
  }

  /**
   * Finds all non-archived agents that are copies of the given source agent,
   * with project/team/org for building fullPath. Used by getCopies (push-to-replicas UI).
   */
  async findCopiesBySourceAgentId(sourceAgentId: string): Promise<AgentCopyRow[]> {
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
    latestVersion: { dsl: unknown } | null;
  } | null;
};
