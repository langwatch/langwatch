import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import {
  suiteSchema,
  type CreateSuiteCommand,
  type Suite,
  type SuiteIdInput,
  type UpdateSuiteCommand,
} from "@langwatch/suite-contract";
import { SuiteRepository } from "../suite.repository";

export type SuiteDatabase = Pick<PrismaClient, "simulationSuite">;

function mapSuite(row: unknown): Suite {
  const parsed = suiteSchema.parse(row);
  return parsed;
}

export class PrismaSuiteRepository extends SuiteRepository {
  static create(database: SuiteDatabase): PrismaSuiteRepository {
    return new PrismaSuiteRepository(database);
  }

  private constructor(private readonly database: SuiteDatabase) {
    super();
  }

  async create(input: CreateSuiteCommand & { id: string; slug: string }): Promise<Suite> {
    const row = await this.database.simulationSuite.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        slug: input.slug,
        description: input.description ?? null,
        scenarioIds: input.scenarioIds,
        targets: input.targets as Prisma.InputJsonValue,
        repeatCount: input.repeatCount,
        labels: input.labels,
        simulatorModel: input.simulatorModel ?? null,
        judgeModel: input.judgeModel ?? null,
      },
    });
    return mapSuite(row);
  }

  async list(input: { projectId: string }): Promise<Suite[]> {
    const rows = await this.database.simulationSuite.findMany({
      where: { projectId: input.projectId, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(mapSuite);
  }

  async tryFindById(input: SuiteIdInput): Promise<Suite | null> {
    const row = await this.database.simulationSuite.findFirst({
      where: { id: input.id, projectId: input.projectId, archivedAt: null },
    });
    return row ? mapSuite(row) : null;
  }

  async tryFindBySlug(input: { projectId: string; slug: string }): Promise<Suite | null> {
    const row = await this.database.simulationSuite.findFirst({
      where: { projectId: input.projectId, slug: input.slug, archivedAt: null },
    });
    return row ? mapSuite(row) : null;
  }

  async update(input: UpdateSuiteCommand & { slug?: string }): Promise<Suite> {
    const { id, projectId, slug, ...data } = input;
    const row = await this.database.simulationSuite.update({
      where: { id, projectId, archivedAt: null },
      data: {
        ...data,
        ...(slug === undefined ? {} : { slug }),
        ...(data.targets === undefined
          ? {}
          : { targets: data.targets as Prisma.InputJsonValue }),
      },
    });
    return mapSuite(row);
  }

  async archive(
    input: SuiteIdInput & { archivedAt: Date; archivedSlug: string },
  ): Promise<Suite> {
    const row = await this.database.simulationSuite.update({
      where: { id: input.id, projectId: input.projectId },
      data: { archivedAt: input.archivedAt, slug: input.archivedSlug },
    });
    return mapSuite(row);
  }
}
