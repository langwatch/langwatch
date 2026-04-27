import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "~/server/db";
import { ClickHouseExperimentRunService } from "./clickhouse-experiment-run.service";
import { ElasticsearchExperimentRunService } from "./elasticsearch-experiment-run.service";
import type { ExperimentRun, ExperimentRunWithItems } from "./types";

/**
 * Unified service for fetching experiment runs from ClickHouse.
 *
 * This service acts as a facade that routes all requests to the ClickHouse backend.
 *
 * @example
 * ```ts
 * const service = ExperimentRunService.create(prisma);
 * const runs = await service.listRuns({ projectId, experimentIds });
 * ```
 */
export class ExperimentRunService {
  private readonly tracer = getLangWatchTracer(
    "langwatch.experiment-runs.service",
  );
  private readonly clickHouseService: ClickHouseExperimentRunService;
  private readonly elasticsearchService: ElasticsearchExperimentRunService;

  constructor(readonly prisma: PrismaClient) {
    this.clickHouseService = ClickHouseExperimentRunService.create(prisma);
    this.elasticsearchService =
      ElasticsearchExperimentRunService.create(prisma);
  }

  /**
   * Static factory method for creating the service with default dependencies.
   *
   * @param prisma - PrismaClient instance
   * @returns ExperimentRunService instance
   */
  static create(prisma: PrismaClient = defaultPrisma): ExperimentRunService {
    return new ExperimentRunService(prisma);
  }

  /**
   * List experiment runs for one or more experiments.
   *
   * Returns runs grouped by experiment ID.
   *
   * @param params - Query parameters
   * @param params.projectId - The project ID
   * @param params.experimentIds - Array of experiment IDs to fetch runs for
   * @returns Map of experiment ID to array of ExperimentRun
   */
  async listRuns(params: {
    projectId: string;
    experimentIds: string[];
  }): Promise<Record<string, ExperimentRun[]>> {
    return this.tracer.withActiveSpan(
      "ExperimentRunService.listRuns",
      {
        attributes: {
          "tenant.id": params.projectId,
          "experiment.count": params.experimentIds.length,
        },
      },
      async (span) => {
        span.setAttribute("backend", "clickhouse");

        const result = await this.clickHouseService.listRuns(params);
        if (result === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for listRuns — check ClickHouse client configuration",
          );
        }
        return result;
      },
    );
  }

  /**
   * Get a single experiment run with all its items (dataset entries and evaluations).
   *
   * @param params - Query parameters
   * @param params.projectId - The project ID
   * @param params.experimentId - The experiment ID
   * @param params.runId - The run ID
   * @returns The full experiment run with dataset entries and evaluations
   */
  async getRun(params: {
    projectId: string;
    experimentId: string;
    runId: string;
  }): Promise<ExperimentRunWithItems> {
    return this.tracer.withActiveSpan(
      "ExperimentRunService.getRun",
      {
        attributes: {
          "tenant.id": params.projectId,
          "run.id": params.runId,
        },
      },
      async (span) => {
        span.setAttribute("backend", "clickhouse");

        const result = await this.clickHouseService.getRun(params);
        if (result === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for getRun — check ClickHouse client configuration",
          );
        }
        return result;
      },
    );
  }
}
