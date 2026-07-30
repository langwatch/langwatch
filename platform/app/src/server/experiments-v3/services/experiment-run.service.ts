import { TupleParam } from "@clickhouse/client";
import { createLogger } from "@langwatch/observability";
import type { PrismaClient } from "@prisma/client";
import { getLangWatchTracer } from "langwatch";
import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma as defaultPrisma } from "~/server/db";
import { ExperimentService } from "~/server/experiments/experiment.service";
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
 * Per-run cost summary over `experiment_run_items`, plus the two counts the
 * trace-derived half of the cost needs: how many target items priced
 * themselves, and how many reported no cost but did produce a trace.
 */
interface ClickHouseRunAggregateRow extends ClickHouseCostSummaryRow {
  datasetPricedCount: number | string;
  tracedCostlessCount: number | string;
}

/**
 * One (run, trace) pair, with how many of the run's target items hang off that
 * trace and how many of those reported no cost of their own.
 */
interface ClickHouseRunTraceGroupRow {
  ExperimentId: string;
  RunId: string;
  TraceId: string;
  targetCount: number | string;
  costlessCount: number | string;
}

/** What a trace contributes to one run, once its price is known. */
interface TraceDerivedRunCost {
  /** Summed across the run's traces. */
  cost: number;
  /** Target items that got their price from a trace rather than inline. */
  pricedItemCount: number;
}

type ProjectClickHouseClient = NonNullable<
  Awaited<ReturnType<typeof getClickHouseClientForProject>>
>;

/**
 * The one definition of what a trace's price is worth to a single target.
 *
 * A trace is produced per iteration, so several target executions can sit
 * under one — dividing evenly is what makes the per-item figures add back up
 * to the trace's own price. Both derivations (`enrichItemsWithTraceCosts` for
 * the rows, `computeTraceDerivedRunCosts` for the total) go through here, so
 * the footer and the table cannot disagree; that they used to is exactly the
 * defect ADR-072's (retired; ground now ADR-103) cost section describes.
 */
function splitTraceCostAcrossTargets({
  traceCost,
  targetCount,
}: {
  traceCost: number;
  targetCount: number;
}): number {
  return Number((traceCost / Math.max(targetCount, 1)).toFixed(6));
}

function toCount(value: number | string | null | undefined): number {
  return value === null || value === undefined ? 0 : Number(value);
}

/** Composite key — a runId is not unique across experiments. */
function experimentRunKey(experimentId: string, runId: string): string {
  return `${experimentId}:${runId}`;
}

/**
 * Fold the trace-derived cost into the run's item aggregate.
 *
 * `sumIf(TargetCost, …)` only ever sees the prices an item recorded for
 * itself, so on its own it reports zero for an SDK experiment whose rows are
 * all priced from their traces. The mean is recomputed rather than left on the
 * SQL `avgIf` for the same reason: its denominator counted only the inline
 * ones.
 */
function addTraceDerivedCost({
  aggregate,
  traceDerived,
}: {
  aggregate: ClickHouseRunAggregateRow;
  traceDerived: TraceDerivedRunCost | undefined;
}): ClickHouseCostSummaryRow {
  if (!traceDerived || traceDerived.cost <= 0) return aggregate;

  const datasetCost = (aggregate.datasetCost ?? 0) + traceDerived.cost;
  const pricedCount =
    toCount(aggregate.datasetPricedCount) + traceDerived.pricedItemCount;

  return {
    ...aggregate,
    datasetCost,
    datasetAverageCost: pricedCount > 0 ? datasetCost / pricedCount : null,
  };
}

