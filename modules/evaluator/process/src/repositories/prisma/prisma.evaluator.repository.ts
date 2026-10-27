import {
  EvaluatorNotFoundError,
  EvaluatorVersionNotFoundError,
  evaluatorConfigSchema,
  evaluatorSchema,
  evaluatorTypeSchema,
  evaluatorVersionAuthorKindSchema,
  type Evaluator,
  type EvaluatorConfig,
  type EvaluatorCopy,
  type EvaluatorWriteAuthor,
} from "@langwatch/evaluator-contract";
import { generate } from "@langwatch/ksuid";
import { PrismaRepository, type PrismaRepositoryTransactionClient } from "@langwatch/prisma-client";
import { isRecordNotFoundError, uniqueConstraintTargets } from "@langwatch/prisma-client/errors";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { fromDate, nowInstant, toDate } from "@langwatch/time";
import { z } from "zod";

import { generateEvaluatorSlug } from "../../rules/evaluator-slug.rules.ts";
import { evaluatorVersionChanged } from "../../rules/evaluator-version.rules.ts";
import type {
  EvaluatorIdsInput,
  EvaluatorLabelRecord,
  EvaluatorRepository,
  EvaluatorVersionLookup,
  EvaluatorVersionRecord,
  PersistEvaluatorInput,
  UpdatePersistedEvaluatorInput,
} from "../evaluator.repository.ts";

/** The copy lineage names the project a replica sits in, all the way up. */
const evaluatorCopySelect = {
  id: true,
  name: true,
  projectId: true,
  project: {
    select: {
      name: true,
      team: { select: { name: true, organization: { select: { name: true } } } },
    },
  },
} as const;

type EvaluatorRow = {
  id: string;
  projectId: string;
  name: string;
  slug: string | null;
  type: unknown;
  config: unknown;
  workflowId: string | null;
  copiedFromEvaluatorId: string | null;
  archivedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  createdById?: string | null;
  updatedById?: string | null;
  _count?: { copiedEvaluators: number };
};

function mapRow(row: EvaluatorRow): Evaluator {
  const config = row.config === null ? null : evaluatorConfigSchema.parse(row.config);

  return evaluatorSchema.parse({
    id: row.id,
    projectId: row.projectId,
    name: row.name,
    slug: row.slug,
    type: row.type,
    config,
    workflowId: row.workflowId,
    copiedFromEvaluatorId: row.copiedFromEvaluatorId,
    archivedAt: row.archivedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    createdById: row.createdById ?? null,
    updatedById: row.updatedById ?? null,
    ...(row._count
      ? {
          copyCount: row._count.copiedEvaluators,
          _count: { copiedEvaluators: row._count.copiedEvaluators },
        }
      : {}),
  });
}

const prismaJsonInputSchema = z.custom<Prisma.InputJsonValue>((value) => value !== null);

function jsonInput(value: EvaluatorConfig): Prisma.InputJsonValue {
  return prismaJsonInputSchema.parse(z.json().parse(value));
}

const VERSION_MODELS = ["Evaluator", "EvaluatorVersion", "EvaluatorVersionLabel"] as const;
type VersionTransaction = PrismaRepositoryTransactionClient<typeof VERSION_MODELS>;

