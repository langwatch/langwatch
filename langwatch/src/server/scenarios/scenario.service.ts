import { SpanKind } from "@opentelemetry/api";
import type { PrismaClient, Scenario } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import {
  ScenarioRepository,
  type CreateScenarioInput,
  type UpdateScenarioInput,
} from "./scenario.repository";

const tracer = getLangWatchTracer("langwatch.scenarios.service");
const logger = createLogger("langwatch:scenarios:service");

export class ScenarioService {
  constructor(private readonly repository: ScenarioRepository) {}

  static create(prisma: PrismaClient): ScenarioService {
    return new ScenarioService(new ScenarioRepository(prisma));
  }

  async create(input: CreateScenarioInput): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioService.create",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": input.projectId,
        },
      },
      async (span) => {
        logger.debug({ projectId: input.projectId }, "Creating scenario");
        const result = await this.repository.create(input);
        span.setAttribute("scenario.id", result.id);
        return result;
      },
    );
  }

  async getById(params: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null> {
    return tracer.withActiveSpan(
      "ScenarioService.getById",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.id,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: params.projectId, scenarioId: params.id },
          "Fetching scenario by id",
        );
        const result = await this.repository.findById(params);
        span.setAttribute("result.found", result !== null);
        return result;
      },
    );
  }

  async getAll(params: { projectId: string }): Promise<Scenario[]> {
    return tracer.withActiveSpan(
      "ScenarioService.getAll",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
        },
      },
      async (span) => {
        logger.debug({ projectId: params.projectId }, "Fetching all scenarios");
        const result = await this.repository.findAll(params);
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
      "ScenarioService.update",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": projectId,
          "scenario.id": id,
        },
      },
      async () => {
        logger.debug({ projectId, scenarioId: id }, "Updating scenario");
        return await this.repository.update(id, projectId, data);
      },
    );
  }
}
