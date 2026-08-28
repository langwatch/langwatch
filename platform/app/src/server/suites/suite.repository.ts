/**
 * Repository for SimulationSuite persistence.
 *
 * Handles all database operations for suite configurations.
 * Uses the Repository pattern consistent with ScenarioRepository.
 */

import { createLogger } from "@langwatch/observability";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { nanoid } from "nanoid";
import type {
  Prisma,
  PrismaClient,
  SimulationSuite,
} from "~/generated/prisma/client";
import { ARCHIVED_SLUG_SUFFIX, CLI_EPHEMERAL_LABEL } from "./constants";
import type { SuiteKind } from "./types";

/**
 * The client a repository write runs on: the repository's own PrismaClient by
 * default, or the caller's transaction client when the write must land with
 * other writes (a folder archive cascade) or not at all.
 */
type SuiteWriteClient = Pick<Prisma.TransactionClient, "simulationSuite">;

const tracer = getLangWatchTracer("langwatch.suites.repository");
const logger = createLogger("langwatch:suites:repository");

export type CreateSuiteInput = Omit<
  Prisma.SimulationSuiteUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt" | "archivedAt"
>;

export type UpdateSuiteInput = Partial<Omit<CreateSuiteInput, "projectId">>;

export class SuiteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateSuiteInput,
    options?: { tx?: SuiteWriteClient },
  ): Promise<SimulationSuite> {
    return tracer.withActiveSpan(
      "SuiteRepository.create",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "INSERT",
          "db.table": "SimulationSuite",
          "tenant.id": input.projectId,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: input.projectId, operation: "INSERT" },
          "Inserting suite",
        );
        const result = await (
          options?.tx ?? this.prisma
        ).simulationSuite.create({
          data: {
            id: `suite_${nanoid()}`,
            ...input,
          },
        });
        span.setAttribute("suite.id", result.id);
        return result;
      },
    );
  }

  async findById(params: {
    id: string;
    projectId: string;
  }): Promise<SimulationSuite | null> {
    return tracer.withActiveSpan(
      "SuiteRepository.findById",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "SELECT",
          "db.table": "SimulationSuite",
          "tenant.id": params.projectId,
          "suite.id": params.id,
        },
      },
      async (span) => {
        logger.debug(
          {
            projectId: params.projectId,
            suiteId: params.id,
            operation: "SELECT",
          },
          "Finding suite by id",
        );
        const result = await this.prisma.simulationSuite.findFirst({
          where: {
            id: params.id,
            projectId: params.projectId,
            archivedAt: null,
          },
        });
        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  /**
   * Find a non-archived suite by its slug within a project.
   * Used for slug conflict detection and future API lookup.
   */
  async findBySlug(params: {
    slug: string;
    projectId: string;
  }): Promise<SimulationSuite | null> {
    return tracer.withActiveSpan(
      "SuiteRepository.findBySlug",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "SELECT",
          "db.table": "SimulationSuite",
          "tenant.id": params.projectId,
          "suite.slug": params.slug,
        },
      },
      async (span) => {
        logger.debug(
          {
            projectId: params.projectId,
            slug: params.slug,
            operation: "SELECT",
          },
          "Finding suite by slug",
        );
        const result = await this.prisma.simulationSuite.findFirst({
          where: {
            slug: params.slug,
            projectId: params.projectId,
            archivedAt: null,
          },
        });
        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  /**
   * The project's suites of the given kinds, newest first.
   *
   * Archived rows are left out unless the caller asks for them: a list that
   * shows what is running now must not offer a plan somebody archived, while
   * a history view has to resolve the plan a finished run belongs to.
   */
  async findAll(params: {
    projectId: string;
    kinds: SuiteKind[];
    includeArchived?: boolean;
  }): Promise<SimulationSuite[]> {
    return tracer.withActiveSpan(
      "SuiteRepository.findAll",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "SELECT",
          "db.table": "SimulationSuite",
          "tenant.id": params.projectId,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: params.projectId, operation: "SELECT" },
          "Finding all suites",
        );
        const result = await this.prisma.simulationSuite.findMany({
          where: {
            projectId: params.projectId,
            kind: { in: params.kinds },
            ...(params.includeArchived !== true && { archivedAt: null }),
          },
          orderBy: { updatedAt: "desc" },
        });
        span.setAttribute("result.count", result.length);
        return result;
      },
    );
  }

  /**
   * Slugs of non-archived suites whose slug starts with the prefix.
   * Feeds the numeric-suffix retry that keeps folder and plan slugs unique
   * inside their shared per-project namespace.
   */
  async findSlugsByPrefix(params: {
    projectId: string;
    slugPrefix: string;
    tx?: SuiteWriteClient;
  }): Promise<string[]> {
    const rows = await (params.tx ?? this.prisma).simulationSuite.findMany({
      where: {
        projectId: params.projectId,
        slug: { startsWith: params.slugPrefix },
        archivedAt: null,
      },
      select: { slug: true },
    });
    return rows.map((row) => row.slug);
  }

  /**
   * The run plan this name resolves to, or null.
   *
   * A run plan is identified by its NAME, compared trimmed and without case.
   * `name` carries no unique constraint and never has, so a project may already
   * hold two plans of one name: the most recently used one wins, and the
   * ordering is total so the answer does not move between reads. Every run
   * through this path replaces the matched plan's config, which moves
   * `updatedAt`, so "most recently used" is what a person means by the name.
   *
   * Skipped on purpose: archived plans, folders, and the command line's
   * throwaway suites, which it archives as soon as the run is queued.
   *
   * @see specs/suites/run-plan-identity-by-name.feature
   */
  async findPlanByName(params: {
    projectId: string;
    name: string;
    tx?: SuiteWriteClient;
  }): Promise<SimulationSuite | null> {
    return (params.tx ?? this.prisma).simulationSuite.findFirst({
      where: {
        projectId: params.projectId,
        kind: "custom",
        archivedAt: null,
        name: { equals: params.name.trim(), mode: "insensitive" },
        NOT: { labels: { has: CLI_EPHEMERAL_LABEL } },
      },
      orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }, { id: "desc" }],
    });
  }

  /**
   * The names of the given suites, archived ones included.
   *
   * Feeds the name a run plan is derived under, which reads the folders its
   * scope covers. Only the id and the name, because that is all a name needs.
   */
  async findNamesByIds(params: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]> {
    return this.prisma.simulationSuite.findMany({
      where: { id: { in: params.ids }, projectId: params.projectId },
      select: { id: true, name: true },
    });
  }

  /**
   * The first non-archived suite carrying the label, or null. Used to find
   * managed singleton suites, which are marked by a reserved label rather
   * than by name.
   */
  async findFirstByLabel(params: {
    projectId: string;
    label: string;
  }): Promise<SimulationSuite | null> {
    return this.prisma.simulationSuite.findFirst({
      where: {
        projectId: params.projectId,
        labels: { has: params.label },
        archivedAt: null,
      },
      orderBy: { createdAt: "asc" },
    });
  }

  async update(params: {
    id: string;
    projectId: string;
    data: UpdateSuiteInput;
    tx?: SuiteWriteClient;
  }): Promise<SimulationSuite> {
    return tracer.withActiveSpan(
      "SuiteRepository.update",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "UPDATE",
          "db.table": "SimulationSuite",
          "tenant.id": params.projectId,
          "suite.id": params.id,
        },
      },
      async () => {
        logger.debug(
          {
            projectId: params.projectId,
            suiteId: params.id,
            operation: "UPDATE",
          },
          "Updating suite",
        );
        return (params.tx ?? this.prisma).simulationSuite.update({
          where: {
            id: params.id,
            projectId: params.projectId,
            archivedAt: null,
          },
          data: params.data,
        });
      },
    );
  }

  /**
   * Soft-archive a suite by setting its archivedAt timestamp.
   * Returns the updated suite, or null if not found.
   */
  async archive(params: {
    id: string;
    projectId: string;
    tx?: SuiteWriteClient;
  }): Promise<SimulationSuite | null> {
    return tracer.withActiveSpan(
      "SuiteRepository.archive",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "UPDATE",
          "db.table": "SimulationSuite",
          "tenant.id": params.projectId,
          "suite.id": params.id,
        },
      },
      async (span) => {
        logger.debug(
          {
            projectId: params.projectId,
            suiteId: params.id,
            operation: "UPDATE",
          },
          "Archiving suite",
        );
        const db = params.tx ?? this.prisma;
        const suite = await db.simulationSuite.findFirst({
          where: { id: params.id, projectId: params.projectId },
        });
        if (!suite) {
          span.setAttribute("result.found", false);
          return null;
        }
        const archivedSlug = suite.slug.endsWith(ARCHIVED_SLUG_SUFFIX)
          ? suite.slug
          : `${suite.slug}${ARCHIVED_SLUG_SUFFIX}-${suite.id.slice(-6)}`;
        const result = await db.simulationSuite.update({
          where: { id: params.id, projectId: params.projectId },
          data: {
            archivedAt: suite.archivedAt ?? new Date(),
            slug: archivedSlug,
          },
        });
        span.setAttribute("result.found", true);
        return result;
      },
    );
  }
}
