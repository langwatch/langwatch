import {
  AgentNotFoundError,
  type AgentWorkflowInput,
  type UpdateAgentWorkflowConfigInput,
  AgentAlreadyExistsError,
  AgentSourceNotFoundError,
  agentReferenceStateSchema,
  connectedAgentSeenCutoff,
  type GetAgentInput,
  type AgentProjectInput,
  type AgentIdsInput,
  type ListAgentsInput,
  type ConnectedAgentsInput,
  type ConnectedAgentsEnvironmentInput,
} from "@langwatch/agent-contract";
import { PrismaRepository } from "@langwatch/prisma-client";
import {
  isRecordNotFoundError,
  isUniqueConstraintError,
  uniqueConstraintTargets,
} from "@langwatch/prisma-client/errors";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { nowInstant, toDate } from "@langwatch/time";
import { z } from "zod";
import type {
  AgentRepository,
  PersistAgentInput,
  UpdatePersistedAgentInput,
  UpdateAgentCopyInput,
  RegisterPersistedAgentInput,
  AgentPresenceInput,
} from "../agent.repository.ts";
import { mapAgentRow } from "./prisma.agent.mapper.ts";

function connectedAgentVisibleWhere(): Prisma.AgentWhereInput {
  return {
    OR: [
      { type: { not: "connected" } },
      { lastSeenAt: null },
      { lastSeenAt: { gte: toDate(connectedAgentSeenCutoff(nowInstant())) } },
    ],
  };
}

const jsonSchema: z.ZodType<Prisma.JsonValue> = z.lazy(() =>
  z.union([z.string(), z.number(), z.boolean(), z.null(), z.array(jsonSchema), configSchema]),
);

const configSchema: z.ZodType<Prisma.JsonObject> = z
  .record(z.string(), jsonSchema.optional())
  .transform((config) =>
    Object.fromEntries(
      Object.entries(config).flatMap(([key, value]) => (value === void 0 ? [] : [[key, value]])),
    ),
  );

