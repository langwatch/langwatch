import { type Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import {
  parseSuiteScope,
  suiteSchema,
  SuiteNotFoundError,
  type CreateSuiteCommand,
  type Suite,
  type SuiteIdInput,
  type UpdateSuiteCommand,
} from "@langwatch/suite-contract";
import { SuiteRepository } from "../suite.repository";

function mapSuite(row: unknown): Suite {
  const parsed = suiteSchema.parse(row);
  return parsed;
}

function nextAvailableSlug(baseSlug: string, existingSlugs: string[]): string {
  const existing = new Set(existingSlugs);
  if (!existing.has(baseSlug)) return baseSlug;

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${baseSlug}-${suffix}`;
    if (!existing.has(candidate)) return candidate;
  }
}

export class PrismaSuiteRepository extends SuiteRepository {
  static create(database: PrismaClient): PrismaSuiteRepository {
    return new PrismaSuiteRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {
    super();
  }

  async create(input: CreateSuiteCommand & { id: string; slug: string }): Promise<Suite> {
    const row = await this.database.simulationSuite.create({
      data: {
        id: input.id,
        projectId: input.projectId,
        name: input.name,
        slug: input.slug,
        kind: "custom",
        description: input.description ?? null,
        scenarioIds: input.scenarioIds,
        scope: input.scope ? (input.scope as Prisma.InputJsonValue) : void 0,
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
      where: { projectId: input.projectId, kind: "custom", archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(mapSuite);
  }

  async resolveDynamicRunMembership(input: SuiteIdInput): Promise<string[]> {
    return this.database.$transaction(async (transaction) => {
      await transaction.$executeRaw`
        SELECT id
        FROM "SimulationSuite"
        WHERE id = ${input.id}
          AND "projectId" = ${input.projectId}
          AND kind = 'custom'
          AND "archivedAt" IS NULL
        FOR UPDATE
      `;

      const suite = await transaction.simulationSuite.findFirst({
        where: {
          id: input.id,
          projectId: input.projectId,
          kind: "custom",
          archivedAt: null,
        },
        select: { scenarioIds: true, scope: true },
      });
      if (!suite) {
        throw new SuiteNotFoundError(input.id);
      }

      const scope = parseSuiteScope(suite.scope);
      if (scope.mode === "cases") {
        return suite.scenarioIds;
      }

      const scenarios = await transaction.scenario.findMany({
        where: {
          projectId: input.projectId,
          archivedAt: null,
          ...(scope.mode === "folders" ? { folderId: { in: scope.folderIds } } : {}),
          ...(scope.mode === "labels" ? { labels: { hasSome: scope.labels } } : {}),
        },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      const scenarioIds = scenarios.map((scenario) => scenario.id);

      await transaction.simulationSuite.update({
        where: { id: input.id, projectId: input.projectId },
        data: { scenarioIds },
      });
      return scenarioIds;
    });
  }

  async tryFindById(input: SuiteIdInput): Promise<Suite | null> {
    const row = await this.database.simulationSuite.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
        kind: "custom",
        archivedAt: null,
      },
    });
    return row ? mapSuite(row) : null;
  }

  async tryFindBySlug(input: { projectId: string; slug: string }): Promise<Suite | null> {
    const row = await this.database.simulationSuite.findFirst({
      where: {
        projectId: input.projectId,
        slug: input.slug,
        kind: "custom",
        archivedAt: null,
      },
    });
    return row ? mapSuite(row) : null;
  }

  async saveManagedRunAll(input: {
    id: string;
    projectId: string;
    name: string;
    baseSlug: string;
    label: string;
    scenarioIds: string[];
    targets?: Suite["targets"];
  }): Promise<Suite> {
    const row = await this.database.$transaction(async (transaction) => {
      const lockKey = `suite-managed:${input.projectId}:${input.label}`;
      await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

      const existing = await transaction.simulationSuite.findFirst({
        where: {
          projectId: input.projectId,
          labels: { has: input.label },
          kind: "custom",
          archivedAt: null,
        },
        orderBy: { createdAt: "asc" },
      });
      if (existing) {
        return transaction.simulationSuite.update({
          where: { id: existing.id, projectId: input.projectId },
          data: {
            scenarioIds: input.scenarioIds,
            ...(input.targets === void 0
              ? {}
              : { targets: input.targets as Prisma.InputJsonValue }),
          },
        });
      }

      const slugRows = await transaction.simulationSuite.findMany({
        where: {
          projectId: input.projectId,
          slug: { startsWith: input.baseSlug },
          archivedAt: null,
        },
        select: { slug: true },
      });
      const slug = nextAvailableSlug(
        input.baseSlug,
        slugRows.map((candidate) => candidate.slug),
      );
      return transaction.simulationSuite.create({
        data: {
          id: input.id,
          projectId: input.projectId,
          name: input.name,
          slug,
          kind: "custom",
          scenarioIds: input.scenarioIds,
          targets: (input.targets ?? []) as Prisma.InputJsonValue,
          repeatCount: 1,
          labels: [input.label],
        },
      });
    });
    return mapSuite(row);
  }

  async update(input: UpdateSuiteCommand & { slug?: string }): Promise<Suite> {
    const { id, projectId, slug, scope, targets, ...data } = input;
    const row = await this.database.simulationSuite.update({
      where: { id, projectId, kind: "custom", archivedAt: null },
      data: {
        ...data,
        ...(slug === void 0 ? {} : { slug }),
        ...(scope === void 0 ? {} : { scope: scope as Prisma.InputJsonValue }),
        ...(targets === void 0 ? {} : { targets: targets as Prisma.InputJsonValue }),
      },
    });
    return mapSuite(row);
  }

  async archive(input: SuiteIdInput & { archivedAt: Date; archivedSlug: string }): Promise<Suite> {
    const row = await this.database.simulationSuite.update({
      where: { id: input.id, projectId: input.projectId, kind: "custom" },
      data: { archivedAt: input.archivedAt, slug: input.archivedSlug },
    });
    return mapSuite(row);
  }
}
