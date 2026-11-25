import { randomUUID } from "node:crypto";

/**
 * An aggregate's evaluation series counts a member's evaluation only when its trace is inside the
 * grant's window. An evaluation is timed when it ran, so a pre-share trace's later evaluation
 * would pass a window on the evaluation's own time (ADR-177 v4.15).
 * @see specs/governance/aggregate-project.feature
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  buildSeriesName,
  type AnalyticsSeries,
  type AnalyticsTimeseriesInput,
  type AnalyticsTimeseriesResult,
} from "@langwatch/analytics-contract";
import type { Authorization } from "@langwatch/authorization";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  deleteMigratedTenantRows,
  startMigratedClickHouse,
} from "../../../__tests__/migrated-clickhouse.harness.ts";
import { analyticsProof } from "../../__tests__/analytics-proof.fixture.ts";
import { ClickHouseAnalyticsRepository } from "../clickhouse.analytics.repository.ts";
import { clickHouseQueryClientOver } from "./support/clickhouse-query-client.support.ts";

const RUN = randomUUID();
const AGGREGATE = `test-agg-eval-window-${RUN}`;
const MEMBER = `test-agg-eval-window-member-${RUN}`;
const SEEDED_TABLES = [
  "trace_summaries",
  "evaluation_runs",
  "evaluation_analytics",
  "evaluation_analytics_rollup",
] as const;

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);
const GRANT_FROM = at("10:00:00");
/** Both evaluations run after the grant opens; only the second one's trace does. */
const EVALUATED_AT = "10:45:00";

const TRACES = [
  { traceId: `trace-${RUN}-before-share`, time: "09:30:00" },
  { traceId: `trace-${RUN}-after-share`, time: "10:30:00" },
] as const;

/** The Evaluations page's "Total evaluation runs", its empty key dropped as the service does. */
const RUNS_SERIES: AnalyticsSeries = {
  metric: "evaluations.evaluation_runs",
  aggregation: "cardinality",
};

let client: ClickHouseClient;
let repository: ClickHouseAnalyticsRepository;

function traceSummaryRow({ traceId, time }: (typeof TRACES)[number]) {
  const occurredAt = new Date(at(time).epochMilliseconds);
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: MEMBER,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: occurredAt,
    CreatedAt: occurredAt,
    UpdatedAt: occurredAt,
    ComputedIOSchemaVersion: "",
    ComputedInput: "in",
    ComputedOutput: "out",
    TotalDurationMs: 200,
    SpanCount: 1,
    ContainsErrorStatus: 0,
    ContainsOKStatus: 1,
    ErrorMessage: null,
    Models: [],
    TotalCost: 0,
    TokensEstimated: false,
    TotalPromptTokenCount: 0,
    TotalCompletionTokenCount: 0,
    OutputFromRootSpan: 0,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: 0,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
  };
}

const evaluationIdOf = ({ traceId }: (typeof TRACES)[number]) => `eval-${traceId}`;
const evaluatedAt = () => new Date(at(EVALUATED_AT).epochMilliseconds);

function evaluationRunRow(trace: (typeof TRACES)[number]) {
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: MEMBER,
    EvaluationId: evaluationIdOf(trace),
    Version: "1",
    EvaluatorId: `${RUN}-check`,
    EvaluatorType: "langevals/exact_match",
    TraceId: trace.traceId,
    Status: "processed",
    Score: 1,
    Passed: 1,
    Label: null,
    LastProcessedEventId: `evt-${randomUUID()}`,
    ScheduledAt: evaluatedAt().toISOString(),
    UpdatedAt: evaluatedAt().toISOString(),
  };
}

function evaluationAnalyticsRow(trace: (typeof TRACES)[number]) {
  return {
    TenantId: MEMBER,
    EvaluationId: evaluationIdOf(trace),
    Version: "2026-10-05",
    OccurredAt: evaluatedAt(),
    CreatedAt: evaluatedAt(),
    UpdatedAt: evaluatedAt(),
    EvaluatorType: "langevals/exact_match",
    Status: "processed",
    IsGuardrail: false,
    Passed: true,
    Score: 1,
    TraceId: trace.traceId,
    DurationMs: 0,
    Attributes: {},
  };
}

function evaluationRollupRow() {
  return {
    TenantId: MEMBER,
    BucketStart: evaluatedAt(),
    EvaluatorType: "langevals/exact_match",
    Status: "processed",
    EvalCount: 1,
    PassCount: 1,
    FailCount: 0,
    ErrorCount: 0,
    SkippedCount: 0,
    ScoreSum: 1,
    ScoreCount: 1,
    DurationSum: 0,
    CostSum: 0,
    NonBilledCostSum: 0,
  };
}

const INPUT: AnalyticsTimeseriesInput = {
  projectId: AGGREGATE,
  startDate: at("08:00:00").epochMilliseconds,
  endDate: at("14:00:00").epochMilliseconds,
  filters: {},
  series: [RUNS_SERIES],
  timeScale: "full",
  timeZone: "UTC",
};

/** The evaluation runs a proof reads, through the table the series is routed to for it. */
async function countRuns({
  authorization,
  projectId,
  readsMembers,
}: {
  authorization: Authorization;
  projectId: string;
  readsMembers: boolean;
}): Promise<number> {
  const input = { ...INPUT, projectId };
  const table = repository.tableFor(input, { readsMembers });
  const startDate = at("08:00:00");
  const result: AnalyticsTimeseriesResult = await repository.runTimeseries({
    table,
    authorization,
    input,
    startDate,
    endDate: at("14:00:00"),
    previousPeriodStartDate: startDate,
    adjustedTimeScale: "full",
    maxResultRows: undefined,
  });
  const name = buildSeriesName(RUNS_SERIES, 0);
  return result.currentPeriod.reduce((sum, bucket) => sum + Number(bucket[name] ?? 0), 0);
}

async function insert(table: (typeof SEEDED_TABLES)[number], values: readonly object[]) {
  await client.insert({
    table,
    values: [...values],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

beforeAll(async () => {
  client = (await startMigratedClickHouse()).client;
  repository = ClickHouseAnalyticsRepository.create({
    clickhouse: clickHouseQueryClientOver(client),
  });
  await insert("trace_summaries", TRACES.map(traceSummaryRow));
  await insert("evaluation_runs", TRACES.map(evaluationRunRow));
  await insert("evaluation_analytics", TRACES.map(evaluationAnalyticsRow));
  await insert("evaluation_analytics_rollup", TRACES.map(evaluationRollupRow));
});

afterAll(async () => {
  for (const tenantId of [AGGREGATE, MEMBER]) {
    await deleteMigratedTenantRows({ client, tenantId, tables: [...SEEDED_TABLES] });
  }
});

describe("evaluation runs read under an aggregate's proof", () => {
  describe("given a member shared from a date, with a trace from before it evaluated after it", () => {
    /** @scenario "The aggregate counts a member's evaluations by when their trace occurred" */
    it("counts only the evaluation whose trace is inside the window", async () => {
      const proof = analyticsProof({
        projectId: AGGREGATE,
        shared: [{ projectId: MEMBER, from: GRANT_FROM.epochMilliseconds }],
      });

      expect(
        await countRuns({ authorization: proof, projectId: AGGREGATE, readsMembers: true }),
      ).toBe(1);
    });
  });

  describe("given the member's own proof", () => {
    it("counts both of its evaluations, as before", async () => {
      const proof = analyticsProof({ projectId: MEMBER });

      expect(
        await countRuns({ authorization: proof, projectId: MEMBER, readsMembers: false }),
      ).toBe(2);
    });
  });
});
