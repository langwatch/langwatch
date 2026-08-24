import {
  experimentSchema,
  type Experiment,
  type ExperimentType,
  type SaveExperimentInput,
} from "@langwatch/experiment-contract";
import {
  Prisma,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import {
  ExperimentRepository,
  type ExperimentRowState,
} from "../experiment.repository";

export type ExperimentDatabase = Pick<PrismaClient, "experiment" | "$transaction">;

const mapExperiment = (row: unknown): Experiment => experimentSchema.parse(row);

export class ArchivedExperimentWriteError extends Error {
  constructor(readonly experimentId: string) {
    super("Archived experiments cannot be changed");
    this.name = "ArchivedExperimentWriteError";
  }
}

export class PrismaExperimentRepository extends ExperimentRepository {
  static create(database: ExperimentDatabase): PrismaExperimentRepository {
    return new PrismaExperimentRepository(database);
  }

  private constructor(private readonly database: ExperimentDatabase) {
    super();
  }

  async tryFindById(input: {
    id: string;
    projectId: string;
  }): Promise<Experiment | null> {
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

  async findPage(input: {
    projectId: string;
    skip: number;
    take: number;
  }): Promise<Experiment[]> {
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

  async tryFindLatest(input: {
    projectId: string;
  }): Promise<Experiment | null> {
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

  async findDraftNames(input: {
    projectId: string;
  }): Promise<Array<{ name: string | null }>> {
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

  async saveActive(
    input: SaveExperimentInput & { slug: string },
  ): Promise<Experiment> {
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
}
