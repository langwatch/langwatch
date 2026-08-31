import {
  experimentSchema,
  ExperimentNotFoundError,
  ExperimentTypeMismatchError,
  ExperimentVersionNotFoundError,
  type Experiment,
  type ExperimentType,
  type SaveExperimentInput,
  type WorkbenchActor,
  type WorkbenchStateView,
  type WorkbenchVersionSummary,
} from "@langwatch/experiment-contract";
import { Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import {
  ArchivedExperimentWriteError,
  ExperimentRepository,
  type ExperimentRowState,
} from "../experiment.repository";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type ExperimentDatabase = Pick<
  PrismaClient,
  "experiment" | "experimentVersion" | "$transaction"
>;

const mapExperiment = (row: unknown): Experiment => experimentSchema.parse(row);

export class PrismaExperimentRepository extends ExperimentRepository {
  static create(database: ExperimentDatabase): PrismaExperimentRepository {
    return new PrismaExperimentRepository(database);
  }

  private constructor(private readonly database: ExperimentDatabase) {
    super();
  }

  async tryFindById(input: { id: string; projectId: string }): Promise<Experiment | null> {
    const row = await this.database.experiment.findFirst({
      where: { ...input, archivedAt: null },
    });
    return row ? mapExperiment(row) : null;
  }

  async tryFindBySlug(input: {
    slug: string;
    projectId: string;
    type?: ExperimentType;
  }): Promise<Experiment | null> {
    const row = await this.database.experiment.findFirst({
      where: { ...input, archivedAt: null },
    });
    return row ? mapExperiment(row) : null;
  }

  async findAll(input: { projectId: string }): Promise<Experiment[]> {
    const rows = await this.database.experiment.findMany({
      where: { projectId: input.projectId, archivedAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    });
    return rows.map(mapExperiment);
  }

  async findPage(input: { projectId: string; skip: number; take: number }): Promise<Experiment[]> {
    const rows = await this.database.experiment.findMany({
      where: { projectId: input.projectId, archivedAt: null },
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      skip: input.skip,
      take: input.take,
    });
    return rows.map(mapExperiment);
  }

  async count(input: { projectId: string }): Promise<number> {
    return this.database.experiment.count({
      where: { projectId: input.projectId, archivedAt: null },
    });
  }

  async tryFindLatest(input: { projectId: string }): Promise<Experiment | null> {
    const row = await this.database.experiment.findFirst({
      where: { projectId: input.projectId, archivedAt: null },
      orderBy: { createdAt: "desc" },
    });
    return row ? mapExperiment(row) : null;
  }

  async tryFindForWorkflow(input: {
    projectId: string;
    workflowId: string;
  }): Promise<Experiment | null> {
    const row = await this.database.experiment.findFirst({
      where: {
        ...input,
        type: "EVALUATIONS_V3",
        archivedAt: null,
      },
    });
    return row ? mapExperiment(row) : null;
  }

  async tryFindIdBySlug(input: {
    projectId: string;
    slug: string;
  }): Promise<{ id: string; slug: string } | null> {
    return this.database.experiment.findFirst({
      where: { ...input, archivedAt: null },
      select: { id: true, slug: true },
    });
  }

  async getBySlugOrId(input: { projectId: string; slugOrId: string }): Promise<Experiment> {
    const bySlug = await this.database.experiment.findFirst({
      where: { projectId: input.projectId, slug: input.slugOrId, archivedAt: null },
    });
    if (bySlug) {
      return mapExperiment(bySlug);
    }

    const byId = await this.database.experiment.findFirst({
      where: { projectId: input.projectId, id: input.slugOrId, archivedAt: null },
    });
    if (byId) {
      return mapExperiment(byId);
    }

    throw new ExperimentNotFoundError(input.slugOrId);
  }

  async tryGetRowState(input: {
    projectId: string;
    id: string;
  }): Promise<ExperimentRowState | null> {
    const row = await this.database.experiment.findUnique({
      where: { id: input.id, projectId: input.projectId },
      select: { slug: true, workflowId: true, archivedAt: true },
    });
    return row
      ? {
          slug: row.slug,
          workflowId: row.workflowId,
          archived: row.archivedAt !== null,
        }
      : null;
  }

  async findSlugsByPrefix(input: {
    projectId: string;
    slugPrefix: string;
    excludeId?: string;
  }): Promise<string[]> {
    const rows = await this.database.experiment.findMany({
      where: {
        projectId: input.projectId,
        slug: { startsWith: input.slugPrefix },
        ...(input.excludeId ? { id: { not: input.excludeId } } : {}),
      },
      select: { slug: true },
    });
    return rows.map((row) => row.slug);
  }

  async findDraftNames(input: { projectId: string }): Promise<Array<{ name: string | null }>> {
    return this.database.experiment.findMany({
      where: {
        projectId: input.projectId,
        archivedAt: null,
        name: { startsWith: "Draft" },
      },
      select: { name: true },
    });
  }

  async findAllSlugs(input: { projectId: string }): Promise<string[]> {
    const rows = await this.database.experiment.findMany({
      where: { projectId: input.projectId },
      select: { slug: true },
    });
    return rows.map((row) => row.slug);
  }

  async saveActive(input: SaveExperimentInput & { slug: string }): Promise<Experiment> {
    const row = await this.database.$transaction(async (transaction) => {
      const existing = await transaction.experiment.findUnique({
        where: { id: input.id, projectId: input.projectId },
        select: { archivedAt: true },
      });
      if (existing?.archivedAt) {
        throw new ArchivedExperimentWriteError(input.id);
      }

      const workbenchState =
        input.workbenchState === null
          ? Prisma.JsonNull
          : (input.workbenchState as Prisma.InputJsonValue);
      return transaction.experiment.upsert({
        where: { id: input.id, projectId: input.projectId },
        create: {
          id: input.id,
          projectId: input.projectId,
          name: input.name,
          type: input.type,
          slug: input.slug,
          workflowId: input.workflowId ?? null,
          workbenchState,
        },
        update: {
          name: input.name,
          type: input.type,
          slug: input.slug,
          workflowId: input.workflowId ?? null,
          workbenchState,
        },
      });
    });
    return mapExperiment(row);
  }

  async updateWorkbenchState(input: {
    projectId: string;
    id: string;
    workbenchState: SaveExperimentInput["workbenchState"];
  }): Promise<void> {
    await this.database.experiment.update({
      where: { id: input.id, projectId: input.projectId },
      data: {
        workbenchState:
          input.workbenchState === null
            ? Prisma.JsonNull
            : (input.workbenchState as Prisma.InputJsonValue),
      },
    });
  }

  async archiveActive(input: {
    projectId: string;
    id: string;
    archivedSlug: string;
    archivedAt: Date;
  }): Promise<boolean> {
    const result = await this.database.experiment.updateMany({
      where: {
        id: input.id,
        projectId: input.projectId,
        archivedAt: null,
      },
      data: {
        archivedAt: input.archivedAt,
        slug: input.archivedSlug,
      },
    });
    return result.count === 1;
  }

  async getWorkbenchState(input: {
    projectId: string;
    id?: string;
    slug?: string;
  }): Promise<WorkbenchStateView> {
    if (!input.id && !input.slug) throw new ExperimentNotFoundError("");
    const row = await this.database.experiment.findFirst({
      where: {
        projectId: input.projectId,
        archivedAt: null,
        ...(input.id ? { id: input.id } : {}),
        ...(input.slug ? { slug: input.slug } : {}),
      },
      select: {
        id: true,
        slug: true,
        name: true,
        type: true,
        workbenchState: true,
        workbenchVersion: true,
        updatedAt: true,
      },
    });
    if (!row) throw new ExperimentNotFoundError(input.id ?? input.slug ?? "");
    if (row.type !== "EVALUATIONS_V3") throw new ExperimentTypeMismatchError();
    const author = await this.database.experimentVersion.findFirst({
      where: {
        projectId: input.projectId,
        experimentId: row.id,
        counterVersion: row.workbenchVersion,
      },
      select: { authorLabel: true, runId: true },
      orderBy: { counterVersion: "desc" },
    });
    return {
      experimentId: row.id,
      slug: row.slug,
      name: row.name,
      state: row.workbenchState as WorkbenchStateView["state"],
      version: row.workbenchVersion,
      updatedAt: row.updatedAt,
      ...(author ? { actorLabel: author.authorLabel as "user" | "langy" | "api" } : {}),
      ...(author?.runId ? { runId: author.runId } : {}),
    };
  }

  async resolveWorkbenchSaveTarget(input: {
    projectId: string;
    id?: string;
    slug?: string;
  }): Promise<{ kind: "create"; id?: string } | { kind: "update"; state: WorkbenchStateView }> {
    if (input.id) {
      const row = await this.database.experiment.findFirst({
        where: { projectId: input.projectId, id: input.id },
        select: { archivedAt: true },
      });
      if (!row) {
        return { kind: "create", id: input.id };
      }
      if (row.archivedAt) {
        throw new ExperimentNotFoundError(input.id);
      }

      return {
        kind: "update",
        state: await this.getWorkbenchState({ projectId: input.projectId, id: input.id }),
      };
    }

    if (input.slug) {
      return {
        kind: "update",
        state: await this.getWorkbenchState({ projectId: input.projectId, slug: input.slug }),
      };
    }

    return { kind: "create" };
  }

  async writeWorkbenchState(input: {
    projectId: string;
    id: string;
    name: string;
    state: unknown;
    snapshot: unknown;
    expectedVersion?: number;
    actor: WorkbenchActor;
    commitMessage?: string;
  }) {
    return await this.database.$transaction(async (transaction) => {
      const row = await transaction.experiment.findFirst({
        where: { id: input.id, projectId: input.projectId, archivedAt: null },
        select: { id: true, slug: true, type: true, workbenchVersion: true },
      });
      if (!row) throw new ExperimentNotFoundError(input.id);
      if (row.type !== "EVALUATIONS_V3") throw new ExperimentTypeMismatchError();
      if (input.expectedVersion !== undefined && input.expectedVersion !== row.workbenchVersion) {
        return await this.staleWorkbenchWrite(transaction, input.projectId, row.id);
      }
      const nextVersion = row.workbenchVersion + 1;
      const updated = await transaction.experiment.updateMany({
        where: {
          id: row.id,
          projectId: input.projectId,
          archivedAt: null,
          workbenchVersion: row.workbenchVersion,
        },
        data: {
          name: input.name,
          workbenchState: input.state as Prisma.InputJsonValue,
          workbenchVersion: nextVersion,
        },
      });
      if (updated.count === 0) {
        return await this.staleWorkbenchWrite(transaction, input.projectId, row.id);
      }
      const rolling = await transaction.experimentVersion.findFirst({
        where: { projectId: input.projectId, experimentId: row.id, autoSaved: true },
        select: { id: true },
        orderBy: { counterVersion: "desc" },
      });
      const autoSaved = input.actor.label === "user" && !input.commitMessage;
      if (autoSaved && rolling) {
        await transaction.experimentVersion.update({
          where: { id: rolling.id, projectId: input.projectId },
          data: {
            version: nextVersion,
            counterVersion: nextVersion,
            state: input.snapshot as Prisma.InputJsonValue,
            authorId: input.actor.userId ?? null,
            authorLabel: input.actor.label,
            runId: input.actor.runId ?? null,
            commitMessage: null,
            schemaVersion: "1",
          },
        });
      } else {
        if (rolling) {
          await transaction.experimentVersion.update({
            where: { id: rolling.id, projectId: input.projectId },
            data: { version: nextVersion },
          });
        }
        const highest = await transaction.experimentVersion.findFirst({
          where: { projectId: input.projectId, experimentId: row.id, autoSaved: false },
          select: { version: true },
          orderBy: { version: "desc" },
        });
        await transaction.experimentVersion.create({
          data: {
            projectId: input.projectId,
            experimentId: row.id,
            version: autoSaved ? nextVersion : (highest?.version ?? 0) + 1,
            counterVersion: nextVersion,
            autoSaved,
            commitMessage: input.commitMessage ?? null,
            authorId: input.actor.userId ?? null,
            authorLabel: input.actor.label,
            runId: input.actor.runId ?? null,
            state: input.snapshot as Prisma.InputJsonValue,
            schemaVersion: "1",
          },
        });
      }
      return { kind: "saved" as const, experimentId: row.id, slug: row.slug, version: nextVersion };
    });
  }

  async createWorkbenchState(input: {
    projectId: string;
    id: string;
    slug: string;
    name: string;
    state: unknown;
    snapshot: unknown;
    actor: WorkbenchActor;
    commitMessage?: string;
  }): Promise<{ id: string; slug: string }> {
    await this.database.$transaction(async (transaction) => {
      await transaction.experiment.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          slug: input.slug,
          name: input.name,
          type: "EVALUATIONS_V3",
          workbenchState: input.state as Prisma.InputJsonValue,
          workbenchVersion: 1,
        },
      });
      await transaction.experimentVersion.create({
        data: {
          projectId: input.projectId,
          experimentId: input.id,
          version: 1,
          counterVersion: 1,
          autoSaved: false,
          commitMessage: input.commitMessage ?? null,
          authorId: input.actor.userId ?? null,
          authorLabel: input.actor.label,
          runId: input.actor.runId ?? null,
          state: input.snapshot as Prisma.InputJsonValue,
          schemaVersion: "1",
        },
      });
    });
    return { id: input.id, slug: input.slug };
  }

  async listWorkbenchVersions(input: {
    projectId: string;
    experimentId: string;
    take: number;
    beforeCounterVersion?: number;
  }): Promise<WorkbenchVersionSummary[]> {
    return await this.database.experimentVersion.findMany({
      where: {
        projectId: input.projectId,
        experimentId: input.experimentId,
        ...(input.beforeCounterVersion === undefined
          ? {}
          : { counterVersion: { lt: input.beforeCounterVersion } }),
      },
      select: {
        version: true,
        counterVersion: true,
        autoSaved: true,
        commitMessage: true,
        authorId: true,
        authorLabel: true,
        createdAt: true,
        updatedAt: true,
      },
      orderBy: { counterVersion: "desc" },
      take: input.take,
    });
  }

  async getWorkbenchVersion(input: {
    projectId: string;
    experimentId: string;
    version: number;
  }): Promise<{ autoSaved: boolean; state: unknown }> {
    const found = await this.database.experimentVersion.findFirst({
      where: input,
      select: { autoSaved: true, state: true },
    });
    if (!found) {
      throw new ExperimentVersionNotFoundError({
        experimentId: input.experimentId,
        version: input.version,
      });
    }
    return found;
  }

  private async staleWorkbenchWrite(
    transaction: Prisma.TransactionClient,
    projectId: string,
    experimentId: string,
  ) {
    const row = await transaction.experiment.findFirst({
      where: { id: experimentId, projectId, archivedAt: null },
      select: { workbenchVersion: true },
    });
    if (!row) throw new ExperimentNotFoundError(experimentId);
    const author = await transaction.experimentVersion.findFirst({
      where: { projectId, experimentId, counterVersion: row.workbenchVersion },
      select: { authorLabel: true, runId: true },
      orderBy: { counterVersion: "desc" },
    });
    return {
      kind: "stale" as const,
      currentVersion: row.workbenchVersion,
      ...(author ? { actorLabel: author.authorLabel } : {}),
      ...(author?.runId ? { runId: author.runId } : {}),
    };
  }
}
