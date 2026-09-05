/**
 * Executed-SQL coverage for the `evaluation_runs` JOIN's partition bounds.
 *
 * The JOIN subquery and its IN-tuple dedup inner are both bounded below on
 * `ScheduledAt` and `evaluation_runs.UpdatedAt`, so the weekly partitions
 * prune instead of the tenant's whole evaluation history being walked on every
 * graph. The bounds are lower-only, and that is the whole correctness
 * argument: an evaluation is inserted at or after the trace it scores, but it
 * can be scheduled arbitrarily later than the window the graph asks about, and
 * a re-evaluation writes a newer row version later still.
 *
 * Every other analytics fixture schedules the evaluation at the same instant
 * as its trace, so none of them can tell a lower bound from an upper one.
 * These cases pin the shapes that can: an evaluation scheduled months after
 * the queried window on a trace inside it, row versions spread across weekly
 * partitions and inserted out of order, and two versions tied on `UpdatedAt`.
 *
 * @see specs/analytics/evaluation-runs-join-time-bounds.feature
 * @see https://github.com/langwatch/langwatch/issues/6392
 *
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { AnalyticsAggregation, FilterField } from "@langwatch/analytics-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness";
import {
  buildDataForFilterQuery,
  buildTimeseriesQuery,
} from "../clickhouse.aggregation-builder.mapper";
import { resetParamCounter } from "../clickhouse.filter-translator.mapper";

const TENANT_ID = "test-eval-join-bounds-6392";
const SEEDED_TABLES = ["trace_summaries", "evaluation_runs"] as const;

/**
 * June 2025, with May as the comparison period. The generated bound sits 7
 * days below the previous period's start (2025-04-24), so anything the
 * fixtures schedule after that date is inside the bound and anything before it
 * is not.
 */
const baseInput = {
  projectId: TENANT_ID,
  startDate: new Date("2025-06-01T00:00:00Z"),
  endDate: new Date("2025-07-01T00:00:00Z"),
  previousPeriodStartDate: new Date("2025-05-01T00:00:00Z"),
  timeScale: "full" as const,
};

const LATE_EVALUATOR = "eval-bounds-6392-late-scheduled";
const VERSIONED_EVALUATOR = "eval-bounds-6392-versioned";
const TIED_EVALUATOR = "eval-bounds-6392-tied";

const TRACE_LATE_A = `${TENANT_ID}-trace-late-a`;
const TRACE_LATE_B = `${TENANT_ID}-trace-late-b`;
const TRACE_VERSIONED = `${TENANT_ID}-trace-versioned`;
const TRACE_TIED = `${TENANT_ID}-trace-tied`;

/** Every trace sits inside the queried window; only the evaluations move. */
const traceOccurredAt: Record<string, string> = {
  [TRACE_LATE_A]: "2025-06-10T12:00:00Z",
  [TRACE_LATE_B]: "2025-06-11T12:00:00Z",
  [TRACE_VERSIONED]: "2025-06-12T12:00:00Z",
  [TRACE_TIED]: "2025-06-13T12:00:00Z",
};

function traceSummaryRow(traceId: string): Record<string, unknown> {
  const occurredAt = traceOccurredAt[traceId];
  return {
    ProjectionId: `proj-${traceId}`,
    TenantId: TENANT_ID,
    TraceId: traceId,
    Version: "1",
    Attributes: {},
    OccurredAt: occurredAt,
    CreatedAt: occurredAt,
    UpdatedAt: occurredAt,
    ComputedIOSchemaVersion: "",
    ComputedInput: "",
    ComputedOutput: "",
    TotalDurationMs: 0,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    Models: [],
    TotalCost: 0,
    TokensEstimated: false,
    // Backdated fixture: the never-expire sentinel keeps the retention TTL
    // from deleting the seed rows.
    _retention_days: 0,
  };
}