type VersionRow = {
  id: string;
  evaluatorId: string;
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

function mapVersionRow(row: VersionRow): EvaluatorVersionRecord {
  return {
    ...row,
    type: evaluatorTypeSchema.parse(row.type),
    config: evaluatorConfigSchema.safeParse(row.config).data ?? {},
    authorKind: evaluatorVersionAuthorKindSchema.safeParse(row.authorKind).data ?? null,
    createdAt: fromDate(row.createdAt),
  };
}

/** Two writers raced for the same next number; the loser writes again with the next one. */
const VERSION_WRITE_ATTEMPTS = 3;

function isVersionRace(error: unknown): boolean {
  const targets = uniqueConstraintTargets(error);
  return (
    targets.includes("version") || targets.includes("EvaluatorVersion_evaluatorId_version_key")
  );
}

export class PrismaEvaluatorRepository
  extends PrismaRepository.transactionalFor(...VERSION_MODELS)
  implements EvaluatorRepository
{
  static readonly create = this.factory((prisma) => new PrismaEvaluatorRepository(prisma));

  async findById(input: { id: string; projectId: string }): Promise<Evaluator | undefined> {
    const row = await this.prisma.evaluator.findFirst({
      where: { id: input.id, projectId: input.projectId, archivedAt: null },
    });

    return row ? mapRow(row) : void 0;
  }

  async findByIdAcrossProjects(id: string): Promise<Evaluator | undefined> {
    const row = await this.prisma.evaluator.findFirst({ where: { id, archivedAt: null } });

    return row ? mapRow(row) : void 0;
  }

  async findBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | undefined> {
    const row = await this.prisma.evaluator.findFirst({
      where: { slug: input.slug, projectId: input.projectId, archivedAt: null },
    });

    return row ? mapRow(row) : void 0;
  }

  async findByWorkflow(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Evaluator | undefined> {
    const row = await this.prisma.evaluator.findFirst({
      where: { workflowId: input.workflowId, projectId: input.projectId, archivedAt: null },
    });

    return row ? mapRow(row) : void 0;
  }

  async findByIdOrSlug(input: {
    idOrSlug: string;
    projectId: string;
  }): Promise<Evaluator | undefined> {
    const row = await this.prisma.evaluator.findFirst({
      where: {
        projectId: input.projectId,
        OR: [{ slug: input.idOrSlug }, { id: input.idOrSlug }],
        archivedAt: null,
      },
    });

    return row ? mapRow(row) : void 0;
  }

  async countActiveByProjects(input: { projectIds: string[] }): Promise<number> {
    if (input.projectIds.length === 0) return 0;
    return this.prisma.evaluator.count({
      where: { projectId: { in: input.projectIds }, archivedAt: null },
    });
  }

  async findAll(input: { projectId: string }): Promise<Evaluator[]> {
    const rows = await this.prisma.evaluator.findMany({
      where: { projectId: input.projectId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });

    const copyCounts = await this.prisma.evaluator.groupBy({
      by: ["copiedFromEvaluatorId"],
      where: {
        copiedFromEvaluatorId: { in: rows.map((row) => row.id) },
        archivedAt: null,
      },
      _count: { _all: true },
    });
    const countsByEvaluatorId = new Map<string, number>();
    for (const count of copyCounts) {
      if (count.copiedFromEvaluatorId !== null) {
        countsByEvaluatorId.set(count.copiedFromEvaluatorId, count._count._all);
      }
    }

    return rows.map((row) =>
      mapRow({
        ...row,
        _count: { copiedEvaluators: countsByEvaluatorId.get(row.id) ?? 0 },
      }),
    );
  }

  async findCopies(input: { evaluatorId: string }): Promise<EvaluatorCopy[]> {
    const rows = await this.prisma.evaluator.findMany({
      where: { copiedFromEvaluatorId: input.evaluatorId, archivedAt: null },
      select: evaluatorCopySelect,
    });

    return rows.map((row) => ({
      id: row.id,
      name: row.name,
      projectId: row.projectId,
      fullPath: `${row.project.team.organization.name} / ${row.project.team.name} / ${row.project.name}`,
    }));
  }

  /**
   * The slug is unique inside a project, so a collision is retried with a
   * freshly derived one rather than refused: two evaluators may share a name.
   */
  async create(input: PersistEvaluatorInput): Promise<Evaluator> {
    let requestedSlug = input.slug ?? generateEvaluatorSlug(input.name);

    const createdById = input.author?.authorId ?? null;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const slug = requestedSlug;
        const row = await this.transaction(async (transaction) => {
          const created = await transaction.evaluator.create({
            data: {
              id: input.id,
              projectId: input.projectId,
              name: input.name,
              slug,
              type: input.type,
              config: jsonInput(input.config),
              ...(input.workflowId !== void 0 ? { workflowId: input.workflowId } : {}),
              ...(input.copiedFromEvaluatorId !== void 0
                ? { copiedFromEvaluatorId: input.copiedFromEvaluatorId }
                : {}),
              createdById,
              updatedById: createdById,
            },
          });
          await this.#appendVersion({
            transaction,
            evaluator: created,
            author: input.author,
            commitMessage: void 0,
          });
          return created;
        });

        return mapRow(row);
      } catch (error) {
        if (!isSlugCollision(error)) throw error;

        requestedSlug = generateEvaluatorSlug(input.name);
      }
    }

    throw new Error("Could not allocate a unique evaluator slug");
  }

  async update(input: UpdatePersistedEvaluatorInput): Promise<Evaluator> {
    const data: Prisma.EvaluatorUncheckedUpdateInput = {
      ...(input.data.name !== void 0 ? { name: input.data.name } : {}),
      ...(input.data.type !== void 0 ? { type: input.data.type } : {}),
      ...(input.data.workflowId !== void 0 ? { workflowId: input.data.workflowId } : {}),
      ...(input.data.config !== void 0 ? { config: jsonInput(input.data.config) } : {}),
    };
    const row = await this.#writeWithVersion({
      projectId: input.projectId,
      id: input.id,
      author: input.author,
      commitMessage: input.commitMessage,
      data,
    });

    return mapRow(row);
  }

  async archive(input: { id: string; projectId: string }): Promise<Evaluator> {
    const row = await this.prisma.evaluator.update({
      where: { id: input.id, projectId: input.projectId },
      data: { archivedAt: toDate(nowInstant()) },
    });

    return mapRow(row);
  }

  async updateNameAndConfig(input: {
    id: string;
    projectId: string;
    name: string;
    config: EvaluatorConfig;
    commitMessage?: string;
  }): Promise<void> {
    await this.#writeWithVersion({
      projectId: input.projectId,
      id: input.id,
      author: void 0,
      commitMessage: input.commitMessage,
      data: { name: input.name, config: jsonInput(input.config) },
    });
  }

  async findVersions(input: {
    projectId: string;
    evaluatorId: string;
  }): Promise<EvaluatorVersionRecord[]> {
    const rows = await this.prisma.evaluatorVersion.findMany({
      where: { projectId: input.projectId, evaluatorId: input.evaluatorId },
      orderBy: { version: "desc" },
    });
    return rows.map(mapVersionRow);
  }

  async findVersion(input: EvaluatorVersionLookup): Promise<EvaluatorVersionRecord | undefined> {
    const row = await this.prisma.evaluatorVersion.findFirst({
      where: {
        projectId: input.projectId,
        evaluatorId: input.evaluatorId,
        ...(input.version !== void 0 ? { version: input.version } : {}),
        ...(input.versionId !== void 0 ? { id: input.versionId } : {}),
      },
      orderBy: { version: "desc" },
    });
    return row ? mapVersionRow(row) : void 0;
  }

  async latestVersionNumbers(input: EvaluatorIdsInput): Promise<Map<string, number>> {
    if (input.ids.length === 0) return new Map();
    const rows = await this.prisma.evaluatorVersion.groupBy({
      by: ["evaluatorId"],
      where: { projectId: input.projectId, evaluatorId: { in: input.ids } },
      _max: { version: true },
    });
    return new Map(
      rows.flatMap((row) =>
        row._max.version ? [[row.evaluatorId, row._max.version] as const] : [],
      ),
    );
  }

  async findLabels(input: EvaluatorIdsInput): Promise<EvaluatorLabelRecord[]> {
    if (input.ids.length === 0) return [];
    const labels = await this.prisma.evaluatorVersionLabel.findMany({
      where: { projectId: input.projectId, evaluatorId: { in: input.ids } },
      orderBy: { label: "asc" },
    });
    const versions = await this.prisma.evaluatorVersion.findMany({
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
              evaluatorId: label.evaluatorId,
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
    evaluatorId: string;
    label: string;
    versionId: string;
    actorId: string | null;
  }): Promise<EvaluatorLabelRecord> {
    return this.transaction(async (transaction) => {
      const version = await transaction.evaluatorVersion.findFirst({
        where: { projectId: input.projectId, evaluatorId: input.evaluatorId, id: input.versionId },
        select: { id: true, version: true },
      });
      if (!version) throw new EvaluatorVersionNotFoundError({ evaluatorId: input.evaluatorId });
      const row = await transaction.evaluatorVersionLabel.upsert({
        where: {
          evaluatorId_label: { evaluatorId: input.evaluatorId, label: input.label },
          projectId: input.projectId,
        },
        create: {
          id: generate("evaluatorversionlabel").toString(),
          projectId: input.projectId,
          evaluatorId: input.evaluatorId,
          label: input.label,
          versionId: version.id,
          createdById: input.actorId,
          updatedById: input.actorId,
        },
        update: { versionId: version.id, updatedById: input.actorId },
      });
      return {
        evaluatorId: row.evaluatorId,
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
    evaluatorId: string;
    label: string;
  }): Promise<boolean> {
    const removed = await this.prisma.evaluatorVersionLabel.deleteMany({
      where: { projectId: input.projectId, evaluatorId: input.evaluatorId, label: input.label },
    });
    return removed.count > 0;
  }

  async findUnversioned(input: { afterId: string | null; limit: number }): Promise<Evaluator[]> {
    // Licence-counted reads of Evaluator cross projects; the version check below is per project.
    const rows = await this.prisma.evaluator.findMany({
      where: { archivedAt: null, ...(input.afterId ? { id: { gt: input.afterId } } : {}) },
      orderBy: { id: "asc" },
      take: input.limit,
    });
    return rows.map(mapRow);
  }

  async backfillFirstVersion(input: {
    evaluator: Evaluator;
    createdById: string | null;
  }): Promise<boolean> {
    const { evaluator } = input;
    return this.transaction(async (transaction) => {
      const existing = await transaction.evaluatorVersion.count({
        where: { projectId: evaluator.projectId, evaluatorId: evaluator.id },
      });
      if (existing > 0) return false;
      await transaction.evaluatorVersion.create({
        data: {
          id: generate("evaluatorversion").toString(),
          projectId: evaluator.projectId,
          evaluatorId: evaluator.id,
          version: 1,
          name: evaluator.name,
          type: evaluator.type,
          config: jsonInput(evaluatorConfigSchema.parse(evaluator.config ?? {})),
          workflowId: evaluator.workflowId,
          authorId: input.createdById,
          authorKind: input.createdById ? "user" : "system",
          createdAt: evaluator.createdAt,
        },
      });
      if (input.createdById) {
        await transaction.evaluator.updateMany({
          where: { projectId: evaluator.projectId, id: evaluator.id, createdById: null },
          data: { createdById: input.createdById, updatedAt: evaluator.updatedAt },
        });
      }
      return true;
    });
  }

  /**
   * Writes the row and appends the next version in one transaction, when the write changed
   * what a version holds; again on a number race.
   */
  async #writeWithVersion(input: {
    projectId: string;
    id: string;
    author: EvaluatorWriteAuthor | undefined;
    commitMessage: string | undefined;
    data: Prisma.EvaluatorUncheckedUpdateInput;
  }) {
    for (let attempt = 1; attempt <= VERSION_WRITE_ATTEMPTS; attempt += 1) {
      try {
        return await this.transaction((transaction) => this.#writeOnce({ transaction, ...input }));
      } catch (error) {
        if (attempt < VERSION_WRITE_ATTEMPTS && isVersionRace(error)) continue;
        if (isRecordNotFoundError(error)) throw new EvaluatorNotFoundError(input.id);
        throw error;
      }
    }
    throw new Error(
      `Evaluator ${input.id} lost the version number race ${VERSION_WRITE_ATTEMPTS} times`,
    );
  }

  async #writeOnce(input: {
    transaction: VersionTransaction;
    projectId: string;
    id: string;
    author: EvaluatorWriteAuthor | undefined;
    commitMessage: string | undefined;
    data: Prisma.EvaluatorUncheckedUpdateInput;
  }) {
    const { transaction } = input;
    const before = await transaction.evaluator.findFirst({
      where: { id: input.id, projectId: input.projectId },
    });
    if (!before) throw new EvaluatorNotFoundError(input.id);
    const updated = await transaction.evaluator.update({
      where: { id: input.id, projectId: input.projectId },
      data: input.data,
    });
    const changed = evaluatorVersionChanged({ before: mapRow(before), after: mapRow(updated) });
    if (!changed) return updated;
    await this.#appendVersion({
      transaction,
      evaluator: updated,
      author: input.author,
      commitMessage: input.commitMessage,
    });
    if (!input.author) return updated;
    return transaction.evaluator.update({
      where: { id: input.id, projectId: input.projectId },
      data: { updatedById: input.author.authorId },
    });
  }

  async #appendVersion(input: {
    transaction: VersionTransaction;
    evaluator: {
      id: string;
      projectId: string;
      name: string;
      type: string;
      config: Prisma.JsonValue;
      workflowId: string | null;
    };
    author: EvaluatorWriteAuthor | undefined;
    commitMessage: string | undefined;
  }): Promise<void> {
    const { transaction, evaluator } = input;
    const latest = await transaction.evaluatorVersion.findFirst({
      where: { projectId: evaluator.projectId, evaluatorId: evaluator.id },
      orderBy: { version: "desc" },
      select: { version: true },
    });
    await transaction.evaluatorVersion.create({
      data: {
        id: generate("evaluatorversion").toString(),
        projectId: evaluator.projectId,
        evaluatorId: evaluator.id,
        version: (latest?.version ?? 0) + 1,
        name: evaluator.name,
        type: evaluator.type,
        config: jsonInput(evaluatorConfigSchema.safeParse(evaluator.config).data ?? {}),
        workflowId: evaluator.workflowId,
        commitMessage: input.commitMessage ?? null,
        authorId: input.author?.authorId ?? null,
        authorKind: input.author?.authorKind ?? "system",
      },
    });
  }
}

function isSlugCollision(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message.includes("Unique constraint") &&
    error.message.includes("slug")
  );
}
