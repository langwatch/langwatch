import { TupleParam } from "@clickhouse/client";
import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma as defaultPrisma } from "~/server/db";
import { ExperimentService } from "~/server/experiments/experiment.service";
import { createLogger } from "~/utils/logger/server";
import {
  computeOccurredAtRangeForRuns,
  OCCURRED_AT_BUFFER_MS,
  WARN_OLD_RUN_AGE_MS,
} from "./clickhouse-experiment-run.queries";
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
import type {
  ExperimentRun,
  ExperimentRunAggregate,
  ExperimentRunWithItems,
} from "./types";

interface ClickHouseExperimentRunAggregateRow {
  ExperimentId: string;
  runsCount: number | string;
  lastRunAt: number | string | null;
}

interface ClickHouseCountRow {
  totalHits: number | string;
}

/**
 * ClickHouse backend for experiment run queries.
 *
 * Returns `null` from public methods when ClickHouse is not enabled
 * for the given project.
 *
 * Follows the same pattern as `ClickHouseTraceService`.
 */
export class ExperimentRunService {
  private readonly logger = createLogger("langwatch:experiment-runs:service");
  private readonly tracer = getLangWatchTracer(
    "langwatch.experiment-runs.service",
  );

  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Static factory method for creating the service with default dependencies.
   */
  static create(prisma: PrismaClient = defaultPrisma): ExperimentRunService {
    return new ExperimentRunService(prisma);
  }

