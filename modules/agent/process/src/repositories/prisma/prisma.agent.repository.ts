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
  type AgentName,
  type AgentReferenceState,
  type Agent,
  type AgentWorkflowConfig,
  type AgentWriteAuthor,
  AgentVersionNotFoundError,
  agentTypeSchema,
  agentVersionAuthorKindSchema,
} from "@langwatch/agent-contract";
import { generate } from "@langwatch/ksuid";
import { PrismaRepository, type PrismaRepositoryTransactionClient } from "@langwatch/prisma-client";
import {
  isRecordNotFoundError,
  isUniqueConstraintError,
  uniqueConstraintTargets,
} from "@langwatch/prisma-client/errors";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { fromDate, nowInstant, toDate } from "@langwatch/time";
import { z } from "zod";

import type {
  AgentRepository,
  PersistAgentInput,
  UpdatePersistedAgentInput,
  UpdateAgentCopyInput,
  RegisterPersistedAgentInput,
  AgentPresenceInput,
  AgentCopyRecord,
  AgentLabelRecord,
  AgentVersionLookup,
  AgentVersionRecord,
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

const workflowConfigSchema = z.record(z.string(), z.unknown());

const agentReferenceStatesSchema = agentReferenceStateSchema.array();

const VERSION_MODELS = ["Agent", "AgentVersion", "AgentVersionLabel"] as const;
type VersionTransaction = PrismaRepositoryTransactionClient<typeof VERSION_MODELS>;

type VersionRow = {
  id: string;
  agentId: string;
  projectId: string;
  version: number;
  name: string;
  type: string;
  config: unknown;
  workflowId: string | null;
  commitMessage: string | null;
  authorId: string | null;
  authorKind: string | null;
  createdAt: Date;
};

function mapVersionRow(row: VersionRow): AgentVersionRecord {
  return {
    ...row,
    type: agentTypeSchema.parse(row.type),
    config: workflowConfigSchema.safeParse(row.config).data ?? {},
    authorKind: agentVersionAuthorKindSchema.safeParse(row.authorKind).data ?? null,
    createdAt: fromDate(row.createdAt),
  };
}

/** Two writers raced for the same next number; the loser writes again with the next one. */
const VERSION_WRITE_ATTEMPTS = 3;

export class PrismaAgentRepository
  extends PrismaRepository.transactionalFor(...VERSION_MODELS)
  implements AgentRepository
{
  static readonly create = this.factory((prisma) => new PrismaAgentRepository(prisma));

  async findWorkflowConfigs(input: AgentWorkflowInput): Promise<AgentWorkflowConfig[]> {
    const agents = await this.prisma.agent.findMany({
      where: { projectId: input.projectId, workflowId: input.workflowId, archivedAt: null },
      select: { id: true, config: true },
    });

    return agents.map(({ id, config }) => ({
      id,
      config: workflowConfigSchema.safeParse(config).data ?? {},
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

  async getById(input: GetAgentInput): Promise<Agent> {
    const row = await this.prisma.agent.findFirst({
      where: { id: input.id, projectId: input.projectId, archivedAt: null },
    });
    if (!row) throw new AgentNotFoundError(input.id, input.projectId);

    return mapAgentRow(row);
  }

  async getByIdOnly(id: string): Promise<Agent> {
    const row = await this.prisma.agent.findFirst({ where: { id, archivedAt: null } });
    if (!row) throw new AgentSourceNotFoundError(id);

    return mapAgentRow(row);
  }

  async getByIdIncludingArchived(input: GetAgentInput): Promise<Agent> {
    const row = await this.prisma.agent.findFirst({
      where: { id: input.id, projectId: input.projectId },
    });
    if (!row) throw new AgentNotFoundError(input.id, input.projectId);

    return mapAgentRow(row);
  }

  async findProjectIdsWithHttpAgents(): Promise<string[]> {
    const rows = await this.prisma.agent.findMany({
      where: { type: "http", archivedAt: null },
      select: { projectId: true },
      distinct: ["projectId"],
    });

    return rows.map((row) => row.projectId);
  }

  async findAll(input: AgentProjectInput): Promise<Agent[]> {
    const rows = await this.prisma.agent.findMany({
      where: { projectId: input.projectId, archivedAt: null, AND: [connectedAgentVisibleWhere()] },
      orderBy: { updatedAt: "desc" },
    });
    const agentIds = rows.map((row) => row.id);
    // Copies live in any project, as `findCopies` reads them.
    const copies =
      agentIds.length > 0
        ? await this.prisma.agent.groupBy({
            by: ["copiedFromAgentId"],
            where: { copiedFromAgentId: { in: agentIds } },
            _count: { _all: true },
          })
        : [];
    const copyCounts = new Map(copies.map((copy) => [copy.copiedFromAgentId, copy._count._all]));

    return rows.map((row) =>
      mapAgentRow({ ...row, _count: { copiedAgents: copyCounts.get(row.id) ?? 0 } }),
    );
  }

  async findReferenceStates(input: AgentIdsInput): Promise<AgentReferenceState[]> {
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

    return agentReferenceStatesSchema.parse(rows);
  }

  findNamesByIds(input: AgentIdsInput): Promise<AgentName[]> {
    return this.prisma.agent.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: { id: true, name: true },
    });
  }

  async exists(input: GetAgentInput): Promise<boolean> {
    return (
      (await this.prisma.agent.count({
        where: { id: input.id, projectId: input.projectId, archivedAt: null },
      })) > 0
    );
  }

  async listPage(input: ListAgentsInput): Promise<{ data: Agent[]; total: number }> {
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

  async create(input: PersistAgentInput): Promise<Agent> {
    const createdById = input.author?.authorId ?? null;
    const row = await this.transaction(async (transaction) => {
      const created = await transaction.agent.create({
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
          identityKey: input.identity?.identityKey ?? input.identityKey,
          lastSeenAt: input.identity ? toDate(nowInstant()) : void 0,
          createdById,
          updatedById: createdById,
        },
      });
      if (created.type !== "connected") {
        await this.#appendVersion({
          transaction,
          agent: created,
          author: input.author,
          commitMessage: input.commitMessage,
        });
      }
      return created;
    }).catch((error: unknown) => this.#writeError(error, input));

    return mapAgentRow(row);
  }

  async update(input: UpdatePersistedAgentInput): Promise<Agent> {
    const row = await this.#writeWithVersion({
      projectId: input.projectId,
      id: input.id,
      author: input.author,
      commitMessage: input.commitMessage,
      data: {
        name: input.name,
        type: input.type,
        config: configSchema.parse(input.config),
        workflowId: input.workflowId,
      },
    });

    return mapAgentRow(row);
  }

  async updateConfigIfUnchanged(
    input: Parameters<AgentRepository["updateConfigIfUnchanged"]>[0],
  ): Promise<boolean> {
    const written = await this.prisma.agent.updateMany({
      where: { id: input.id, projectId: input.projectId, updatedAt: toDate(input.updatedAt) },
      data: { config: configSchema.parse(input.config) },
    });

    return written.count === 1;
  }

  async archive(input: GetAgentInput): Promise<Agent> {
    const row = await this.prisma.agent
      .update({
        where: { id: input.id, projectId: input.projectId, archivedAt: null },
        data: { archivedAt: toDate(nowInstant()) },
      })
      .catch((error: unknown) => this.#writeError(error, input));

    return mapAgentRow(row);
  }

  findCopies(sourceAgentId: string): Promise<AgentCopyRecord[]> {
    return this.prisma.agent.findMany({
      where: { copiedFromAgentId: sourceAgentId, archivedAt: null },
      select: { id: true, name: true, projectId: true },
    });
  }

  async updateNameAndConfig(input: UpdateAgentCopyInput): Promise<void> {
    await this.#writeWithVersion({
      projectId: input.projectId,
      id: input.id,
      author: input.author,
      commitMessage: input.commitMessage,
      data: { name: input.name, config: configSchema.parse(input.config) },
    });
  }

  async findConnectedByNameAndEnvironment(
    input: ConnectedAgentsEnvironmentInput,
  ): Promise<Agent[]> {
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

  async findConnectedByName(input: ConnectedAgentsInput): Promise<Agent[]> {
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

  async findConnectedInProjects(input: { projectIds: string[] }): Promise<Agent[]> {
    const rows = await this.prisma.agent.findMany({
      where: {
        projectId: { in: input.projectIds },
        type: "connected",
        archivedAt: null,
        AND: [connectedAgentVisibleWhere()],
      },
      orderBy: { createdAt: "desc" },
    });

    return rows.map(mapAgentRow);
  }

  async registerConnected(input: RegisterPersistedAgentInput): Promise<Agent> {
    const config = configSchema.parse(input.config);
    const lastSeenAt = toDate(nowInstant());
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

  async findByIdentityKey(input: { projectId: string; identityKey: string }): Promise<Agent[]> {
    const rows = await this.prisma.agent.findMany({
      where: { projectId: input.projectId, identityKey: input.identityKey },
    });

    return rows.map(mapAgentRow);
  }

  async touchLastSeenAt(input: AgentPresenceInput): Promise<void> {
    await this.prisma.agent.update({
      where: { id: input.id, projectId: input.projectId },
      data: { lastSeenAt: toDate(input.at) },
    });
  }

  async findVersions(input: { projectId: string; agentId: string }): Promise<AgentVersionRecord[]> {
    const rows = await this.prisma.agentVersion.findMany({
      where: { projectId: input.projectId, agentId: input.agentId },
      orderBy: { version: "desc" },
    });
    return rows.map(mapVersionRow);
  }

  async findVersion(input: AgentVersionLookup): Promise<AgentVersionRecord | undefined> {
    const row = await this.prisma.agentVersion.findFirst({
      where: {
        projectId: input.projectId,
        agentId: input.agentId,
        ...(input.version !== void 0 ? { version: input.version } : {}),
        ...(input.versionId !== void 0 ? { id: input.versionId } : {}),
      },
      orderBy: { version: "desc" },
    });
    return row ? mapVersionRow(row) : void 0;
  }

  async latestVersionNumbers(input: AgentIdsInput): Promise<Map<string, number>> {
    if (input.ids.length === 0) return new Map();
    const rows = await this.prisma.agentVersion.groupBy({
      by: ["agentId"],
      where: { projectId: input.projectId, agentId: { in: input.ids } },
      _max: { version: true },
    });
    return new Map(
      rows.flatMap((row) => (row._max.version ? [[row.agentId, row._max.version] as const] : [])),
    );
  }

  async findLabels(input: AgentIdsInput): Promise<AgentLabelRecord[]> {
    if (input.ids.length === 0) return [];
    const labels = await this.prisma.agentVersionLabel.findMany({
      where: { projectId: input.projectId, agentId: { in: input.ids } },
      orderBy: { label: "asc" },
    });
    const versions = await this.prisma.agentVersion.findMany({
      where: { projectId: input.projectId, id: { in: labels.map((label) => label.versionId) } },
      select: { id: true, version: true },
    });
    const numbers = new Map(versions.map((version) => [version.id, version.version]));
    return labels.flatMap((label) => {
      const version = numbers.get(label.versionId);
      return version === void 0
        ? []
        : [
            {
              agentId: label.agentId,
              label: label.label,
              versionId: label.versionId,
              version,
              updatedAt: fromDate(label.updatedAt),
              updatedById: label.updatedById,
            },
          ];
    });
  }

  async assignLabel(input: {
    projectId: string;
    agentId: string;
    label: string;
    versionId: string;
    actorId: string | null;
  }): Promise<AgentLabelRecord> {
    return this.transaction(async (transaction) => {
      const version = await transaction.agentVersion.findFirst({
        where: { projectId: input.projectId, agentId: input.agentId, id: input.versionId },
        select: { id: true, version: true },
      });
      if (!version) throw new AgentVersionNotFoundError({ agentId: input.agentId });
      const row = await transaction.agentVersionLabel.upsert({
        where: {
          agentId_label: { agentId: input.agentId, label: input.label },
          projectId: input.projectId,
        },
        create: {
          id: generate("agentversionlabel").toString(),
          projectId: input.projectId,
          agentId: input.agentId,
          label: input.label,
          versionId: version.id,
          createdById: input.actorId,
          updatedById: input.actorId,
        },
        update: { versionId: version.id, updatedById: input.actorId },
      });
      return {
        agentId: row.agentId,
        label: row.label,
        versionId: row.versionId,
        version: version.version,
        updatedAt: fromDate(row.updatedAt),
        updatedById: row.updatedById,
      };
    });
  }

  async removeLabel(input: {
    projectId: string;
    agentId: string;
    label: string;
  }): Promise<boolean> {
    const removed = await this.prisma.agentVersionLabel.deleteMany({
      where: { projectId: input.projectId, agentId: input.agentId, label: input.label },
    });
    return removed.count > 0;
  }

  async findUnversioned(input: { afterId: string | null; limit: number }): Promise<Agent[]> {
    // Licence-counted reads of Agent cross projects; the version check below is per project.
    const rows = await this.prisma.agent.findMany({
      where: {
        type: { not: "connected" },
        ...(input.afterId ? { id: { gt: input.afterId } } : {}),
      },
      orderBy: { id: "asc" },
      take: input.limit,
    });
    return rows.map(mapAgentRow);
  }

  async backfillFirstVersion(input: {
    agent: Agent;
    createdById: string | null;
  }): Promise<boolean> {
    const { agent } = input;
    return this.transaction(async (transaction) => {
      const existing = await transaction.agentVersion.count({
        where: { projectId: agent.projectId, agentId: agent.id },
      });
      if (existing > 0) return false;
      await transaction.agentVersion.create({
        data: {
          id: generate("agentversion").toString(),
          projectId: agent.projectId,
          agentId: agent.id,
          version: 1,
          name: agent.name,
          type: agent.type,
          config: configSchema.parse(agent.config),
          workflowId: agent.workflowId,
          authorId: input.createdById,
          authorKind: input.createdById ? "user" : "system",
          createdAt: agent.createdAt,
        },
      });
      if (input.createdById) {
        await transaction.agent.updateMany({
          where: { projectId: agent.projectId, id: agent.id, createdById: null },
          data: { createdById: input.createdById, updatedAt: agent.updatedAt },
        });
      }
      return true;
    });
  }

  /** Writes the row and appends the next version in one transaction, again on a number race. */
  async #writeWithVersion(input: {
    projectId: string;
    id: string;
    author: AgentWriteAuthor | undefined;
    commitMessage: string | undefined;
    data: Prisma.AgentUncheckedUpdateInput;
  }) {
    for (let attempt = 1; attempt <= VERSION_WRITE_ATTEMPTS; attempt += 1) {
      try {
        return await this.transaction(async (transaction) => {
          const updated = await transaction.agent.update({
            where: { id: input.id, projectId: input.projectId },
            data: {
              ...input.data,
              ...(input.author ? { updatedById: input.author.authorId } : {}),
            },
          });
          if (updated.type !== "connected") {
            await this.#appendVersion({
              transaction,
              agent: updated,
              author: input.author,
              commitMessage: input.commitMessage,
            });
          }
          return updated;
        });
      } catch (error) {
        if (attempt < VERSION_WRITE_ATTEMPTS && isVersionRace(error)) continue;
        return this.#writeError(error, input);
      }
    }
    throw new Error(
      `Agent ${input.id} lost the version number race ${VERSION_WRITE_ATTEMPTS} times`,
    );
  }

  async #appendVersion(input: {
    transaction: VersionTransaction;
    agent: {
      id: string;
      projectId: string;
      name: string;
      type: string;
      config: Prisma.JsonValue;
      workflowId: string | null;
    };
    author: AgentWriteAuthor | undefined;
    commitMessage: string | undefined;
  }): Promise<void> {
    const { transaction, agent } = input;
    const latest = await transaction.agentVersion.findFirst({
      where: { projectId: agent.projectId, agentId: agent.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    await transaction.agentVersion.create({
      data: {
        id: generate("agentversion").toString(),
        projectId: agent.projectId,
        agentId: agent.id,
        version: (latest?.version ?? 0) + 1,
        name: agent.name,
        type: agent.type,
        config: configSchema.parse(agent.config ?? {}),
        workflowId: agent.workflowId,
        commitMessage: input.commitMessage ?? null,
        authorId: input.author?.authorId ?? null,
        authorKind: input.author?.authorKind ?? "system",
      },
    });
  }

  #writeError(error: unknown, input: GetAgentInput): never {
    if (error instanceof AgentVersionNotFoundError) throw error;
    if (isRecordNotFoundError(error)) throw new AgentNotFoundError(input.id, input.projectId);
    if (isUniqueConstraintError(error))
      throw new AgentAlreadyExistsError(input.id, input.projectId);
    throw error;
  }
}

function isVersionRace(error: unknown): boolean {
  const targets = uniqueConstraintTargets(error);
  return targets.includes("version") || targets.includes("AgentVersion_agentId_version_key");
}
