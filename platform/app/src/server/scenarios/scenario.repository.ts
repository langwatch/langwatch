import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import type {
  Prisma,
  PrismaClient,
  Scenario,
  ScenarioVersion,
} from "~/generated/prisma/client";
import { KSUID_RESOURCES } from "~/utils/constants";

const tracer = getLangWatchTracer("langwatch.scenarios.repository");
const logger = createLogger("langwatch:scenarios:repository");

export type CreateScenarioInput = Omit<
  Prisma.ScenarioUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt" | "archivedAt"
>;

export type UpdateScenarioInput = Partial<
  Omit<CreateScenarioInput, "projectId">
>;

/** What a run reads off a scenario before it schedules any job for it. */
export type ScenarioRunConfig = {
  id: string;
  name: string;
  situation: string;
  criteria: string[];
  /** The declared parameters, as stored. Read with `parseScenarioParameterDefinitions`. */
  parameters: Prisma.JsonValue;
  /**
   * The version at the moment of this read. Stamped onto every run queued
   * from it, so a run says which state of the scenario produced it.
   */
  version: number;
};

/**
 * The client a repository write runs on: the repository's own PrismaClient by
 * default, or the caller's transaction client when the write must land with
 * other writes (test suite membership reconciliation, version rows) or not at all.
 */
type ScenarioWriteClient = Pick<
  Prisma.TransactionClient,
  "scenario" | "scenarioVersion"
>;

