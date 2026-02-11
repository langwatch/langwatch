/**
 * Repository for SimulationSuiteConfiguration persistence.
 *
 * Handles all database operations for suite configurations.
 * Uses the Repository pattern consistent with ScenarioRepository.
 */

import { SpanKind } from "@opentelemetry/api";
import type {
  Prisma,
  PrismaClient,
  SimulationSuiteConfiguration,
} from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { nanoid } from "nanoid";
import { createLogger } from "~/utils/logger/server";

const tracer = getLangWatchTracer("langwatch.suites.repository");
const logger = createLogger("langwatch:suites:repository");

export type CreateSuiteInput = Omit<
  Prisma.SimulationSuiteConfigurationUncheckedCreateInput,
  "id" | "createdAt" | "updatedAt" | "archivedAt"
>;

export type UpdateSuiteInput = Partial<Omit<CreateSuiteInput, "projectId">>;

export class SuiteRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(
    input: CreateSuiteInput,
  ): Promise<SimulationSuiteConfiguration> {
    return tracer.withActiveSpan(
      "SuiteRepository.create",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "INSERT",
          "db.table": "SimulationSuiteConfiguration",
          "tenant.id": input.projectId,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: input.projectId, operation: "INSERT" },
          "Inserting suite",
        );
        const result = await this.prisma.simulationSuiteConfiguration.create({
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
  }): Promise<SimulationSuiteConfiguration | null> {
    return tracer.withActiveSpan(
      "SuiteRepository.findById",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "SELECT",
          "db.table": "SimulationSuiteConfiguration",
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
          await this.prisma.simulationSuiteConfiguration.findFirst({
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

  async findAll(params: {
    projectId: string;
  }): Promise<SimulationSuiteConfiguration[]> {
    return tracer.withActiveSpan(
      "SuiteRepository.findAll",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "SELECT",
          "db.table": "SimulationSuiteConfiguration",
          "tenant.id": params.projectId,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: params.projectId, operation: "SELECT" },
          "Finding all suites",
        );
        const result =
          await this.prisma.simulationSuiteConfiguration.findMany({
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
  }): Promise<SimulationSuiteConfiguration> {
    return tracer.withActiveSpan(
      "SuiteRepository.update",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "UPDATE",
          "db.table": "SimulationSuiteConfiguration",
          "tenant.id": params.projectId,
          "suite.id": params.id,
        },
      },
      async () => {
        logger.debug(
          { projectId: params.projectId, suiteId: params.id, operation: "UPDATE" },
          "Updating suite",
        );
        return this.prisma.simulationSuiteConfiguration.update({
          where: { id: params.id, projectId: params.projectId },
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
  }): Promise<SimulationSuiteConfiguration | null> {
    return tracer.withActiveSpan(
      "SuiteRepository.archive",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "postgresql",
          "db.operation": "UPDATE",
          "db.table": "SimulationSuiteConfiguration",
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
          await this.prisma.simulationSuiteConfiguration.findFirst({
            where: { id: params.id, projectId: params.projectId },
          });
        if (!suite) {
          span.setAttribute("result.found", false);
          return null;
        }
        const result = await this.prisma.simulationSuiteConfiguration.update({
          where: { id: params.id, projectId: params.projectId },
          data: { archivedAt: suite.archivedAt ?? new Date() },
        });
        span.setAttribute("result.found", true);
        return result;
      },
    );
  }
}
