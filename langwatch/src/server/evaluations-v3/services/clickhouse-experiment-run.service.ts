import type { ClickHouseClient } from "@clickhouse/client";
import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClient } from "~/server/clickhouse/client";
import { prisma as defaultPrisma } from "~/server/db";
import { createLogger } from "~/utils/logger/server";
import { getVersionMap } from "./getVersionMap";
import { isClickHouseReadEnabled } from "./isClickHouseReadEnabled";
import type {
  ClickHouseCostSummaryRow,
  ClickHouseEvaluatorBreakdownRow,
  ClickHouseExperimentRunItemRow,
  ClickHouseExperimentRunRow,
} from "./mappers";
import {
  mapClickHouseItemsToRunWithItems,
  mapClickHouseRunToExperimentRun,
} from "./mappers";
import type { ExperimentRun, ExperimentRunWithItems } from "./types";

/**
 * ClickHouse backend for experiment run queries.
 *
 * Returns `null` from public methods when ClickHouse is not enabled
 * for the given project, allowing the facade to fall back to Elasticsearch.
 *
 * Follows the same pattern as `ClickHouseTraceService`.
 */
export class ClickHouseExperimentRunService {
  private readonly clickHouseClient: ClickHouseClient | null;
  private readonly logger = createLogger(
    "langwatch:experiment-runs:clickhouse-service",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.experiment-runs.clickhouse-service",
  );

  constructor(private readonly prisma: PrismaClient) {
    this.clickHouseClient = getClickHouseClient();
  }

  /**
   * Static factory method for creating the service with default dependencies.
   */
  static create(
    prisma: PrismaClient = defaultPrisma,
  ): ClickHouseExperimentRunService {
    return new ClickHouseExperimentRunService(prisma);
  }

  /**
   * Check if ClickHouse evaluations data source is enabled for the given project.
   */
  async isClickHouseEnabled(projectId: string): Promise<boolean> {
    return this.tracer.withActiveSpan(
      "ClickHouseExperimentRunService.isClickHouseEnabled",
      { attributes: { "tenant.id": projectId } },
      async (span) => {
        if (!this.clickHouseClient) {
          return false;
        }

        const enabled = await isClickHouseReadEnabled(this.prisma, projectId);

        span.setAttribute("project.feature.clickhouse", enabled);

        return enabled;
      },
    );
  }