export class PrismaAgentRepository
  extends PrismaRepository.for("Agent")
  implements AgentRepository
{
  static readonly create = this.factory((prisma) => new PrismaAgentRepository(prisma));

  async listWorkflowConfigs(input: AgentWorkflowInput) {
    const agents = await this.prisma.agent.findMany({
      where: { projectId: input.projectId, workflowId: input.workflowId, archivedAt: null },
      select: { id: true, config: true },
    });

    return agents.map(({ id, config }) => ({
      id,
      config: z.record(z.string(), z.unknown()).safeParse(config).data ?? {},
    }));
  }

  async updateWorkflowConfig(input: UpdateAgentWorkflowConfigInput): Promise<void> {
    await this.prisma.agent
      .update({
        where: { id: input.id, projectId: input.projectId, workflowId: input.workflowId },
        data: { config: configSchema.parse(input.config) },
      })
      .catch((error: unknown) => {
        if (isRecordNotFoundError(error)) throw new AgentNotFoundError(input.id, input.projectId);
        throw error;
      });
  }

  async getById(input: GetAgentInput) {
    const row = await this.prisma.agent.findFirst({
      where: { id: input.id, projectId: input.projectId, archivedAt: null },
    });
    if (!row) throw new AgentNotFoundError(input.id, input.projectId);

    return mapAgentRow(row);
  }

  async getByIdOnly(id: string) {
    const row = await this.prisma.agent.findFirst({ where: { id, archivedAt: null } });
    if (!row) throw new AgentSourceNotFoundError(id);

    return mapAgentRow(row);
  }

  async getByIdIncludingArchived(input: GetAgentInput) {
    const row = await this.prisma.agent.findFirst({
      where: { id: input.id, projectId: input.projectId },
    });
    if (!row) throw new AgentNotFoundError(input.id, input.projectId);

    return mapAgentRow(row);
  }

  async findAll(input: AgentProjectInput) {
    const rows = await this.prisma.agent.findMany({
      where: { projectId: input.projectId, archivedAt: null, AND: [connectedAgentVisibleWhere()] },
      orderBy: { updatedAt: "desc" },
      include: { _count: { select: { copiedAgents: true } } },
    });

    return rows.map(mapAgentRow);
  }

  async findReferenceStates(input: AgentIdsInput) {
    const rows = await this.prisma.agent.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: {
        id: true,
        archivedAt: true,
        type: true,
        name: true,
        ownerUserId: true,
        lastSeenAt: true,
      },
    });

    return agentReferenceStateSchema.array().parse(rows);
  }

  findNamesByIds(input: AgentIdsInput) {
    return this.prisma.agent.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: { id: true, name: true },
    });
  }

  async exists(input: GetAgentInput) {
    return (
      (await this.prisma.agent.count({
        where: { id: input.id, projectId: input.projectId, archivedAt: null },
      })) > 0
    );
  }

  async findPage(input: ListAgentsInput) {
    const where = {
      projectId: input.projectId,
      archivedAt: null,
      AND: [connectedAgentVisibleWhere()],
    };
    const [rows, total] = await Promise.all([
      this.prisma.agent.findMany({
        where,
        orderBy: { updatedAt: "desc" },
        skip: (input.page - 1) * input.limit,
        take: input.limit,
      }),
      this.prisma.agent.count({ where }),
    ]);

    return { data: rows.map(mapAgentRow), total };
  }

  async create(input: PersistAgentInput) {
    const row = await this.prisma.agent
      .create({
        data: {
          id: input.id,
          projectId: input.projectId,
          name: input.name,
          type: input.type,
          config: configSchema.parse(input.config),
          workflowId: input.workflowId,
          copiedFromAgentId: input.copiedFromAgentId,
          environment: input.identity?.environment,
          ownerUserId: input.identity?.ownerUserId,
          hostLabel: input.identity?.hostLabel,
          identityKey: input.identity?.identityKey,
          lastSeenAt: input.identity ? new Date() : void 0,
        },
      })
      .catch((error: unknown) => this.#writeError(error, input));

    return mapAgentRow(row);
  }

  async update(input: UpdatePersistedAgentInput) {
    const row = await this.prisma.agent
      .update({
        where: { id: input.id, projectId: input.projectId },
        data: {
          name: input.name,
          type: input.type,
          config: configSchema.parse(input.config),
          workflowId: input.workflowId,
        },
      })
      .catch((error: unknown) => this.#writeError(error, input));

    return mapAgentRow(row);
  }

  async archive(input: GetAgentInput) {
    const row = await this.prisma.agent
      .update({
        where: { id: input.id, projectId: input.projectId, archivedAt: null },
        data: { archivedAt: new Date() },
      })
      .catch((error: unknown) => this.#writeError(error, input));

    return mapAgentRow(row);
  }

  findCopies(sourceAgentId: string) {
    return this.prisma.agent.findMany({
      where: { copiedFromAgentId: sourceAgentId, archivedAt: null },
      select: { id: true, name: true, projectId: true },
    });
  }

  async updateNameAndConfig(input: UpdateAgentCopyInput): Promise<void> {
    await this.prisma.agent.update({
      where: { id: input.id, projectId: input.projectId },
      data: { name: input.name, config: configSchema.parse(input.config) },
    });
  }

  async findConnectedByNameAndEnvironment(input: ConnectedAgentsEnvironmentInput) {
    const rows = await this.prisma.agent.findMany({
      where: {
        projectId: input.projectId,
        name: input.name,
        environment: input.environment,
        type: "connected",
        archivedAt: null,
        AND: [connectedAgentVisibleWhere()],
      },
    });

    return rows.map(mapAgentRow);
  }

  async findConnectedByName(input: ConnectedAgentsInput) {
    const rows = await this.prisma.agent.findMany({
      where: {
        projectId: input.projectId,
        name: input.name,
        type: "connected",
        archivedAt: null,
        AND: [connectedAgentVisibleWhere()],
      },
    });

    return rows.map(mapAgentRow);
  }

  async registerConnected(input: RegisterPersistedAgentInput) {
    const config = configSchema.parse(input.config);
    const lastSeenAt = new Date();
    const identity = { projectId: input.projectId, identityKey: input.identity.identityKey };
    const row = await this.prisma.agent
      .upsert({
        where: {
          projectId_identityKey: identity,
        },
        create: {
          id: input.id,
          projectId: input.projectId,
          name: input.name,
          type: "connected",
          config,
          environment: input.identity.environment,
          ownerUserId: input.identity.ownerUserId,
          hostLabel: input.identity.hostLabel,
          identityKey: input.identity.identityKey,
          lastSeenAt,
        },
        update: { name: input.name, config, archivedAt: null, lastSeenAt },
      })
      .catch((error: unknown) => {
        const targets = uniqueConstraintTargets(error);
        const identityConflict =
          targets.includes("identityKey") || targets.includes("Agent_projectId_identityKey_key");
        if (!identityConflict) {
          return this.#writeError(error, input);
        }

        // Prisma can emulate compound-key upserts; another registrant may insert first.
        return this.prisma.agent.update({
          where: { projectId_identityKey: identity },
          data: { name: input.name, config, archivedAt: null, lastSeenAt },
        });
      });

    return mapAgentRow(row);
  }

  async touchLastSeenAt(input: AgentPresenceInput): Promise<void> {
    await this.prisma.agent.update({
      where: { id: input.id, projectId: input.projectId },
      data: { lastSeenAt: toDate(input.at) },
    });
  }

  #writeError(error: unknown, input: GetAgentInput): never {
    if (isRecordNotFoundError(error)) throw new AgentNotFoundError(input.id, input.projectId);
    if (isUniqueConstraintError(error))
      throw new AgentAlreadyExistsError(input.id, input.projectId);
    throw error;
  }
}
