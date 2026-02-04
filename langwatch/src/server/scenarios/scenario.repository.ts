import { SpanKind } from "@opentelemetry/api";
import type { Prisma, PrismaClient, Scenario } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { nanoid } from "nanoid";
import { createLogger } from "~/utils/logger/server";

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
            id: `scen_${nanoid()}`,
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
}