  /**
   * List experiment runs for one or more experiments.
   *
   * Returns runs grouped by experiment ID, with per-evaluator breakdown
   * and workflow version metadata.
   *
   * @returns `null` if ClickHouse is not enabled for this project
   */
  async listRuns({
    projectId,
    experimentIds,
  }: {
    projectId: string;
    experimentIds: string[];
  }): Promise<Record<string, ExperimentRun[]> | null> {
    return this.tracer.withActiveSpan(
      "ClickHouseExperimentRunService.listRuns",
      {
        attributes: {
          "tenant.id": projectId,
          "experiment.count": experimentIds.length,
        },
      },
      async () => {
        const isEnabled = await this.isClickHouseEnabled(projectId);
        if (!isEnabled || !this.clickHouseClient) {
          return null;
        }

        if (experimentIds.length === 0) {
          return {};
        }

        this.logger.debug(
          { projectId, experimentIdCount: experimentIds.length },
          "Listing experiment runs from ClickHouse",
        );

        try {
          // Fetch run summaries
          const runsResult = await this.clickHouseClient.query({
            query: `
              SELECT * FROM (
                SELECT *
                FROM experiment_runs
                WHERE TenantId = {tenantId:String}
                  AND ExperimentId IN ({experimentIds:Array(String)})
                ORDER BY RunId, UpdatedAt DESC
                LIMIT 1 BY TenantId, RunId, ExperimentId
              )
              ORDER BY CreatedAt DESC
            `,
            query_params: {
              tenantId: projectId,
              experimentIds,
            },
            format: "JSONEachRow",
          });

          const runRows =
            (await runsResult.json()) as ClickHouseExperimentRunRow[];

          if (runRows.length === 0) {
            return {};
          }

          // Fetch per-evaluator breakdown for all runs
          const runIds = runRows.map((r) => r.RunId);
          const breakdownResult = await this.clickHouseClient.query({
            query: `
              SELECT
                RunId,
                EvaluatorId,
                max(EvaluatorName) AS EvaluatorName,
                avg(Score) AS avgScore,
                if(countIf(Passed IS NOT NULL) > 0, countIf(Passed = 1) / countIf(Passed IS NOT NULL), NULL) AS passRate,
                countIf(Passed IS NOT NULL) AS hasPassedCount
              FROM (
                SELECT *
                FROM (
                  SELECT *
                  FROM experiment_run_items
                  WHERE TenantId = {tenantId:String}
                    AND RunId IN ({runIds:Array(String)})
                  ORDER BY ProjectionId, CreatedAt DESC
                  LIMIT 1 BY TenantId, RunId, ProjectionId
                )
                ORDER BY CreatedAt DESC
                LIMIT 1 BY RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, '')
              )
              WHERE ResultType = 'evaluator'
                AND EvaluationStatus = 'processed'
              GROUP BY RunId, EvaluatorId
            `,
            query_params: {
              tenantId: projectId,
              runIds,
            },
            format: "JSONEachRow",
          });

          const breakdownRows =
            (await breakdownResult.json()) as ClickHouseEvaluatorBreakdownRow[];

          // Group breakdown by RunId
          const breakdownByRunId = new Map<
            string,
            ClickHouseEvaluatorBreakdownRow[]
          >();
          for (const row of breakdownRows) {
            const existing = breakdownByRunId.get(row.RunId) ?? [];
            existing.push(row);
            breakdownByRunId.set(row.RunId, existing);
          }

          // Fetch cost/duration summary per run
          const costResult = await this.clickHouseClient.query({
            query: `
              SELECT
                RunId,
                sumIf(TargetCost, ResultType = 'target') AS datasetCost,
                sumIf(EvaluationCost, ResultType = 'evaluator') AS evaluationsCost,
                avgIf(TargetCost, ResultType = 'target' AND TargetCost IS NOT NULL) AS datasetAverageCost,
                avgIf(TargetDurationMs, ResultType = 'target' AND TargetDurationMs IS NOT NULL) AS datasetAverageDuration,
                avgIf(EvaluationCost, ResultType = 'evaluator' AND EvaluationCost IS NOT NULL) AS evaluationsAverageCost,
                avgIf(EvaluationDurationMs, ResultType = 'evaluator' AND EvaluationDurationMs IS NOT NULL) AS evaluationsAverageDuration
              FROM (
                SELECT *
                FROM (
                  SELECT *
                  FROM experiment_run_items
                  WHERE TenantId = {tenantId:String}
                    AND RunId IN ({runIds:Array(String)})
                  ORDER BY ProjectionId, CreatedAt DESC
                  LIMIT 1 BY TenantId, RunId, ProjectionId
                )
                ORDER BY CreatedAt DESC
                LIMIT 1 BY RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, '')
              )
              GROUP BY RunId
            `,
            query_params: {
              tenantId: projectId,
              runIds,
            },
            format: "JSONEachRow",
          });

          const costRows =
            (await costResult.json()) as ClickHouseCostSummaryRow[];

          const costByRunId = new Map<string, ClickHouseCostSummaryRow>();
          for (const row of costRows) {
            costByRunId.set(row.RunId, row);
          }

          // Fetch workflow version metadata from Prisma
          const versionIds = runRows
            .map((r) => r.WorkflowVersionId)
            .filter((id): id is string => id !== null);

          const versionsMap = await getVersionMap({
            prisma: this.prisma,
            projectId,
            versionIds,
          });

          // Map to canonical types and group by experiment ID
          const result: Record<string, ExperimentRun[]> = {};

          for (const row of runRows) {
            const workflowVersion = row.WorkflowVersionId
              ? (versionsMap[row.WorkflowVersionId] ?? null)
              : null;

            const run = mapClickHouseRunToExperimentRun({
              record: row,
              workflowVersion,
              evaluatorBreakdown: breakdownByRunId.get(row.RunId),
              costSummary: costByRunId.get(row.RunId),
            });

            if (!(run.experimentId in result)) {
              result[run.experimentId] = [];
            }
            result[run.experimentId]!.push(run);
          }

          this.logger.debug(
            {
              projectId,
              runCount: runRows.length,
              experimentCount: Object.keys(result).length,
            },
            "Successfully listed experiment runs from ClickHouse",
          );

          return result;
        } catch (error) {
          this.logger.error(
            {
              projectId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to list experiment runs from ClickHouse",
          );
          throw new Error("Failed to list experiment runs from ClickHouse");
        }
      },
    );
  }

  /**
   * Get a single experiment run with all its items (dataset entries and evaluations).
   *
   * @returns `null` if ClickHouse is not enabled for this project
   */
  async getRun({
    projectId,
    experimentId,
    runId,
  }: {
    projectId: string;
    experimentId: string;
    runId: string;
  }): Promise<ExperimentRunWithItems | null> {
    return this.tracer.withActiveSpan(
      "ClickHouseExperimentRunService.getRun",
      {
        attributes: { "tenant.id": projectId, "run.id": runId },
      },
      async () => {
        const isEnabled = await this.isClickHouseEnabled(projectId);
        if (!isEnabled || !this.clickHouseClient) {
          return null;
        }

        this.logger.debug(
          { projectId, runId },
          "Fetching experiment run from ClickHouse",
        );

        try {
          // Fetch run summary
          const runResult = await this.clickHouseClient.query({
            query: `
              SELECT *
              FROM experiment_runs
              WHERE TenantId = {tenantId:String}
                AND ExperimentId = {experimentId:String}
                AND RunId = {runId:String}
              ORDER BY UpdatedAt DESC
              LIMIT 1
            `,
            query_params: {
              tenantId: projectId,
              experimentId,
              runId,
            },
            format: "JSONEachRow",
          });

          const runRows =
            (await runResult.json()) as ClickHouseExperimentRunRow[];
          const runRecord = runRows[0];

          if (!runRecord) {
            return null;
          }

          // Fetch all items for this run
          // Two-level dedup: first by ProjectionId (handles un-merged ReplacingMergeTree parts),
          // then by business key (handles duplicate writes from SDK progress updates that
          // produce different ProjectionIds due to timestamp in the KSUID).
          const itemsResult = await this.clickHouseClient.query({
            query: `
              SELECT * FROM (
                SELECT *
                FROM (
                  SELECT *
                  FROM experiment_run_items
                  WHERE TenantId = {tenantId:String}
                    AND RunId = {runId:String}
                  ORDER BY ProjectionId, CreatedAt DESC
                  LIMIT 1 BY TenantId, RunId, ProjectionId
                )
                ORDER BY CreatedAt DESC
                LIMIT 1 BY RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, '')
              )
              ORDER BY RowIndex ASC, ResultType ASC
            `,
            query_params: {
              tenantId: projectId,
              runId,
            },
            format: "JSONEachRow",
          });

          const itemRows =
            (await itemsResult.json()) as ClickHouseExperimentRunItemRow[];

          const result = mapClickHouseItemsToRunWithItems({
            runRecord,
            items: itemRows,
            projectId: runRecord.TenantId,
          });

          this.logger.debug(
            {
              projectId,
              runId,
              datasetCount: result.dataset.length,
              evaluationCount: result.evaluations.length,
            },
            "Successfully fetched experiment run from ClickHouse",
          );

          return result;
        } catch (error) {
          this.logger.error(
            {
              projectId,
              runId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to fetch experiment run from ClickHouse",
          );
          throw new Error("Failed to fetch experiment run from ClickHouse");
        }
      },
    );
  }

}