function evaluationRunRow({
  evaluationId,
  evaluatorId,
  traceId,
  scheduledAt,
  updatedAt,
  score,
}: {
  evaluationId: string;
  evaluatorId: string;
  traceId: string;
  scheduledAt: string;
  updatedAt: string;
  score: number;
}): Record<string, unknown> {
  return {
    ProjectionId: `proj-${evaluationId}-${updatedAt}`,
    TenantId: TENANT_ID,
    EvaluationId: evaluationId,
    Version: "1",
    EvaluatorId: evaluatorId,
    EvaluatorType: "custom",
    TraceId: traceId,
    Status: "processed",
    Score: score,
    Passed: null,
    Label: null,
    LastProcessedEventId: `evt-${evaluationId}-${updatedAt}`,
    ScheduledAt: scheduledAt,
    CreatedAt: scheduledAt,
    UpdatedAt: updatedAt,
    _retention_days: 0,
  };
}

type Row = Record<string, unknown>;

/**
 * The metric column of a timeseries result. The alias is derived from the
 * series, so the cases read it back rather than restating it.
 */
function metricValue(rows: Row[], period: string): number {
  const row = rows.find((candidate) => candidate.period === period);
  if (!row) throw new Error(`no ${period} row in ${JSON.stringify(rows)}`);
  const key = Object.keys(row).find(
    (candidate) => candidate !== "period" && candidate !== "date" && candidate !== "group_key",
  );
  if (!key) throw new Error(`no metric column in ${JSON.stringify(row)}`);
  return Number(row[key]);
}

