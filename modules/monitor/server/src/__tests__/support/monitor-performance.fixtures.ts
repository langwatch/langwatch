/**
 * The migrated ClickHouse, the rows the monitor-performance suite seeds, and
 * the analytics-page read it compares the monitors table against.
 * @see specs/analytics/evaluation-pass-rate-consistency.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { buildSeriesName, type AnalyticsSeries } from "@langwatch/analytics-contract";
import { AnalyticsAdapter } from "@langwatch/analytics-server";
import { ClickHouseMigrateTask, DEFAULT_CLICKHOUSE_SETTINGS } from "@langwatch/clickhouse-client";
import { startTestClickHouseEndpoints } from "@langwatch/test-harness";
import { nanoid } from "nanoid";

const DAY_MS = 24 * 60 * 60 * 1000;
const HALF_DAY_MS = 12 * 60 * 60 * 1000;

/**
 * The endpoint name the migrated-schema suites share. The migrations take far
 * longer than the assertions and per-tenant ids already keep the suites' rows
 * apart, so one migrated database serves them all.
 */
const MIGRATED_ENDPOINT_SUITE = "analytics-migrated";

const migratedUrls = new Set<string>();
let migrated: { client: ClickHouseClient; url: string } | undefined;

/**
 * Starts (or reuses) the migrated endpoint and returns a client bound to it.
 * `CLICKHOUSE_CLUSTER` is unset for the migration: it switches every engine to
 * its `Replicated` form, which needs a Keeper no test server has.
 */
export async function startMigratedClickHouse(): Promise<ClickHouseClient> {
  if (migrated) return migrated.client;

  const [provisioned] = await startTestClickHouseEndpoints({
    suite: MIGRATED_ENDPOINT_SUITE,
    names: ["schema"],
  });
  if (!provisioned) throw new Error("No ClickHouse endpoint was provisioned for the schema suite");

  if (!migratedUrls.has(provisioned.url)) {
    const previousCluster = process.env.CLICKHOUSE_CLUSTER;
    delete process.env.CLICKHOUSE_CLUSTER;
    try {
      await ClickHouseMigrateTask.createFromConfig({
        config: {
          buildTime: false,
          skipped: false,
          sharedUrl: provisioned.url,
          privateEndpoints: [],
        },
      }).execute();
    } finally {
      if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
    }
    migratedUrls.add(provisioned.url);
  }

  migrated = {
    url: provisioned.url,
    client: createClient({
      url: provisioned.url,
      clickhouse_settings: {
        ...DEFAULT_CLICKHOUSE_SETTINGS,
        date_time_input_format: "best_effort",
      },
    }),
  };
  return migrated.client;
}

