import { SpanKind } from "@opentelemetry/api";
import type { Prisma, PrismaClient, Scenario } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { generate } from "@langwatch/ksuid";
import { createLogger } from "~/utils/logger/server";
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

export class ScenarioRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(input: CreateScenarioInput): Promise<Scenario> {
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
        logger.debug({ projectId: input.projectId, operation: "INSERT" }, "Inserting scenario");
        const result = await this.prisma.scenario.create({
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
        logger.debug({ projectId: input.projectId, scenarioId: input.id, operation: "SELECT" }, "Finding scenario by id");
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
          { projectId: input.projectId, scenarioId: input.id, operation: "SELECT" },
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
   * Find multiple scenarios by IDs regardless of archived status.
   * Returns only id and archivedAt for lightweight classification.
   */
  async findManyIncludingArchived(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; archivedAt: Date | null }[]> {
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
          { projectId: input.projectId, idCount: input.ids.length, operation: "SELECT" },
          "Finding scenarios by ids including archived",
        );
        const results = await this.prisma.scenario.findMany({
          where: {
            id: { in: input.ids },
            projectId: input.projectId,
          },
          select: { id: true, archivedAt: true },
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
        logger.debug({ projectId: input.projectId, operation: "SELECT" }, "Finding all scenarios");
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

  async update(
    id: string,
    projectId: string,
    data: UpdateScenarioInput,
  ): Promise<Scenario> {
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
        logger.debug({ projectId, scenarioId: id, operation: "UPDATE" }, "Updating scenario");
        return this.prisma.scenario.update({
          where: { id, projectId },
          data,
        });
      },
    );
  }

  /**
   * Soft-archive a scenario by setting its archivedAt timestamp.
   * Returns the updated scenario, or null if not found for the given project.
   */
  async archive({
    id,
    projectId,
  }: {
    id: string;
    projectId: string;
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
        const scenario = await this.prisma.scenario.findFirst({
          where: { id, projectId },
        });
        if (!scenario) {
          span.setAttribute("result.found", false);
          return null;
        }
        // Idempotent: if already archived, preserve the original timestamp
        const result = await this.prisma.scenario.update({
          where: { id, projectId },
          data: { archivedAt: scenario.archivedAt ?? new Date() },
        });
        span.setAttribute("result.found", true);
        return result;
      },
    );
  }
}