describe("the evaluation_runs JOIN time bounds", () => {
  let client: ClickHouseClient;

  async function currentPeriodMetric({
    metric,
    aggregation,
    evaluatorId,
  }: {
    metric: string;
    aggregation: AnalyticsAggregation;
    evaluatorId: string;
  }): Promise<number> {
    resetParamCounter();
    const { sql, params } = buildTimeseriesQuery({
      ...baseInput,
      series: [{ metric, aggregation, key: evaluatorId }],
    });
    const result = await client.query({
      query: sql,
      query_params: params,
      format: "JSONEachRow",
    });
    return metricValue(await result.json<Row>(), "current");
  }

  beforeAll(async () => {
    client = (await startMigratedClickHouse()).client;

    // Every assertion below is an exact count or an exact aggregate, so the
    // tenant has to be empty before seeding: rows surviving an aborted run
    // would join this one and inflate all of them.
    await deleteMigratedTenantRows({ client, tenantId: TENANT_ID, tables: SEEDED_TABLES });

    await client.insert({
      table: "trace_summaries",
      values: Object.keys(traceOccurredAt).map(traceSummaryRow),
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });

    await client.insert({
      table: "evaluation_runs",
      values: [
        // Scheduled months after the window the graph asks about, on traces
        // inside it. An upper bound of any width would drop both.
        evaluationRunRow({
          evaluationId: "eval-bounds-6392-late-a",
          evaluatorId: LATE_EVALUATOR,
          traceId: TRACE_LATE_A,
          scheduledAt: "2025-09-15T08:00:00Z",
          updatedAt: "2025-09-15T08:00:00Z",
          score: 0.8,
        }),
        evaluationRunRow({
          evaluationId: "eval-bounds-6392-late-b",
          evaluatorId: LATE_EVALUATOR,
          traceId: TRACE_LATE_B,
          scheduledAt: "2025-12-20T08:00:00Z",
          updatedAt: "2025-12-20T08:00:00Z",
          score: 0.6,
        }),

        // One evaluation, three row versions, three different weekly
        // partitions, inserted newest first. ReplacingMergeTree collapses
        // within a partition only, so all three survive on disk and the
        // IN-tuple dedup is the only thing that picks the newest.
        evaluationRunRow({
          evaluationId: "eval-bounds-6392-versioned",
          evaluatorId: VERSIONED_EVALUATOR,
          traceId: TRACE_VERSIONED,
          scheduledAt: "2025-09-20T00:00:00Z",
          updatedAt: "2025-09-21T00:00:00Z",
          score: 1,
        }),
        evaluationRunRow({
          evaluationId: "eval-bounds-6392-versioned",
          evaluatorId: VERSIONED_EVALUATOR,
          traceId: TRACE_VERSIONED,
          scheduledAt: "2025-06-12T12:00:00Z",
          updatedAt: "2025-06-12T12:00:00Z",
          score: 0,
        }),
        evaluationRunRow({
          evaluationId: "eval-bounds-6392-versioned",
          evaluatorId: VERSIONED_EVALUATOR,
          traceId: TRACE_VERSIONED,
          scheduledAt: "2025-08-14T00:00:00Z",
          updatedAt: "2025-08-15T00:00:00Z",
          score: 0.5,
        }),

        // Two versions tied on UpdatedAt in separate partitions: both match
        // max(UpdatedAt), so both reach the outer query.
        evaluationRunRow({
          evaluationId: "eval-bounds-6392-tied",
          evaluatorId: TIED_EVALUATOR,
          traceId: TRACE_TIED,
          scheduledAt: "2025-10-01T00:00:00Z",
          updatedAt: "2025-10-01T00:00:00Z",
          score: 0.25,
        }),
        evaluationRunRow({
          evaluationId: "eval-bounds-6392-tied",
          evaluatorId: TIED_EVALUATOR,
          traceId: TRACE_TIED,
          scheduledAt: "2025-11-05T00:00:00Z",
          updatedAt: "2025-10-01T00:00:00Z",
          score: 0.25,
        }),
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }, 120_000);

  afterAll(async () => {
    await deleteMigratedTenantRows({ client, tenantId: TENANT_ID, tables: SEEDED_TABLES });
  });

  describe("given an evaluation scheduled long after the queried window, on a trace inside it", () => {
    /** @scenario An evaluation scheduled after the queried window still scores its in-window trace */
    it("returns the evaluation score", async () => {
      const score = await currentPeriodMetric({
        metric: "evaluations.evaluation_score",
        aggregation: "avg",
        evaluatorId: LATE_EVALUATOR,
      });

      expect(score).toBeCloseTo(0.7, 10);
    });

    /** @scenario Both late-scheduled evaluations are counted, not just the nearest one */
    it("counts every late-scheduled evaluation", async () => {
      const runs = await currentPeriodMetric({
        metric: "evaluations.evaluation_runs",
        aggregation: "cardinality",
        evaluatorId: LATE_EVALUATOR,
      });

      expect(runs).toBe(2);
    });

    /** @scenario A late-scheduled evaluator is still offered as a filter value */
    it("lists the evaluator in the filter values for the window", async () => {
      resetParamCounter();
      const { sql, params } = buildDataForFilterQuery(
        TENANT_ID,
        "evaluations.evaluator_id" satisfies FilterField,
        baseInput.startDate,
        baseInput.endDate,
      );

      const result = await client.query({
        query: sql,
        query_params: params,
        format: "JSONEachRow",
      });
      const fields = (await result.json<Row>()).map((row) => row.field);

      expect(fields).toContain(LATE_EVALUATOR);
    });
  });

  describe("given one evaluation with row versions across weekly partitions, inserted out of UpdatedAt order", () => {
    /** @scenario The dedup keeps the newest version of an evaluation spread across partitions */
    it("scores the evaluation from its newest version only", async () => {
      const average = await currentPeriodMetric({
        metric: "evaluations.evaluation_score",
        aggregation: "avg",
        evaluatorId: VERSIONED_EVALUATOR,
      });
      const sum = await currentPeriodMetric({
        metric: "evaluations.evaluation_score",
        aggregation: "sum",
        evaluatorId: VERSIONED_EVALUATOR,
      });

      expect(average).toBeCloseTo(1, 10);
      expect(sum).toBeCloseTo(1, 10);
    });
  });

  describe("given two row versions of one evaluation tied on UpdatedAt", () => {
    /** @scenario A tie on UpdatedAt leaves both row versions in the join */
    it("reads both tied versions when it queries the evaluator's runs and score", async () => {
      const runs = await currentPeriodMetric({
        metric: "evaluations.evaluation_runs",
        aggregation: "cardinality",
        evaluatorId: TIED_EVALUATOR,
      });
      const average = await currentPeriodMetric({
        metric: "evaluations.evaluation_score",
        aggregation: "avg",
        evaluatorId: TIED_EVALUATOR,
      });
      const sum = await currentPeriodMetric({
        metric: "evaluations.evaluation_score",
        aggregation: "sum",
        evaluatorId: TIED_EVALUATOR,
      });

      // The dedup keeps every version whose UpdatedAt equals the max, so a tie
      // keeps both. A distinct count and an average absorb that; a sum does
      // not. The bounds do not change it either way: both versions clear them.
      expect(runs).toBe(1);
      expect(average).toBeCloseTo(0.25, 10);
      expect(sum).toBeCloseTo(0.5, 10);
    });
  });
});
