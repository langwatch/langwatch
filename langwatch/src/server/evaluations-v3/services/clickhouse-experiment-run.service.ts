import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma as defaultPrisma } from "~/server/db";
import { createLogger } from "~/utils/logger/server";
import { getVersionMap } from "./getVersionMap";

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
  private readonly logger = createLogger(
    "langwatch:experiment-runs:clickhouse-service",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.experiment-runs.clickhouse-service",
  );

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Static factory method for creating the service with default dependencies.
   */
  static create(
    prisma: PrismaClient = defaultPrisma,
  ): ClickHouseExperimentRunService {
    return new ClickHouseExperimentRunService(prisma);
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
        const clickHouseClient = await getClickHouseClientForProject(projectId);
        if (!clickHouseClient) {
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
          const runsResult = await clickHouseClient.query({
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
              LIMIT 10000
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
          const breakdownResult = await clickHouseClient.query({
            query: `
              SELECT
                ExperimentId,
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
                    AND ExperimentId IN ({experimentIds:Array(String)})
                    AND RunId IN ({runIds:Array(String)})
                  ORDER BY ProjectionId, CreatedAt DESC
                  LIMIT 1 BY TenantId, ExperimentId, RunId, ProjectionId
                )
                ORDER BY CreatedAt DESC
                LIMIT 1 BY ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, '')
              )
              WHERE ResultType = 'evaluator'
                AND EvaluationStatus = 'processed'
              GROUP BY ExperimentId, RunId, EvaluatorId
              LIMIT 10000
            `,
            query_params: {
              tenantId: projectId,
              experimentIds,
              runIds,
            },
            format: "JSONEachRow",
          });

          const breakdownRows =
            (await breakdownResult.json()) as ClickHouseEvaluatorBreakdownRow[];

          // Group breakdown by (ExperimentId, RunId) — runIds are not unique
          // across experiments, so a composite key is required to avoid mixing
          // results between experiments that happen to share a runId.
          const breakdownByExperimentRun = new Map<
            string,
            ClickHouseEvaluatorBreakdownRow[]
          >();
          for (const row of breakdownRows) {
            const key = `${row.ExperimentId}:${row.RunId}`;
            const existing = breakdownByExperimentRun.get(key) ?? [];
            existing.push(row);
            breakdownByExperimentRun.set(key, existing);
          }

          // Fetch cost/duration summary per run
          const costResult = await clickHouseClient.query({
            query: `
              SELECT
                ExperimentId,
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
                    AND ExperimentId IN ({experimentIds:Array(String)})
                    AND RunId IN ({runIds:Array(String)})
                  ORDER BY ProjectionId, CreatedAt DESC
                  LIMIT 1 BY TenantId, ExperimentId, RunId, ProjectionId
                )
                ORDER BY CreatedAt DESC
                LIMIT 1 BY ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, '')
              )
              GROUP BY ExperimentId, RunId
              LIMIT 10000
            `,
            query_params: {
              tenantId: projectId,
              experimentIds,
              runIds,
            },
            format: "JSONEachRow",
          });

          const costRows =
            (await costResult.json()) as ClickHouseCostSummaryRow[];

          // Same composite key as breakdownByExperimentRun.
          const costByExperimentRun = new Map<string, ClickHouseCostSummaryRow>();
          for (const row of costRows) {
            costByExperimentRun.set(`${row.ExperimentId}:${row.RunId}`, row);
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

            const compositeKey = `${row.ExperimentId}:${row.RunId}`;
            const run = mapClickHouseRunToExperimentRun({
              record: row,
              workflowVersion,
              evaluatorBreakdown: breakdownByExperimentRun.get(compositeKey),
              costSummary: costByExperimentRun.get(compositeKey),
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
        const clickHouseClient = await getClickHouseClientForProject(projectId);
        if (!clickHouseClient) {
          return null;
        }

        this.logger.debug(
          { projectId, runId },
          "Fetching experiment run from ClickHouse",
        );

        try {
          // Fetch run summary
          const runResult = await clickHouseClient.query({
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
          //
          // ExperimentId is included in the WHERE clause and both LIMIT 1 BY clauses
          // because runId is not unique across experiments — without this filter,
          // results from one experiment leak into another's view whenever they share
          // the same runId (a common pattern when SDK callers reuse a stable run_id
          // across BatchEvaluation invocations).
          const itemsResult = await clickHouseClient.query({
            query: `
              SELECT * FROM (
                SELECT *
                FROM (
                  SELECT *
                  FROM experiment_run_items
                  WHERE TenantId = {tenantId:String}
                    AND ExperimentId = {experimentId:String}
                    AND RunId = {runId:String}
                  ORDER BY ProjectionId, CreatedAt DESC
                  LIMIT 1 BY TenantId, ExperimentId, RunId, ProjectionId
                )
                ORDER BY CreatedAt DESC
                LIMIT 1 BY ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, '')
              )
              ORDER BY RowIndex ASC, ResultType ASC
            `,
            query_params: {
              tenantId: projectId,
              experimentId,
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
