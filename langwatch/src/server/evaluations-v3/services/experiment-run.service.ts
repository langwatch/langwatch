import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "~/server/db";
import { ClickHouseExperimentRunService } from "./clickhouse-experiment-run.service";
import { ElasticsearchExperimentRunService } from "./elasticsearch-experiment-run.service";
import type { ExperimentRun, ExperimentRunWithItems } from "./types";

/**
 * Unified service for fetching experiment runs from either ClickHouse or Elasticsearch.
 *
 * This service acts as a facade that:
 * 1. Checks if ClickHouse evaluations data source is enabled for the project
 *    (via `featureClickHouseDataSourceEvaluations` flag)
 * 2. Routes requests to the appropriate backend based on the feature flag
 *
 * When ClickHouse is enabled, it is the exclusive data source — no fallback to Elasticsearch.
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
   * Check if ClickHouse is enabled for the given project.
   *
   * @param projectId - The project ID
   * @returns True if ClickHouse evaluations data source is enabled
   */
  async isClickHouseEnabled(projectId: string): Promise<boolean> {
    return this.clickHouseService.isClickHouseEnabled(projectId);
  }

  /**
   * List experiment runs for one or more experiments.
   *
   * Routes to ClickHouse when enabled, Elasticsearch otherwise.
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
        const useClickHouse = await this.isClickHouseEnabled(
          params.projectId,
        );
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result = await this.clickHouseService.listRuns(params);
          if (result === null) {
            throw new Error(
              "ClickHouse is enabled but returned null for listRuns — check ClickHouse client configuration",
            );
          }
          return result;
        }

        return this.elasticsearchService.listRuns(params);
      },
    );
  }

  /**
   * Get a single experiment run with all its items (dataset entries and evaluations).
   *
   * Routes to ClickHouse when enabled, Elasticsearch otherwise.
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
        const useClickHouse = await this.isClickHouseEnabled(
          params.projectId,
        );
        span.setAttribute(
          "backend",
          useClickHouse ? "clickhouse" : "elasticsearch",
        );

        if (useClickHouse) {
          const result = await this.clickHouseService.getRun(params);
          if (result === null) {
            throw new Error(
              "ClickHouse is enabled but returned null for getRun — check ClickHouse client configuration",
            );
          }
          return result;
        }

        return this.elasticsearchService.getRun(params);
      },
    );
  }
}