export class ScenarioRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateScenarioInput,
    tx?: ScenarioWriteClient,
  ): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioRepository.create",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "INSERT",
          "db.table": "Scenario",
          "tenant.id": input.projectId,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: input.projectId, operation: "INSERT" },
          "Inserting scenario",
        );
        const result = await (tx ?? this.prisma).scenario.create({
          data: {
            id: generate(KSUID_RESOURCES.SCENARIO).toString(),
            ...input,
          },
        });
        span.setAttribute("scenario.id", result.id);
        return result;
      },
    );
  }

  async findById(input: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null> {
    return tracer.withActiveSpan(
      "ScenarioRepository.findById",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "SELECT",
          "db.table": "Scenario",
          "tenant.id": input.projectId,
          "scenario.id": input.id,
        },
      },
      async (span) => {
        logger.debug(
          {
            projectId: input.projectId,
            scenarioId: input.id,
            operation: "SELECT",
          },
          "Finding scenario by id",
        );
        const result = await this.prisma.scenario.findFirst({
          where: {
            id: input.id,
            projectId: input.projectId,
            archivedAt: null,
          },
        });
        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  /**
   * Find a scenario by ID regardless of its archived status.
   * Used for viewing run results of scenarios that may have been archived.
   */
  async findByIdIncludingArchived(input: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null> {
    return tracer.withActiveSpan(
      "ScenarioRepository.findByIdIncludingArchived",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "SELECT",
          "db.table": "Scenario",
          "tenant.id": input.projectId,
          "scenario.id": input.id,
        },
      },
      async (span) => {
        logger.debug(
          {
            projectId: input.projectId,
            scenarioId: input.id,
            operation: "SELECT",
          },
          "Finding scenario by id including archived",
        );
        const result = await this.prisma.scenario.findFirst({
          where: {
            id: input.id,
            projectId: input.projectId,
          },
        });
        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  /**
   * All scenarios filed in a test suite, archived ones included, oldest first.
   *
   * The run path reads membership from here rather than from the test suite's
   * denormalized scenarioIds: that cache holds only active members, and a run
   * reports the archived ones as skipped.
   */
  async findManyByTestSuite(input: {
    projectId: string;
    testSuiteId: string;
  }): Promise<{ id: string; archivedAt: Date | null }[]> {
    return this.prisma.scenario.findMany({
      where: { projectId: input.projectId, testSuiteId: input.testSuiteId },
      select: { id: true, archivedAt: true },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Archives every active scenario filed in the test suite, in the caller's
   * transaction. Scenarios keep their testSuiteId so the archived test suite reads
   * back with the membership it had. Already-archived scenarios are left
   * untouched, original archive time included.
   */
  async archiveManyByTestSuite(input: {
    projectId: string;
    testSuiteId: string;
    tx: ScenarioWriteClient;
  }): Promise<number> {
    const result = await input.tx.scenario.updateMany({
      where: {
        projectId: input.projectId,
        testSuiteId: input.testSuiteId,
        archivedAt: null,
      },
      data: { archivedAt: new Date() },
    });
    return result.count;
  }

  /**
   * Find multiple scenarios by IDs regardless of archived status.
   * Returns id, archivedAt and testSuiteId for lightweight classification.
   */
  async findManyIncludingArchived(input: {
    ids: string[];
    projectId: string;
  }): Promise<
    { id: string; archivedAt: Date | null; testSuiteId: string | null }[]
  > {
    return tracer.withActiveSpan(
      "ScenarioRepository.findManyIncludingArchived",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "SELECT",
          "db.table": "Scenario",
          "tenant.id": input.projectId,
        },
      },
      async (span) => {
        logger.debug(
          {
            projectId: input.projectId,
            idCount: input.ids.length,
            operation: "SELECT",
          },
          "Finding scenarios by ids including archived",
        );
        const results = await this.prisma.scenario.findMany({
          where: {
            id: { in: input.ids },
            projectId: input.projectId,
          },
          select: { id: true, archivedAt: true, testSuiteId: true },
        });
        span.setAttribute("result.count", results.length);
        return results;
      },
    );
  }

  async findAll(input: { projectId: string }): Promise<Scenario[]> {
    return tracer.withActiveSpan(
      "ScenarioRepository.findAll",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "SELECT",
          "db.table": "Scenario",
          "tenant.id": input.projectId,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: input.projectId, operation: "SELECT" },
          "Finding all scenarios",
        );
        const result = await this.prisma.scenario.findMany({
          where: {
            projectId: input.projectId,
            archivedAt: null,
          },
          orderBy: { updatedAt: "desc" },
        });
        span.setAttribute("result.count", result.length);
        return result;
      },
    );
  }

  /**
   * Find scenario names by IDs regardless of archived status.
   * Used for displaying human-readable names in UI warnings.
   */
  async findNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.prisma.scenario.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: { id: true, name: true },
    });
  }

  /**
   * The names of the given scenarios, archived ones left out.
   *
   * A test suite's detail view reads its members through this: the test suite's
   * `scenarioIds` cache holds active members, and an archived test suite keeps a
   * snapshot that may name scenarios archived since, which the view must not show.
   */
  async findActiveNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.prisma.scenario.findMany({
      where: {
        id: { in: input.ids },
        projectId: input.projectId,
        archivedAt: null,
      },
      select: { id: true, name: true },
    });
  }

  /**
   * Find everything a run needs to know about a scenario before scheduling it:
   * its name for the queued row, the parameters it declares, and the text those
   * parameters are rendered into.
   *
   * Archived scenarios are included so a caller that resolved them separately
   * (a suite run classifies archived references itself) sees one consistent
   * set of rows.
   */
  async findRunConfigByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioRunConfig[]> {
    return this.prisma.scenario.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: {
        id: true,
        name: true,
        situation: true,
        criteria: true,
        parameters: true,
        version: true,
      },
    });
  }

  async update(params: {
    id: string;
    projectId: string;
    data: UpdateScenarioInput;
    tx?: ScenarioWriteClient;
  }): Promise<Scenario> {
    const { id, projectId, data, tx } = params;
    return tracer.withActiveSpan(
      "ScenarioRepository.update",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "UPDATE",
          "db.table": "Scenario",
          "tenant.id": projectId,
          "scenario.id": id,
        },
      },
      async () => {
        logger.debug(
          { projectId, scenarioId: id, operation: "UPDATE" },
          "Updating scenario",
        );
        return (tx ?? this.prisma).scenario.update({
          where: { id, projectId },
          data,
        });
      },
    );
  }

  /**
   * Updates a scenario and moves its version counter one up, in one UPDATE.
   *
   * With `expectedVersion` the version rides in the WHERE, which is the
   * compare-and-set itself: a racing writer that already bumped it makes this
   * update match no row, and Prisma raises P2025 rather than overwriting the
   * newer save. Without it the counter increments atomically, so two callers
   * that both asked for "save over whatever is there" get two numbers.
   */
  async updateWithVersionBump(params: {
    id: string;
    projectId: string;
    data: UpdateScenarioInput;
    tx: ScenarioWriteClient;
    expectedVersion?: number;
  }): Promise<Scenario> {
    const { id, projectId, data, tx, expectedVersion } = params;
    return tracer.withActiveSpan(
      "ScenarioRepository.updateWithVersionBump",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "UPDATE",
          "db.table": "Scenario",
          "tenant.id": projectId,
          "scenario.id": id,
        },
      },
      async () =>
        tx.scenario.update({
          where: {
            id,
            projectId,
            archivedAt: null,
            ...(expectedVersion !== undefined
              ? { version: expectedVersion }
              : {}),
          },
          data: {
            ...data,
            version:
              expectedVersion !== undefined
                ? expectedVersion + 1
                : { increment: 1 },
          },
        }),
    );
  }

  /** Appends one version row. The unique (scenarioId, version) backstops it. */
  async createVersionRow(
    data: Prisma.ScenarioVersionUncheckedCreateInput,
    tx: ScenarioWriteClient,
  ): Promise<void> {
    await tx.scenarioVersion.create({ data });
  }

  /**
   * A page of version rows, newest first. `beforeVersion` pages below a
   * version number.
   */
  async findVersions(input: {
    projectId: string;
    scenarioId: string;
    take: number;
    beforeVersion?: number;
  }): Promise<ScenarioVersion[]> {
    return this.prisma.scenarioVersion.findMany({
      where: {
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        ...(input.beforeVersion !== undefined
          ? { version: { lt: input.beforeVersion } }
          : {}),
      },
      orderBy: { version: "desc" },
      take: input.take,
    });
  }

  /** One version row by number, or null when the number names none. */
  async findVersionByNumber(input: {
    projectId: string;
    scenarioId: string;
    version: number;
  }): Promise<ScenarioVersion | null> {
    return this.prisma.scenarioVersion.findFirst({
      where: {
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        version: input.version,
      },
    });
  }

  /**
   * Soft-archive a scenario by setting its archivedAt timestamp.
   * Returns the updated scenario, or null if not found for the given project.
   */
  async archive({
    id,
    projectId,
    tx,
  }: {
    id: string;
    projectId: string;
    tx?: ScenarioWriteClient;
  }): Promise<Scenario | null> {
    return tracer.withActiveSpan(
      "ScenarioRepository.archive",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "UPDATE",
          "db.table": "Scenario",
          "tenant.id": projectId,
          "scenario.id": id,
        },
      },
      async (span) => {
        logger.debug(
          { projectId, scenarioId: id, operation: "UPDATE" },
          "Archiving scenario",
        );
        const db = tx ?? this.prisma;
        const scenario = await db.scenario.findFirst({
          where: { id, projectId },
        });
        if (!scenario) {
          span.setAttribute("result.found", false);
          return null;
        }
        // Idempotent: if already archived, preserve the original timestamp
        const result = await db.scenario.update({
          where: { id, projectId },
          data: { archivedAt: scenario.archivedAt ?? new Date() },
        });
        span.setAttribute("result.found", true);
        return result;
      },
    );
  }
}
