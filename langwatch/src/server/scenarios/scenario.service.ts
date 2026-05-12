import { SpanKind } from "@opentelemetry/api";
import type { PrismaClient, Scenario } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { createLogger } from "~/utils/logger/server";
import { ScenarioNotFoundError } from "./errors";
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

  /**
   * Fetch a scenario by ID regardless of its archived status.
   * Used for viewing run results of scenarios that may have been archived.
   */
  async getByIdIncludingArchived(params: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null> {
    return tracer.withActiveSpan(
      "ScenarioService.getByIdIncludingArchived",
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
          "Fetching scenario by id including archived",
        );
        const result = await this.repository.findByIdIncludingArchived(params);
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

  /**
   * Soft-archive a single scenario.
   * Throws if the scenario is not found in the given project.
   */
  async archive(params: {
    id: string;
    projectId: string;
  }): Promise<Scenario> {
    return tracer.withActiveSpan(
      "ScenarioService.archive",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.id": params.id,
        },
      },
      async () => {
        logger.debug(
          { projectId: params.projectId, scenarioId: params.id },
          "Archiving scenario",
        );
        const result = await this.repository.archive(params);
        if (!result) {
          throw new ScenarioNotFoundError();
        }
        return result;
      },
    );
  }

  /**
   * Soft-archive multiple scenarios.
   * Returns archived IDs and structured failure details.
   */
  async batchArchive(params: {
    ids: string[];
    projectId: string;
  }): Promise<{
    archived: string[];
    failed: { id: string; error: string }[];
  }> {
    return tracer.withActiveSpan(
      "ScenarioService.batchArchive",
      {
        kind: SpanKind.INTERNAL,
        attributes: {
          "tenant.id": params.projectId,
          "scenario.count": params.ids.length,
        },
      },
      async (span) => {
        logger.debug(
          { projectId: params.projectId, count: params.ids.length },
          "Batch archiving scenarios",
        );

        const archived: string[] = [];
        const failed: { id: string; error: string }[] = [];

        const results = await Promise.allSettled(
          params.ids.map((id) =>
            this.repository.archive({ id, projectId: params.projectId }),
          ),
        );

        for (let i = 0; i < params.ids.length; i++) {
          const id = params.ids[i]!;
          const result = results[i]!;
          if (result.status === "fulfilled" && result.value) {
            archived.push(id);
          } else {
            const error =
              result.status === "rejected"
                ? String(result.reason)
                : "Not found";
            failed.push({ id, error });
          }
        }

        span.setAttribute("result.archived", archived.length);
        span.setAttribute("result.failed", failed.length);
        return { archived, failed };
      },
    );
  }
}