/** Deletes one tenant's seeded rows from the shared migrated database. */
export async function deleteSeededTenantRows({
  client,
  tenantId,
}: {
  client: ClickHouseClient;
  tenantId: string;
}): Promise<void> {
  for (const table of ["trace_summaries", "evaluation_runs"]) {
    await client.command({
      query: `ALTER TABLE ${table} DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
}

export interface SeededEvaluation {
  traceId: string;
  /** When the trace occurred; omitted to leave the run without a trace. */
  traceOccurredAtMs?: number;
  scheduledAtMs: number;
  evaluatorId: string;
  score: number | null;
  passed: number | null;
  status?: string;
  evaluationId?: string;
  updatedAtMs?: number;
}

const traceSummaryRow = ({
  tenantId,
  traceId,
  occurredAtMs,
}: {
  tenantId: string;
  traceId: string;
  occurredAtMs: number;
}) => {
  const occurredAt = new Date(occurredAtMs);
  return {
    ProjectionId: `projection-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: occurredAt,
    CreatedAt: occurredAt,
    UpdatedAt: occurredAt,
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TimeToFirstTokenMs: 50,
    TimeToLastTokenMs: 200,
    TotalDurationMs: 200,
    TokensPerSecond: 100,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    ErrorMessage: null,
    Models: ["gpt-5-mini"],
    TotalCost: 0.01,
    TokensEstimated: false,
    TotalPromptTokenCount: 100,
    TotalCompletionTokenCount: 50,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
  };
};

const evaluationRunRow = ({
  tenantId,
  seed: {
    traceId,
    scheduledAtMs,
    evaluatorId,
    score,
    passed,
    status = "processed",
    evaluationId = `eval-${nanoid()}`,
    updatedAtMs = scheduledAtMs,
  },
}: {
  tenantId: string;
  seed: SeededEvaluation;
}) => ({
  ProjectionId: `projection-${nanoid()}`,
  TenantId: tenantId,
  EvaluationId: evaluationId,
  Version: "1",
  EvaluatorId: evaluatorId,
  EvaluatorType: "langevals/test",
  TraceId: traceId,
  Status: status,
  Score: score,
  Passed: passed,
  Label: null,
  ScheduledAt: new Date(scheduledAtMs),
  UpdatedAt: new Date(updatedAtMs),
  LastProcessedEventId: `event-${nanoid()}`,
});

/**
 * Uneven daily volumes, a corrected revision, a run scheduled in the current
 * window for a previous-window trace, a non-processed run, a run without a
 * trace, and a trace outside the whole window.
 */
export const buildSeedMatrix = ({
  tenantId,
  scoreEvaluatorId,
  guardrailEvaluatorId,
  currentStartMs,
  previousStartMs,
}: {
  tenantId: string;
  scoreEvaluatorId: string;
  guardrailEvaluatorId: string;
  currentStartMs: number;
  previousStartMs: number;
}): SeededEvaluation[] => {
  const correctedEvaluationId = `corrected-${nanoid()}`;
  const correctedTraceId = `${tenantId}-trace-corrected`;
  const day1Ms = currentStartMs + DAY_MS + HALF_DAY_MS;
  const day2Ms = currentStartMs + 2 * DAY_MS + HALF_DAY_MS;
  const day3Ms = currentStartMs + 3 * DAY_MS + HALF_DAY_MS;

  return [
    // Day 1 carries uneven scores so the daily average differs from the
    // run-weighted period average.
    {
      traceId: `${tenantId}-trace-1`,
      traceOccurredAtMs: day1Ms,
      scheduledAtMs: day1Ms + 60_000,
      evaluatorId: scoreEvaluatorId,
      score: 0.2,
      passed: 0,
    },
    {
      traceId: `${tenantId}-trace-2`,
      traceOccurredAtMs: day1Ms,
      scheduledAtMs: day1Ms + 120_000,
      evaluatorId: scoreEvaluatorId,
      score: 0.8,
      passed: 1,
    },
    {
      traceId: `${tenantId}-trace-3`,
      traceOccurredAtMs: day2Ms,
      scheduledAtMs: day2Ms + 60_000,
      evaluatorId: scoreEvaluatorId,
      score: 1,
      passed: 1,
    },
    // A corrected evaluation: only the latest revision may count.
    {
      traceId: correctedTraceId,
      traceOccurredAtMs: day3Ms,
      scheduledAtMs: day3Ms + 60_000,
      evaluatorId: scoreEvaluatorId,
      score: 0.1,
      passed: 0,
      evaluationId: correctedEvaluationId,
    },
    {
      traceId: correctedTraceId,
      scheduledAtMs: day3Ms + 60_000,
      evaluatorId: scoreEvaluatorId,
      score: 0.9,
      passed: 1,
      evaluationId: correctedEvaluationId,
      updatedAtMs: day3Ms + 61_000,
    },
    // Previous-period run.
    {
      traceId: `${tenantId}-trace-previous`,
      traceOccurredAtMs: currentStartMs - 2 * DAY_MS,
      scheduledAtMs: currentStartMs - 2 * DAY_MS + 60_000,
      evaluatorId: scoreEvaluatorId,
      score: 0.4,
      passed: 0,
    },
    // The trace occurred in the previous period but the evaluation only ran
    // during the current one: both surfaces count it in the previous period
    // because a run belongs to the day its trace occurred.
    {
      traceId: `${tenantId}-trace-late-eval`,
      traceOccurredAtMs: currentStartMs - DAY_MS,
      scheduledAtMs: currentStartMs + 4 * DAY_MS,
      evaluatorId: scoreEvaluatorId,
      score: 0.6,
      passed: 1,
    },
    // Non-processed run: excluded everywhere.
    {
      traceId: `${tenantId}-trace-error`,
      traceOccurredAtMs: day2Ms,
      scheduledAtMs: day2Ms + 90_000,
      evaluatorId: scoreEvaluatorId,
      score: null,
      passed: null,
      status: "error",
    },
    // Run without any trace summary: excluded everywhere.
    {
      traceId: `${tenantId}-trace-missing`,
      scheduledAtMs: day2Ms + 100_000,
      evaluatorId: scoreEvaluatorId,
      score: 0,
      passed: 0,
    },
    // Trace outside the whole comparison window: excluded everywhere even
    // though the evaluation was scheduled inside the current period.
    {
      traceId: `${tenantId}-trace-out-of-window`,
      traceOccurredAtMs: previousStartMs - DAY_MS,
      scheduledAtMs: currentStartMs + DAY_MS,
      evaluatorId: scoreEvaluatorId,
      score: 0.05,
      passed: 0,
    },
    // Guardrail runs.
    {
      traceId: `${tenantId}-trace-guard-1`,
      traceOccurredAtMs: day1Ms,
      scheduledAtMs: day1Ms + 60_000,
      evaluatorId: guardrailEvaluatorId,
      score: null,
      passed: 1,
    },
    {
      traceId: `${tenantId}-trace-guard-2`,
      traceOccurredAtMs: day1Ms,
      scheduledAtMs: day1Ms + 120_000,
      evaluatorId: guardrailEvaluatorId,
      score: null,
      passed: 0,
    },
    {
      traceId: `${tenantId}-trace-guard-previous`,
      traceOccurredAtMs: currentStartMs - 3 * DAY_MS,
      scheduledAtMs: currentStartMs - 3 * DAY_MS + 60_000,
      evaluatorId: guardrailEvaluatorId,
      score: null,
      passed: 1,
    },
    {
      traceId: `${tenantId}-trace-guard-error`,
      traceOccurredAtMs: day2Ms,
      scheduledAtMs: day2Ms + 60_000,
      evaluatorId: guardrailEvaluatorId,
      score: null,
      passed: null,
      status: "error",
    },
  ];
};

export const seedMonitorPerformance = async ({
  client,
  tenantId,
  seeded,
}: {
  client: ClickHouseClient;
  tenantId: string;
  seeded: SeededEvaluation[];
}) => {
  const traceRows = seeded
    .filter((evaluation) => evaluation.traceOccurredAtMs !== undefined)
    .map((evaluation) =>
      traceSummaryRow({
        tenantId,
        traceId: evaluation.traceId,
        occurredAtMs: evaluation.traceOccurredAtMs!,
      }),
    );
  const evaluationRows = seeded.map((seed) => evaluationRunRow({ tenantId, seed }));

  await client.insert({
    table: "trace_summaries",
    values: traceRows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
  await client.insert({
    table: "evaluation_runs",
    values: evaluationRows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
};

export type AnalyticsPageMetric =
  | "evaluations.evaluation_score"
  | "evaluations.evaluation_pass_rate";

const finiteOrNull = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const analyticsPageSeries = ({
  evaluatorId,
  metric,
}: {
  evaluatorId: string;
  metric: AnalyticsPageMetric;
}): AnalyticsSeries => ({
  metric,
  aggregation: "avg",
  key: evaluatorId,
  filters: {
    "evaluations.state": {
      [evaluatorId]: ["processed"],
    },
  },
});

/**
 * Reads the evaluator the way the analytics page does: a keyed series with a
 * processed filter, routed to the same `evaluation_runs` join the monitors
 * table reads — daily for the chart, full-period for the headline.
 */
export const readAnalyticsPageNumbers = async ({
  client,
  tenantId,
  evaluatorId,
  metric,
  currentStartMs,
  endMs,
}: {
  client: ClickHouseClient;
  tenantId: string;
  evaluatorId: string;
  metric: AnalyticsPageMetric;
  currentStartMs: number;
  endMs: number;
}) => {
  const analytics = AnalyticsAdapter.create({
    resolveClient: async () => client,
    clickhouseEnabled: true,
  });
  const series = analyticsPageSeries({ evaluatorId, metric });
  const baseInput = {
    projectId: tenantId,
    startDate: currentStartMs,
    endDate: endMs,
    filters: {},
    series: [series],
    timeZone: "UTC",
  };
  const [daily, full] = await Promise.all([
    analytics.getTimeseries({ ...baseInput, timeScale: 24 * 60 }),
    analytics.getTimeseries({ ...baseInput, timeScale: "full" }),
  ]);
  const key = buildSeriesName(series, 0);

  return {
    current: finiteOrNull(full.currentPeriod[0]?.[key]),
    previous: finiteOrNull(full.previousPeriod[0]?.[key]),
    dailyValues: daily.currentPeriod
      .map((bucket) => finiteOrNull(bucket[key]))
      .filter((value): value is number => value !== null),
  };
};