  /**
   * Emit a warning when the oldest run being queried is older than
   * `WARN_OLD_RUN_AGE_MS`. Pairs with `OCCURRED_AT_BUFFER_MS`: if old-run
   * warnings start showing up alongside reports of missing breakdown / cost
   * rows, the buffer is too tight for the SDK client clock drift in that
   * environment and should be widened.
   */
  private warnIfRunsAreOld({
    projectId,
    minMs,
    runCount,
  }: {
    projectId: string;
    minMs: number;
    runCount: number;
  }): void {
    const ageMs = Date.now() - minMs;
    if (ageMs > WARN_OLD_RUN_AGE_MS) {
      this.logger.warn(
        {
          projectId,
          oldestRunAgeDays: Math.floor(ageMs / (24 * 60 * 60 * 1000)),
          runCount,
          occurredAtBufferHours: OCCURRED_AT_BUFFER_MS / (60 * 60 * 1000),
        },
        "Querying experiment runs with very old CreatedAt; if users report missing items, OCCURRED_AT_BUFFER_MS may need to widen",
      );
    }
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
  }): Promise<Record<string, ExperimentRun[]>> {
    return this.tracer.withActiveSpan(
      "ExperimentRunService.listRuns",
      {
        attributes: {
          "tenant.id": projectId,
          "experiment.count": experimentIds.length,
        },
      },
      async () => {
        const clickHouseClient = await getClickHouseClientForProject(projectId);
        if (!clickHouseClient) {
          throw new Error(
            `ClickHouse client unavailable for project ${projectId}`,
          );
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
              SELECT *
              FROM experiment_runs AS t
              WHERE t.TenantId = {tenantId:String}
                AND t.ExperimentId IN ({experimentIds:Array(String)})
                AND (t.TenantId, t.RunId, t.ExperimentId, t.UpdatedAt) IN (
                  SELECT TenantId, RunId, ExperimentId, max(UpdatedAt)
                  FROM experiment_runs
                  WHERE TenantId = {tenantId:String}
                    AND ExperimentId IN ({experimentIds:Array(String)})
                  GROUP BY TenantId, RunId, ExperimentId
                )
              ORDER BY t.CreatedAt DESC
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
          this.warnIfRunsAreOld({
            projectId,
            minMs: occurredAtRange.minMs,
            runCount: runRows.length,
          });

          // Fetch per-evaluator breakdown for all runs.
          //
          // Dedup uses an IN-tuple subquery on (key columns, OccurredAt) instead
          // of the per-row dedup anti-pattern. That pattern reads every selected column
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
          const costByExperimentRun = new Map<
            string,
            ClickHouseCostSummaryRow
          >();
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

  async getRunAggregatesForExperimentIds({
    projectId,
    experimentIds,
  }: {
    projectId: string;
    experimentIds: string[];
  }): Promise<Record<string, ExperimentRunAggregate>> {
    return this.tracer.withActiveSpan(
      "ExperimentRunService.getRunAggregatesForExperimentIds",
      {
        attributes: {
          "tenant.id": projectId,
          "experiment.count": experimentIds.length,
        },
      },
      async () => {
        const clickHouseClient = await getClickHouseClientForProject(projectId);
        if (!clickHouseClient) {
          throw new Error(
            `ClickHouse client unavailable for project ${projectId}`,
          );
        }

        if (experimentIds.length === 0) {
          return {};
        }

        const result = await clickHouseClient.query({
          query: `
            SELECT
              ExperimentId,
              count() AS runsCount,
              max(toUnixTimestamp64Milli(CreatedAt)) AS lastRunAt
            FROM (
              SELECT
                ExperimentId,
                RunId,
                argMax(CreatedAt, UpdatedAt) AS CreatedAt
              FROM experiment_runs
              WHERE TenantId = {tenantId:String}
                AND ExperimentId IN ({experimentIds:Array(String)})
              GROUP BY ExperimentId, RunId
            )
            GROUP BY ExperimentId
          `,
          query_params: {
            tenantId: projectId,
            experimentIds,
          },
          format: "JSONEachRow",
        });

        const rows =
          (await result.json()) as ClickHouseExperimentRunAggregateRow[];

        return rows.reduce<Record<string, ExperimentRunAggregate>>(
          (acc, row) => {
            acc[row.ExperimentId] = {
              runsCount: Number(row.runsCount),
              lastRunAt: row.lastRunAt === null ? null : Number(row.lastRunAt),
            };
            return acc;
          },
          {},
        );
      },
    );
  }

  async listRunsForExperimentPaginated({
    projectId,
    experimentId,
    page,
    pageSize,
  }: {
    projectId: string;
    experimentId: string;
    page: number;
    pageSize: number;
  }): Promise<{ runs: ExperimentRun[]; totalHits: number }> {
    return this.tracer.withActiveSpan(
      "ExperimentRunService.listRunsForExperimentPaginated",
      {
        attributes: {
          "tenant.id": projectId,
          "experiment.id": experimentId,
          page,
          pageSize,
        },
      },
      async () => {
        const clickHouseClient = await getClickHouseClientForProject(projectId);
        if (!clickHouseClient) {
          throw new Error(
            `ClickHouse client unavailable for project ${projectId}`,
          );
        }

        const offset = (page - 1) * pageSize;

        try {
          const countResult = await clickHouseClient.query({
            query: `
              SELECT uniqExact(RunId) AS totalHits
              FROM experiment_runs
              WHERE TenantId = {tenantId:String}
                AND ExperimentId = {experimentId:String}
            `,
            query_params: {
              tenantId: projectId,
              experimentId,
            },
            format: "JSONEachRow",
          });
          const countRows = (await countResult.json()) as ClickHouseCountRow[];
          const totalHits = Number(countRows[0]?.totalHits ?? 0);

          const runsResult = await clickHouseClient.query({
            query: `
              SELECT *
              FROM experiment_runs AS t
              WHERE t.TenantId = {tenantId:String}
                AND t.ExperimentId = {experimentId:String}
                AND (t.TenantId, t.RunId, t.ExperimentId, t.UpdatedAt) IN (
                  SELECT TenantId, RunId, ExperimentId, max(UpdatedAt)
                  FROM experiment_runs
                  WHERE TenantId = {tenantId:String}
                    AND ExperimentId = {experimentId:String}
                  GROUP BY TenantId, RunId, ExperimentId
                )
              ORDER BY t.CreatedAt DESC, t.RunId DESC
              LIMIT {pageSize:UInt32}
              OFFSET {offset:UInt32}
            `,
            query_params: {
              tenantId: projectId,
              experimentId,
              pageSize,
              offset,
            },
            format: "JSONEachRow",
          });

          const runRows =
            (await runsResult.json()) as ClickHouseExperimentRunRow[];

          if (runRows.length === 0) {
            return { runs: [], totalHits };
          }

          const runPairs = runRows.map(
            (r) => new TupleParam([r.ExperimentId, r.RunId]),
          );
          const occurredAtRange = computeOccurredAtRangeForRuns(runRows);
          this.warnIfRunsAreOld({
            projectId,
            minMs: occurredAtRange.minMs,
            runCount: runRows.length,
          });

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
          const costByExperimentRun = new Map<
            string,
            ClickHouseCostSummaryRow
          >();
          for (const row of costRows) {
            costByExperimentRun.set(`${row.ExperimentId}:${row.RunId}`, row);
          }

          const versionIds = runRows
            .map((r) => r.WorkflowVersionId)
            .filter((id): id is string => id !== null);
          const versionsMap = await getVersionMap({
            prisma: this.prisma,
            projectId,
            versionIds,
          });

          const runs = runRows.map((row) => {
            const compositeKey = `${row.ExperimentId}:${row.RunId}`;
            return mapClickHouseRunToExperimentRun({
              record: row,
              workflowVersion: row.WorkflowVersionId
                ? (versionsMap[row.WorkflowVersionId] ?? null)
                : null,
              evaluatorBreakdown: breakdownByExperimentRun.get(compositeKey),
              costSummary: costByExperimentRun.get(compositeKey),
            });
          });

          return { runs, totalHits };
        } catch (error) {
          this.logger.error(
            {
              projectId,
              experimentId,
              error: error instanceof Error ? error.message : error,
            },
            "Failed to list paginated experiment runs from ClickHouse",
          );
          throw new Error(
            "Failed to list paginated experiment runs from ClickHouse",
          );
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
      "ExperimentRunService.getRun",
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
          // Single-run read: resolve the latest version with a scalar
          // `UpdatedAt = (SELECT max(UpdatedAt) ...)` subquery. The scalar
          // equality is PREWHERE-able, so the heavy columns are materialized for
          // only the surviving version instead of across every version of the
          // run. The IN-tuple form stays the right choice for the multi-run list
          // reads (listRuns) and for experiment_run_items below.
          const runResult = await clickHouseClient.query({
            query: `
              SELECT *
              FROM experiment_runs
              WHERE TenantId = {tenantId:String}
                AND ExperimentId = {experimentId:String}
                AND RunId = {runId:String}
                AND UpdatedAt = (
                  SELECT max(UpdatedAt)
                  FROM experiment_runs
                  WHERE TenantId = {tenantId:String}
                    AND ExperimentId = {experimentId:String}
                    AND RunId = {runId:String}
                )
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
          this.warnIfRunsAreOld({
            projectId,
            minMs: occurredAtRange.minMs,
            runCount: 1,
          });

          // Fetch all items for this run.
          //
          // ExperimentId is part of the WHERE filter and the dedup key tuple
          // because runId is not unique across experiments — without it, rows
          // from one experiment leak into another's view whenever they share
          // the same runId (e.g. when SDK callers reuse a stable run_id across
          // BatchEvaluation invocations).
          //
          // Dedup uses an IN-tuple subquery on (key columns, OccurredAt) rather
          // than the per-row dedup anti-pattern. That pattern reads every selected column
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

          // Enrich target items with costs from trace_summaries.
          // The SDK doesn't send costs in recordTargetResult, but the
          // trace processing pipeline computes them from LLM span data.
          const enrichedItems = await this.enrichItemsWithTraceCosts(
            clickHouseClient,
            projectId,
            itemRows,
          );

          const result = mapClickHouseItemsToRunWithItems({
            runRecord,
            items: enrichedItems,
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

  /**
   * Enriches experiment run items with cost data from trace_summaries.
   *
   * SDK experiments don't send costs inline — costs are computed by the
   * trace processing pipeline from LLM span model/token data. This method
   * looks up trace costs and backfills them onto target items.
   *
   * For multi-target experiments where multiple items share the same traceId,
   * the trace cost is split evenly across items (each target execution is
   * a child span of the same iteration trace).
   */
  private async enrichItemsWithTraceCosts(
    clickHouseClient: Awaited<
      ReturnType<typeof getClickHouseClientForProject>
    > &
      object,
    projectId: string,
    items: ClickHouseExperimentRunItemRow[],
  ): Promise<ClickHouseExperimentRunItemRow[]> {
    // Collect unique traceIds from target items that are missing costs
    const traceIds = [
      ...new Set(
        items
          .filter(
            (i) =>
              i.ResultType === "target" && i.TraceId && i.TargetCost === null,
          )
          .map((i) => i.TraceId!),
      ),
    ];

    if (traceIds.length === 0) return items;

    try {
      const traceCostResult = await clickHouseClient.query({
        query: `
          SELECT
            TraceId,
            TotalCost
          FROM trace_summaries
          WHERE TenantId = {tenantId:String}
            AND TraceId IN ({traceIds:Array(String)})
            AND (TenantId, TraceId, UpdatedAt) IN (
              SELECT TenantId, TraceId, max(UpdatedAt)
              FROM trace_summaries
              WHERE TenantId = {tenantId:String}
                AND TraceId IN ({traceIds:Array(String)})
              GROUP BY TenantId, TraceId
            )
        `,
        query_params: { tenantId: projectId, traceIds },
        format: "JSONEachRow",
      });

      const traceCostRows = await traceCostResult.json<{
        TraceId: string;
        TotalCost: number | null;
      }>();

      if (traceCostRows.length === 0) return items;

      const costByTraceId = new Map<string, number>();
      for (const row of traceCostRows) {
        if (row.TotalCost !== null && row.TotalCost > 0) {
          costByTraceId.set(row.TraceId, row.TotalCost);
        }
      }

      // Count how many target items share each traceId (for cost splitting)
      const targetCountByTraceId = new Map<string, number>();
      for (const item of items) {
        if (
          item.ResultType === "target" &&
          item.TraceId &&
          costByTraceId.has(item.TraceId)
        ) {
          targetCountByTraceId.set(
            item.TraceId,
            (targetCountByTraceId.get(item.TraceId) ?? 0) + 1,
          );
        }
      }

      // Enrich items with costs
      return items.map((item) => {
        if (
          item.ResultType !== "target" ||
          !item.TraceId ||
          item.TargetCost !== null
        ) {
          return item;
        }

        const traceCost = costByTraceId.get(item.TraceId);
        if (traceCost === undefined) return item;

        const targetCount = targetCountByTraceId.get(item.TraceId) ?? 1;
        const perItemCost = Number((traceCost / targetCount).toFixed(6));

        return { ...item, TargetCost: perItemCost };
      });
    } catch (error) {
      this.logger.warn(
        { projectId, error: error instanceof Error ? error.message : error },
        "Failed to enrich items with trace costs — returning items without costs",
      );
      return items;
    }
  }

  /**
   * Paginated runs for an experiment looked up by slug. Resolves the slug
   * to its ID via Prisma, then delegates to {@link listRunsForExperimentPaginated}.
   */
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

        const result = await this.listRunsForExperimentPaginated({
          projectId: params.projectId,
          experimentId: experiment.id,
          page: params.page,
          pageSize: params.pageSize,
        });

        return {
          experiment,
          runs: result.runs,
          totalHits: result.totalHits,
        };
      },
    );
  }
}
