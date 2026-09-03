import { type Prisma, type PrismaClient } from "@langwatch/prisma-client/generated";
import { isUniqueConstraintError } from "@langwatch/prisma-client";
import {
  parseSuiteScope,
  suiteSchema,
  SuiteNotFoundError,
  type CreateSuiteCommand,
  type RunPlanConfigInput,
  type Suite,
  type SuiteIdInput,
  type SuiteScope,
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

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "run-plan"
  );
}

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type SuiteDatabase = Pick<
  PrismaClient,
  "scenario" | "simulationSuite" | "$transaction" | "$executeRaw"
>;

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
        kind: "run_plan",
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
      where: { projectId: input.projectId, kind: "run_plan", archivedAt: null },
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
          kind: "run_plan",
          archivedAt: null,
        },
        select: { scenarioIds: true, scope: true },
      });
      if (!suite) {
        throw new SuiteNotFoundError(input.id);
      }

      const scope = parseSuiteScope(suite.scope);
      if (scope.mode === "scenarios") {
        return suite.scenarioIds;
      }

      const scenarios = await transaction.scenario.findMany({
        where: {
          projectId: input.projectId,
          archivedAt: null,
          ...(scope.mode === "test_suites" ? { testSuiteId: { in: scope.testSuiteIds } } : {}),
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

  async resolveScopeMembership(input: {
    projectId: string;
    scope: SuiteScope;
  }): Promise<string[]> {
    if (input.scope.mode === "scenarios") return [];
    if (input.scope.mode === "all") {
      const scenarios = await this.database.scenario.findMany({
        where: { projectId: input.projectId, archivedAt: null },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      return scenarios.map((scenario) => scenario.id);
    }

    const scenarios = await this.database.scenario.findMany({
      where: {
        projectId: input.projectId,
        archivedAt: null,
        ...(input.scope.mode === "test_suites"
          ? { testSuiteId: { in: input.scope.testSuiteIds } }
          : {}),
        ...(input.scope.mode === "labels" ? { labels: { hasSome: input.scope.labels } } : {}),
      },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    return scenarios.map((scenario) => scenario.id);
  }

  async findOrCreatePlanByName(input: {
    id: string;
    projectId: string;
    name: string;
    scope: SuiteScope;
    targets: Suite["targets"];
    scenarioIds: string[];
    config: RunPlanConfigInput;
  }): Promise<{ suite: Suite; created: boolean }> {
    const storedConfig = {
      scope: input.scope as unknown as Prisma.InputJsonValue,
      targets: input.targets as Prisma.InputJsonValue,
      repeatCount: input.config.repeatCount ?? 1,
      simulatorModel: input.config.simulatorModel ?? null,
      judgeModel: input.config.judgeModel ?? null,
      scenarioIds: input.scenarioIds,
    };
    const baseSlug = slugify(input.name) || "run-plan";

    const resolveUnderLock = () =>
      this.database.$transaction(async (transaction) => {
        const lockKey = `suite-plan-name:${input.projectId}:${input.name.trim().toLowerCase()}`;
        await transaction.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

        const existing = await transaction.simulationSuite.findFirst({
          where: {
            projectId: input.projectId,
            kind: "run_plan",
            archivedAt: null,
            name: { equals: input.name.trim(), mode: "insensitive" },
          },
          orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
        });
        if (existing) {
          const row = await transaction.simulationSuite.update({
            where: { id: existing.id, projectId: input.projectId },
            data: storedConfig,
          });
          return { suite: mapSuite(row), created: false };
        }

        const slugRows = await transaction.simulationSuite.findMany({
          where: {
            projectId: input.projectId,
            slug: { startsWith: baseSlug },
            archivedAt: null,
          },
          select: { slug: true },
        });
        const slug = nextAvailableSlug(
          baseSlug,
          slugRows.map((candidate) => candidate.slug),
        );
        const row = await transaction.simulationSuite.create({
          data: {
            id: input.id,
            projectId: input.projectId,
            name: input.name.trim(),
            slug,
            kind: "run_plan",
            labels: [],
            ...storedConfig,
          },
        });
        return { suite: mapSuite(row), created: true };
      });

    try {
      return await resolveUnderLock();
    } catch (error) {
      // The name lock holds two runs of ONE name apart, so a slug taken here
      // was taken by a plan of another name that slugifies the same way. A
      // failed statement aborts its transaction, so the retry is the whole
      // locked block, which picks a free slug on its second read.
      if (isUniqueConstraintError(error)) {
        return await resolveUnderLock();
      }
      throw error;
    }
  }

  async tryFindById(input: SuiteIdInput): Promise<Suite | null> {
    const row = await this.database.simulationSuite.findFirst({
      where: {
        id: input.id,
        projectId: input.projectId,
        kind: "run_plan",
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
        kind: "run_plan",
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
          kind: "run_plan",
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
          kind: "run_plan",
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
      where: { id, projectId, kind: "run_plan", archivedAt: null },
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
      where: { id: input.id, projectId: input.projectId, kind: "run_plan" },
      data: { archivedAt: input.archivedAt, slug: input.archivedSlug },
    });
    return mapSuite(row);
  }
}
