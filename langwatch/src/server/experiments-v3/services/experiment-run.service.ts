import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "~/server/db";
import { ExperimentService } from "~/server/experiments/experiment.service";
import { ClickHouseExperimentRunService } from "./clickhouse-experiment-run.service";
import { ElasticsearchExperimentRunService } from "./elasticsearch-experiment-run.service";
import type {
  ExperimentRun,
  ExperimentRunAggregate,
  ExperimentRunWithItems,
} from "./types";

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

  async getRunAggregatesForExperimentIds(params: {
    projectId: string;
    experimentIds: string[];
  }): Promise<Record<string, ExperimentRunAggregate>> {
    return this.tracer.withActiveSpan(
      "ExperimentRunService.getRunAggregatesForExperimentIds",
      {
        attributes: {
          "tenant.id": params.projectId,
          "experiment.count": params.experimentIds.length,
        },
      },
      async (span) => {
        span.setAttribute("backend", "clickhouse");

        const result =
          await this.clickHouseService.getRunAggregatesForExperimentIds(params);
        if (result === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for getRunAggregatesForExperimentIds — check ClickHouse client configuration",
          );
        }
        return result;
      },
    );
  }

  async listRunsForExperimentSlugPaginated(params: {
    projectId: string;
    experimentSlug: string;
    page: number;
    pageSize: number;
  }): Promise<{
    experiment: { id: string; slug: string } | null;
    runs: ExperimentRun[];
    totalHits: number;
  }> {
    return this.tracer.withActiveSpan(
      "ExperimentRunService.listRunsForExperimentSlugPaginated",
      {
        attributes: {
          "tenant.id": params.projectId,
          "experiment.slug": params.experimentSlug,
          page: params.page,
          pageSize: params.pageSize,
        },
      },
      async (span) => {
        const experiment = await ExperimentService.create(
          this.prisma,
        ).findIdBySlug({
          projectId: params.projectId,
          slug: params.experimentSlug,
        });

        if (!experiment) {
          return { experiment: null, runs: [], totalHits: 0 };
        }

        span.setAttribute("experiment.id", experiment.id);
        span.setAttribute("backend", "clickhouse");

        const result =
          await this.clickHouseService.listRunsForExperimentPaginated({
            projectId: params.projectId,
            experimentId: experiment.id,
            page: params.page,
            pageSize: params.pageSize,
          });
        if (result === null) {
          throw new Error(
            "ClickHouse is enabled but returned null for listRunsForExperimentPaginated — check ClickHouse client configuration",
          );
        }

        return {
          experiment,
          runs: result.runs,
          totalHits: result.totalHits,
        };
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
   * @returns The full experiment run with dataset entries and evaluations,
   *   or `null` when the run row hasn't materialised yet in ClickHouse.
   *
   * **Why nullable**: the run row is written by the
   * `experiment-run-processing` event-sourcing pipeline (consumed off the
   * fold queue), so there's a window between
   * `runOrchestrator → commands.startExperimentRun()` returning and the
   * row landing in CH. Pre-fix this method threw a 500 in that window
   * and the UI's 1s poll loop stayed in a perpetual spinner with the
   * error toast cascading every tick — caught during PR #3483 dogfood.
   * The two consumers (`BatchEvaluationV2EvaluationResults` +
   * `useMultiRunData`) already optional-chain on `data?.dataset` /
   * `queries[idx]?.data ?? null`, so returning null surfaces as a clean
   * "loading" state until the next refetch picks up the materialised row.
   * `listRuns` is unaffected (it reads aggregated CH data via a
   * different query path that already coalesces empties to `{}`).
   */
  async getRun(params: {
    projectId: string;
    experimentId: string;
    runId: string;
  }): Promise<ExperimentRunWithItems | null> {
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

        return this.clickHouseService.getRun(params);
      },
    );
  }
}