/**
 * ClickHouse backend for experiment run queries.
 *
 * No-CH-client semantics: `listRuns`, `getRunAggregatesForExperimentIds`,
 * and `listRunsForExperimentPaginated` **throw** — ClickHouse is the only
 * backend after the ES removal, so an unavailable CH client is an infra
 * error worth surfacing.
 *
 * `getRun` is the documented exception: it returns `null` on no-CH so the
 * polling UX in `BatchEvaluationV2EvaluationResults` can render a clean
 * "loading" state while an event-sourcing fold catches up (see the
 * comment on `getRun` below).
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

          const runs = await this.enrichRunsWithBreakdownAndCosts({
            clickHouseClient,
            projectId,
            runRows,
          });

          // Group by experiment ID
          const result: Record<string, ExperimentRun[]> = {};
          for (const run of runs) {
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

          const runs = await this.enrichRunsWithBreakdownAndCosts({
            clickHouseClient,
            projectId,
            runRows,
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
   * Unlike the rest of this class, `getRun` returns `null` (rather than
   * throwing) when the CH client is unavailable OR when the run row has not
   * been folded into `experiment_runs` yet. The PR #3483 dogfood revealed
   * that a freshly-started eval-v3 run sits in a brief race window between
   * `runOrchestrator → commands.startExperimentRun` returning and the
   * `experiment-run-processing` pipeline projecting the row in CH; throwing
   * during that window caused a 500-cascade in the UI's 1s poller and hid
   * (more severe) downstream pipeline-stuck cases behind the same error
   * string. See `getRun-null.unit.test.ts` for the regression guard.
   *
   * The route caller at `routes/experiments-v3.ts` therefore collapses
   * `null` to a `404 run_not_found` — that 404 is intentional polling UX,
   * not infra masking. CH outages still surface elsewhere (every other read
   * on the experiment-run path throws).
   *
   * Worth being precise about what that costs, since the two cases behind
   * `null` are not equally benign: a run not folded yet is a 404 that the
   * next poll resolves, while ClickHouse being down is a 404 that lies until
   * it recovers. The route no longer widens that — its catch used to turn
   * EVERY failure into the same 404, so an outage anywhere in the handler
   * read as "no such run"; only a genuine miss answers 404 now, and anything
   * unnamed reaches the boundary as a 500 with a trace id. Separating the
   * two cases inside this method (a distinct "not folded yet" signal) is the
   * remaining piece, and it needs the poller's retry behaviour thought
   * through rather than a quick throw.
   *
   * @returns `null` if ClickHouse is unavailable OR if the run row has
   *   not been folded yet — see method-level docstring for the rationale.
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
          // Deliberately `null`, not `throw` — see method JSDoc above for
          // why this method diverges from the rest of the class.
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
            occurredAtRange,
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
   * Fetch per-evaluator breakdown, cost/duration summaries, and workflow
   * version metadata for the given run rows and map them to canonical
   * `ExperimentRun`s, preserving `runRows` order.
   *
   * Shared by {@link listRuns} and {@link listRunsForExperimentPaginated} so
   * the dedup key, OccurredAt bounds, and LIMIT handling live in one place.
   *
   * Builds the exact (ExperimentId, RunId) tuple list and an OccurredAt
   * bound from the runs passed in. Two reasons:
   *
   *   1. `ExperimentId IN (...) AND RunId IN (...)` would match the
   *      cartesian product of those sets, pulling in unrelated rows
   *      whenever a runId happens to be reused across experiments.
   *      Filtering by exact pairs eliminates that overfetching and
   *      avoids wasting LIMIT slots on rows that get discarded.
   *
   *   2. `experiment_run_items` is partitioned by `toYearWeek(OccurredAt)`.
   *      Without an OccurredAt range in the WHERE clause, ClickHouse
   *      cannot prune historical partitions and ends up scanning the
   *      whole table. Bounds derived from the runs' lifecycle
   *      (CreatedAt..UpdatedAt with a buffer for clock skew / late
   *      writes) keep this cheap.
   */
  private async enrichRunsWithBreakdownAndCosts({
    clickHouseClient,
    projectId,
    runRows,
  }: {
    clickHouseClient: ProjectClickHouseClient;
    projectId: string;
    runRows: ClickHouseExperimentRunRow[];
  }): Promise<ExperimentRun[]> {
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
    //
    // `datasetPricedCount` and `tracedCostlessCount` are the two counts the
    // trace-derived half of the cost needs: how many target items priced
    // themselves, and how many are still waiting on the trace they produced.
    // A run with none of the latter skips the trace reads entirely.
    //
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
          avgIf(EvaluationDurationMs, ResultType = 'evaluator' AND EvaluationDurationMs IS NOT NULL) AS evaluationsAverageDuration,
          countIf(ResultType = 'target' AND TargetCost IS NOT NULL) AS datasetPricedCount,
          countIf(ResultType = 'target' AND TargetCost IS NULL AND TraceId IS NOT NULL AND TraceId != '') AS tracedCostlessCount
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

    const costRows = (await costResult.json()) as ClickHouseRunAggregateRow[];

    // Same composite key as breakdownByExperimentRun.
    const aggregateByExperimentRun = new Map<
      string,
      ClickHouseRunAggregateRow
    >();
    for (const row of costRows) {
      aggregateByExperimentRun.set(
        experimentRunKey(row.ExperimentId, row.RunId),
        row,
      );
    }

    // An SDK experiment reports no inline cost at all, so its whole dataset
    // cost lives in the traces its targets produced. Runs that priced their
    // items inline skip both extra reads entirely.
    const traceCostByExperimentRun = costRows.some(
      (row) => toCount(row.tracedCostlessCount) > 0,
    )
      ? await this.computeTraceDerivedRunCosts({
          clickHouseClient,
          projectId,
          runPairs,
          occurredAtRange,
        })
      : new Map<string, TraceDerivedRunCost>();

    // Fetch workflow version metadata from Prisma
    const versionIds = runRows
      .map((r) => r.WorkflowVersionId)
      .filter((id): id is string => id !== null);

    const versionsMap = await getVersionMap({
      prisma: this.prisma,
      projectId,
      versionIds,
    });

    return runRows.map((row) => {
      const compositeKey = experimentRunKey(row.ExperimentId, row.RunId);
      const aggregate = aggregateByExperimentRun.get(compositeKey);
      return mapClickHouseRunToExperimentRun({
        record: row,
        workflowVersion: row.WorkflowVersionId
          ? (versionsMap[row.WorkflowVersionId] ?? null)
          : null,
        evaluatorBreakdown: breakdownByExperimentRun.get(compositeKey),
        costSummary: aggregate
          ? addTraceDerivedCost({
              aggregate,
              traceDerived: traceCostByExperimentRun.get(compositeKey),
            })
          : undefined,
      });
    });
  }

  /**
   * Price each run's cost-less target items from the traces they produced.
   *
   * Returns the same figure `enrichItemsWithTraceCosts` puts on the rows,
   * summed per run: a trace shared by several targets is divided between them
   * and therefore counted once in the total, and a target that reported its
   * own cost is left alone (the two are alternative sources for one figure,
   * not addends — adding them is what double-counted a traced target before
   * ADR-072 (retired; ground now ADR-103)).
   *
   * Two reads rather than one join: resolving a trace's latest version needs a
   * dedup over `trace_summaries` that cannot be expressed inside the item
   * grouping without filtering versions by an `OccurredAt` that shifts across
   * them. Both are skipped entirely when no run has a cost-less traced item.
   */
  private async computeTraceDerivedRunCosts({
    clickHouseClient,
    projectId,
    runPairs,
    occurredAtRange,
  }: {
    clickHouseClient: ProjectClickHouseClient;
    projectId: string;
    runPairs: TupleParam[];
    occurredAtRange: { minOccurredAt: string; maxOccurredAt: string };
  }): Promise<Map<string, TraceDerivedRunCost>> {
    const byExperimentRun = new Map<string, TraceDerivedRunCost>();

    // Group the run's target items by the trace they produced. Only the
    // lightweight key columns are read — the dedup resolves on
    // (key columns, OccurredAt), never on the heavy payload columns.
    const groupResult = await clickHouseClient.query({
      query: `
        SELECT
          ExperimentId,
          RunId,
          TraceId,
          count() AS targetCount,
          countIf(TargetCost IS NULL) AS costlessCount
        FROM experiment_run_items
        WHERE TenantId = {tenantId:String}
          AND OccurredAt >= {minOccurredAt:DateTime64(3)}
          AND OccurredAt <= {maxOccurredAt:DateTime64(3)}
          AND (ExperimentId, RunId) IN {runPairs:Array(Tuple(String, String))}
          AND ResultType = 'target'
          AND TraceId IS NOT NULL
          AND TraceId != ''
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
        GROUP BY ExperimentId, RunId, TraceId
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

    const groupRows =
      (await groupResult.json()) as ClickHouseRunTraceGroupRow[];
    const pricedGroups = groupRows.filter(
      (row) => toCount(row.costlessCount) > 0,
    );
    if (pricedGroups.length === 0) return byExperimentRun;

    const costByTraceId = await this.fetchTraceCosts({
      clickHouseClient,
      projectId,
      traceIds: [...new Set(pricedGroups.map((row) => row.TraceId))],
      occurredAtRange,
    });

    for (const row of pricedGroups) {
      const traceCost = costByTraceId.get(row.TraceId);
      if (traceCost === undefined) continue;

      const costlessCount = toCount(row.costlessCount);
      const perTargetCost = splitTraceCostAcrossTargets({
        traceCost,
        targetCount: toCount(row.targetCount),
      });

      const key = experimentRunKey(row.ExperimentId, row.RunId);
      const running = byExperimentRun.get(key) ?? {
        cost: 0,
        pricedItemCount: 0,
      };
      running.cost += perTargetCost * costlessCount;
      running.pricedItemCount += costlessCount;
      byExperimentRun.set(key, running);
    }

    return byExperimentRun;
  }

  /**
   * Read the current price of each trace, resolving its latest version.
   *
   * The read carries no memory of what it answered last time, which is what
   * makes a repricing safe: a trace whose spans land late reports its newer
   * figure on the next read and the same figure on every read after that.
   *
   * Shared by the item enrichment and the run total so both quote one price
   * per trace. Bounds `OccurredAt` to the run's lifecycle window on the outer
   * read only — `trace_summaries` is partitioned by `toYearWeek(OccurredAt)`
   * and a TraceId-only filter cannot prune, but `OccurredAt` can shift across
   * ReplacingMergeTree versions (a late span can move a trace's start time),
   * so filtering versions before resolving the latest could pick the wrong
   * one. Filtering the already-deduped outer rows is always correct.
   */
  private async fetchTraceCosts({
    clickHouseClient,
    projectId,
    traceIds,
    occurredAtRange,
  }: {
    clickHouseClient: ProjectClickHouseClient;
    projectId: string;
    traceIds: string[];
    occurredAtRange: { minOccurredAt: string; maxOccurredAt: string };
  }): Promise<Map<string, number>> {
    const costByTraceId = new Map<string, number>();
    if (traceIds.length === 0) return costByTraceId;

    const traceCostResult = await clickHouseClient.query({
      query: `
        SELECT
          TraceId,
          TotalCost
        FROM trace_summaries
        WHERE TenantId = {tenantId:String}
          AND TraceId IN ({traceIds:Array(String)})
          AND OccurredAt >= {minOccurredAt:DateTime64(3)}
          AND OccurredAt <= {maxOccurredAt:DateTime64(3)}
          AND (TenantId, TraceId, UpdatedAt) IN (
            SELECT TenantId, TraceId, max(UpdatedAt)
            FROM trace_summaries
            WHERE TenantId = {tenantId:String}
              AND TraceId IN ({traceIds:Array(String)})
            GROUP BY TenantId, TraceId
          )
      `,
      query_params: {
        tenantId: projectId,
        traceIds,
        minOccurredAt: occurredAtRange.minOccurredAt,
        maxOccurredAt: occurredAtRange.maxOccurredAt,
      },
      format: "JSONEachRow",
    });

    const traceCostRows = await traceCostResult.json<{
      TraceId: string;
      TotalCost: number | null;
    }>();

    for (const row of traceCostRows) {
      if (row.TotalCost !== null && row.TotalCost > 0) {
        costByTraceId.set(row.TraceId, row.TotalCost);
      }
    }

    return costByTraceId;
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
    clickHouseClient: ProjectClickHouseClient,
    projectId: string,
    items: ClickHouseExperimentRunItemRow[],
    occurredAtRange: { minOccurredAt: string; maxOccurredAt: string },
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
      const costByTraceId = await this.fetchTraceCosts({
        clickHouseClient,
        projectId,
        traceIds,
        occurredAtRange,
      });

      if (costByTraceId.size === 0) return items;

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

        return {
          ...item,
          TargetCost: splitTraceCostAcrossTargets({
            traceCost,
            targetCount: targetCountByTraceId.get(item.TraceId) ?? 1,
          }),
        };
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
