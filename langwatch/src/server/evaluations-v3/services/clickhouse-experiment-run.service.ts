import { TupleParam } from "@clickhouse/client";
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
 * Format a Date as a ClickHouse DateTime64(3) string (no timezone).
 * ClickHouse parses this in the table's column timezone (UTC by default).
 */
function formatClickHouseDateTime(d: Date): string {
  return d.toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Parse a ClickHouse DateTime64(3) string (e.g. "2024-01-15 10:30:00.000")
 * into a JS Date. ClickHouse returns these as space-separated strings without
 * a timezone suffix; treat them as UTC.
 */
function parseClickHouseDateTime(s: string): Date {
  return new Date(s.replace(" ", "T") + "Z");
}

/**
 * Buffer applied to OccurredAt range filters, in milliseconds. Items can
 * legitimately land slightly before the run's CreatedAt (clock skew between
 * ClickHouse nodes / SDK clients) and slightly after FinishedAt (late writes
 * from background workers). One hour is generous and still prunes the vast
 * majority of historical partitions (which are weekly).
 */
const OCCURRED_AT_BUFFER_MS = 60 * 60 * 1000;

/**
 * Derive a tight OccurredAt range for `experiment_run_items` queries from the
 * runs being queried. Items can't be older than the earliest run's CreatedAt
 * or newer than the latest run's UpdatedAt (modulo clock skew / late writes,
 * absorbed by `OCCURRED_AT_BUFFER_MS`). This bound lets ClickHouse prune the
 * weekly partitions that don't overlap the run window.
 *
 * Returns ClickHouse-formatted DateTime64(3) strings ready to pass as query
 * parameters.
 */
function computeOccurredAtRangeForRuns(
  runs: Pick<ClickHouseExperimentRunRow, "CreatedAt" | "UpdatedAt">[],
): { minOccurredAt: string; maxOccurredAt: string } {
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (const r of runs) {
    minMs = Math.min(minMs, parseClickHouseDateTime(r.CreatedAt).getTime());
    maxMs = Math.max(maxMs, parseClickHouseDateTime(r.UpdatedAt).getTime());
  }
  return {
    minOccurredAt: formatClickHouseDateTime(
      new Date(minMs - OCCURRED_AT_BUFFER_MS),
    ),
    maxOccurredAt: formatClickHouseDateTime(
      new Date(maxMs + OCCURRED_AT_BUFFER_MS),
    ),
  };
}

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

          // Build the exact (ExperimentId, RunId) tuple list and an OccurredAt
          // bound from the runs we just fetched. Two reasons:
          //
          //   1. `ExperimentId IN (...) AND RunId IN (...)` would match the
          //      cartesian product of those sets, pulling in unrelated rows
          //      whenever a runId happens to be reused across experiments.
          //      Filtering by exact pairs eliminates that overfetching and
          //      avoids wasting LIMIT slots on rows that get discarded.
          //
          //   2. `experiment_run_items` is partitioned by `toYearWeek(OccurredAt)`.
          //      Without an OccurredAt range in the WHERE clause, ClickHouse
          //      cannot prune historical partitions and ends up scanning the
          //      whole table. Bounds derived from the runs' lifecycle
          //      (CreatedAt..UpdatedAt with a buffer for clock skew / late
          //      writes) keep this cheap.
          const runPairs = runRows.map(
            (r) => new TupleParam([r.ExperimentId, r.RunId]),
          );
          const occurredAtRange = computeOccurredAtRangeForRuns(runRows);

          // Fetch per-evaluator breakdown for all runs.
          //
          // Dedup uses an IN-tuple subquery on (key columns, OccurredAt) instead
          // of LIMIT 1 BY. ClickHouse's LIMIT 1 BY reads every selected column
          // (including heavy payloads like EvaluationDetails / EvaluationInputs)
          // before deduplicating, which can OOM on large parts. The IN-tuple
          // pattern resolves dedup using only lightweight key columns and the
          // ReplacingMergeTree version column (OccurredAt). See
          // trace-dedup-oom-safety.unit.test.ts for the rationale.
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
              FROM experiment_run_items
              WHERE TenantId = {tenantId:String}
                AND OccurredAt >= {minOccurredAt:DateTime64(3)}
                AND OccurredAt <= {maxOccurredAt:DateTime64(3)}
                AND (ExperimentId, RunId) IN {runPairs:Array(Tuple(String, String))}
                AND ResultType = 'evaluator'
                AND EvaluationStatus = 'processed'
                AND (TenantId, ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, ''), OccurredAt) IN (
                  SELECT
                    TenantId,
                    ExperimentId,
                    RunId,
                    RowIndex,
                    TargetId,
                    ResultType,
                    coalesce(EvaluatorId, ''),
                    max(OccurredAt)
                  FROM experiment_run_items
                  WHERE TenantId = {tenantId:String}
                    AND OccurredAt >= {minOccurredAt:DateTime64(3)}
                    AND OccurredAt <= {maxOccurredAt:DateTime64(3)}
                    AND (ExperimentId, RunId) IN {runPairs:Array(Tuple(String, String))}
                  GROUP BY TenantId, ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, '')
                )
              GROUP BY ExperimentId, RunId, EvaluatorId
              LIMIT 10000
            `,
            query_params: {
              tenantId: projectId,
              runPairs,
              minOccurredAt: occurredAtRange.minOccurredAt,
              maxOccurredAt: occurredAtRange.maxOccurredAt,
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

          // Fetch cost/duration summary per run.
          // Same exact-pair + OccurredAt-bounded + IN-tuple-dedup pattern as
          // the breakdown query above — see comment there for the rationale.
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
              FROM experiment_run_items
              WHERE TenantId = {tenantId:String}
                AND OccurredAt >= {minOccurredAt:DateTime64(3)}
                AND OccurredAt <= {maxOccurredAt:DateTime64(3)}
                AND (ExperimentId, RunId) IN {runPairs:Array(Tuple(String, String))}
                AND (TenantId, ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, ''), OccurredAt) IN (
                  SELECT
                    TenantId,
                    ExperimentId,
                    RunId,
                    RowIndex,
                    TargetId,
                    ResultType,
                    coalesce(EvaluatorId, ''),
                    max(OccurredAt)
                  FROM experiment_run_items
                  WHERE TenantId = {tenantId:String}
                    AND OccurredAt >= {minOccurredAt:DateTime64(3)}
                    AND OccurredAt <= {maxOccurredAt:DateTime64(3)}
                    AND (ExperimentId, RunId) IN {runPairs:Array(Tuple(String, String))}
                  GROUP BY TenantId, ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, '')
                )
              GROUP BY ExperimentId, RunId
              LIMIT 10000
            `,
            query_params: {
              tenantId: projectId,
              runPairs,
              minOccurredAt: occurredAtRange.minOccurredAt,
              maxOccurredAt: occurredAtRange.maxOccurredAt,
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

          // Bound OccurredAt by the run's lifecycle so ClickHouse can prune
          // historical partitions. `experiment_run_items` is partitioned by
          // `toYearWeek(OccurredAt)`, so without this bound a query against an
          // older run would scan every partition since the table was created.
          const occurredAtRange = computeOccurredAtRangeForRuns([runRecord]);

          // Fetch all items for this run.
          //
          // ExperimentId is part of the WHERE filter and the dedup key tuple
          // because runId is not unique across experiments — without it, rows
          // from one experiment leak into another's view whenever they share
          // the same runId (e.g. when SDK callers reuse a stable run_id across
          // BatchEvaluation invocations).
          //
          // Dedup uses an IN-tuple subquery on (key columns, OccurredAt) rather
          // than LIMIT 1 BY: ClickHouse's LIMIT 1 BY reads every selected column
          // (including heavy payloads like DatasetEntry / EvaluationDetails)
          // before deduplicating, which can OOM on large parts. The IN-tuple
          // pattern resolves dedup using only lightweight key columns and the
          // ReplacingMergeTree version column (OccurredAt). See
          // trace-dedup-oom-safety.unit.test.ts for the rationale.
          const itemsResult = await clickHouseClient.query({
            query: `
              SELECT *
              FROM experiment_run_items
              WHERE TenantId = {tenantId:String}
                AND ExperimentId = {experimentId:String}
                AND RunId = {runId:String}
                AND OccurredAt >= {minOccurredAt:DateTime64(3)}
                AND OccurredAt <= {maxOccurredAt:DateTime64(3)}
                AND (TenantId, ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, ''), OccurredAt) IN (
                  SELECT
                    TenantId,
                    ExperimentId,
                    RunId,
                    RowIndex,
                    TargetId,
                    ResultType,
                    coalesce(EvaluatorId, ''),
                    max(OccurredAt)
                  FROM experiment_run_items
                  WHERE TenantId = {tenantId:String}
                    AND ExperimentId = {experimentId:String}
                    AND RunId = {runId:String}
                    AND OccurredAt >= {minOccurredAt:DateTime64(3)}
                    AND OccurredAt <= {maxOccurredAt:DateTime64(3)}
                  GROUP BY TenantId, ExperimentId, RunId, RowIndex, TargetId, ResultType, coalesce(EvaluatorId, '')
                )
              ORDER BY RowIndex ASC, ResultType ASC
            `,
            query_params: {
              tenantId: projectId,
              experimentId,
              runId,
              minOccurredAt: occurredAtRange.minOccurredAt,
              maxOccurredAt: occurredAtRange.maxOccurredAt,
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
