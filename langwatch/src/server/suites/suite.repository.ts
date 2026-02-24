/**
 * Repository for SimulationSuite persistence.
 *
 * Handles all database operations for suite configurations.
 * Uses the Repository pattern consistent with ScenarioRepository.
 */

import { SpanKind } from "@opentelemetry/api";
import type {
  Prisma,
  PrismaClient,
  SimulationSuite,
} from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { nanoid } from "nanoid";
import { ARCHIVED_SLUG_SUFFIX } from "./constants";
import { createLogger } from "~/utils/logger/server";

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
        const result = await this.prisma.simulationSuite.create({
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
          { projectId: params.projectId, suiteId: params.id, operation: "SELECT" },
          "Finding suite by id",
        );
        const result =
          await this.prisma.simulationSuite.findFirst({
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
          { projectId: params.projectId, slug: params.slug, operation: "SELECT" },
          "Finding suite by slug",
        );
        const result =
          await this.prisma.simulationSuite.findFirst({
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

  async findAll(params: {
    projectId: string;
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
        const result =
          await this.prisma.simulationSuite.findMany({
            where: {
              projectId: params.projectId,
              archivedAt: null,
            },
            orderBy: { updatedAt: "desc" },
          });
        span.setAttribute("result.count", result.length);
        return result;
      },
    );
  }

  async update(params: {
    id: string;
    projectId: string;
    data: UpdateSuiteInput;
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
          { projectId: params.projectId, suiteId: params.id, operation: "UPDATE" },
          "Updating suite",
        );
        return this.prisma.simulationSuite.update({
          where: { id: params.id, projectId: params.projectId, archivedAt: null },
          data: params.data,
        });
      },
    );
  }

  /**
   * Find a suite by ID regardless of its archived status.
   * Used for viewing run results of suites that may have been archived.
   */
  async findByIdIncludingArchived(params: {
    id: string;
    projectId: string;
  }): Promise<SimulationSuite | null> {
    return tracer.withActiveSpan(
      "SuiteRepository.findByIdIncludingArchived",
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
          { projectId: params.projectId, suiteId: params.id, operation: "SELECT" },
          "Finding suite by id including archived",
        );
        const result =
          await this.prisma.simulationSuite.findFirst({
            where: {
              id: params.id,
              projectId: params.projectId,
            },
          });
        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  /**
   * Find all archived suites for a project.
   * Returns suites where archivedAt is not null, ordered by archivedAt desc.
   */
  async findAllArchived(params: {
    projectId: string;
  }): Promise<SimulationSuite[]> {
    return tracer.withActiveSpan(
      "SuiteRepository.findAllArchived",
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
          "Finding all archived suites",
        );
        const result =
          await this.prisma.simulationSuite.findMany({
            where: {
              projectId: params.projectId,
              archivedAt: { not: null },
            },
            orderBy: { archivedAt: "desc" },
          });
        span.setAttribute("result.count", result.length);
        return result;
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
          { projectId: params.projectId, suiteId: params.id, operation: "UPDATE" },
          "Archiving suite",
        );
        const suite =
          await this.prisma.simulationSuite.findFirst({
            where: { id: params.id, projectId: params.projectId },
          });
        if (!suite) {
          span.setAttribute("result.found", false);
          return null;
        }
        const archivedSlug = suite.slug.endsWith(ARCHIVED_SLUG_SUFFIX)
          ? suite.slug
          : `${suite.slug}${ARCHIVED_SLUG_SUFFIX}`;
        const result = await this.prisma.simulationSuite.update({
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

  /**
   * Restore an archived suite by clearing its archivedAt timestamp.
   * Strips the `--archived` suffix from the slug.
   * Returns the updated suite, or null if not found.
   */
  async restore(params: {
    id: string;
    projectId: string;
  }): Promise<SimulationSuite | null> {
    return tracer.withActiveSpan(
      "SuiteRepository.restore",
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
          { projectId: params.projectId, suiteId: params.id, operation: "UPDATE" },
          "Restoring suite",
        );
        const suite =
          await this.prisma.simulationSuite.findFirst({
            where: { id: params.id, projectId: params.projectId },
          });
        if (!suite) {
          span.setAttribute("result.found", false);
          return null;
        }
        const restoredSlug = suite.slug.endsWith(ARCHIVED_SLUG_SUFFIX)
          ? suite.slug.slice(0, -ARCHIVED_SLUG_SUFFIX.length)
          : suite.slug;
        const result = await this.prisma.simulationSuite.update({
          where: { id: params.id, projectId: params.projectId },
          data: { archivedAt: null, slug: restoredSlug },
        });
        span.setAttribute("result.found", true);
        return result;
      },
    );
  }
}
