import { randomUUID } from "node:crypto";

/**
 * An aggregate's legacy `trace_summaries` series and the evaluation chart beside it read each
 * member inside its grant's window, and never a project outside the proof (ADR-177).
 * @see specs/governance/aggregate-project.feature
 * @integration
 * @vitest-environment node
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  buildSeriesName,
  type AnalyticsSeries,
  type AnalyticsTable,
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
const AGGREGATE = `test-agg-summaries-${RUN}`;
const WHOLE_HISTORY_MEMBER = `test-agg-summaries-a-${RUN}`;
const LATE_MEMBER = `test-agg-summaries-b-${RUN}`;
const FOREIGN = `test-agg-summaries-foreign-${RUN}`;
const SEEDED_TABLES = ["trace_summaries", "evaluation_runs"] as const;
const EVALUATOR = `${RUN}-check`;
const OTHER_EVALUATOR = `${RUN}-other-check`;

const DAY = "2026-06-15";
const at = (time: string) => Temporal.Instant.from(`${DAY}T${time}Z`);
const LATE_MEMBER_FROM = at("10:00:00");

/** One trace per row, each a distinct power of two so a sum names its traces. */
const TRACES: { tenantId: string; time: string; value: number }[] = [
  { tenantId: WHOLE_HISTORY_MEMBER, time: "08:00:00", value: 1 },
  { tenantId: WHOLE_HISTORY_MEMBER, time: "11:00:00", value: 2 },
  { tenantId: LATE_MEMBER, time: "09:30:00", value: 4 }, // before its grant starts
  { tenantId: LATE_MEMBER, time: "10:30:00", value: 8 },
  { tenantId: FOREIGN, time: "10:30:00", value: 16 }, // outside the proof
  { tenantId: AGGREGATE, time: "10:30:00", value: 32 }, // the aggregate's own
];

let client: ClickHouseClient;
let repository: ClickHouseAnalyticsRepository;

const traceIdOf = (index: number) => `trace-${RUN}-${index}`;

function traceSummaryRow({ tenantId, time, value }: (typeof TRACES)[number], index: number) {
  const occurredAt = new Date(at(time).epochMilliseconds);
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: tenantId,
    TraceId: traceIdOf(index),
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
    TotalCost: value,
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

function evaluationRunRow({
  trace,
  index,
  evaluatorId,
}: {
  trace: (typeof TRACES)[number];
  index: number;
  evaluatorId: string;
}) {
  const scheduledAt = new Date(at(trace.time).epochMilliseconds).toISOString();
  return {
    ProjectionId: `proj-${randomUUID()}`,
    TenantId: trace.tenantId,
    EvaluationId: `eval-${randomUUID()}`,
    Version: "1",
    EvaluatorId: evaluatorId,
    EvaluatorType: "langevals/exact_match",
    TraceId: traceIdOf(index),
    Status: "processed",
    Score: evaluatorId === EVALUATOR ? trace.value : 1000,
    Passed: 1,
    Label: null,
    LastProcessedEventId: `evt-${randomUUID()}`,
    ScheduledAt: scheduledAt,
    UpdatedAt: scheduledAt,
  };
}

const COST_SERIES: AnalyticsSeries = { metric: "performance.total_cost", aggregation: "sum" };
const SCORE_SERIES: AnalyticsSeries = {
  metric: "evaluations.evaluation_score",
  aggregation: "sum",
  key: EVALUATOR,
};

function seriesTotal(result: AnalyticsTimeseriesResult, series: AnalyticsSeries): number {
  const name = buildSeriesName(series, 0);
  return result.currentPeriod.reduce((sum, bucket) => sum + Number(bucket[name] ?? 0), 0);
}

function read({
  authorization,
  table,
  series,
  filters = {},
}: {
  authorization: Authorization;
  table: AnalyticsTable;
  series: AnalyticsSeries;
  filters?: AnalyticsTimeseriesInput["filters"];
}): Promise<AnalyticsTimeseriesResult> {
  const startDate = at("06:00:00");
  const endDate = at("14:00:00");
  return repository.runTimeseries({
    table,
    authorization,
    input: {
      projectId: AGGREGATE,
      startDate: startDate.epochMilliseconds,
      endDate: endDate.epochMilliseconds,
      filters,
      series: [series],
      timeScale: "full",
      timeZone: "UTC",
    },
    startDate,
    endDate,
    previousPeriodStartDate: startDate.subtract({ hours: 8 }),
    adjustedTimeScale: "full",
    maxResultRows: undefined,
  });
}

/** Member A shared for its whole history, member B only from its grant's start. */
const aggregateProof = () =>
  analyticsProof({
    projectId: AGGREGATE,
    shared: [
      { projectId: WHOLE_HISTORY_MEMBER, from: 0 },
      { projectId: LATE_MEMBER, from: LATE_MEMBER_FROM.epochMilliseconds },
    ],
  });

const IN_WINDOWS = 1 + 2 + 8 + 32;

beforeAll(async () => {
  client = (await startMigratedClickHouse()).client;
  repository = ClickHouseAnalyticsRepository.create({
    clickhouse: clickHouseQueryClientOver(client),
  });
  const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;
  await client.insert({
    table: "trace_summaries",
    values: TRACES.map(traceSummaryRow),
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  await client.insert({
    table: "evaluation_runs",
    values: TRACES.flatMap((trace, index) =>
      [EVALUATOR, OTHER_EVALUATOR].map((evaluatorId) =>
        evaluationRunRow({ trace, index, evaluatorId }),
      ),
    ),
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
}, 300_000);

afterAll(async () => {
  for (const tenantId of [AGGREGATE, WHOLE_HISTORY_MEMBER, LATE_MEMBER, FOREIGN]) {
    await deleteMigratedTenantRows({ client, tenantId, tables: SEEDED_TABLES });
  }
});

describe("legacy trace summaries read under an aggregate's proof", () => {
  describe("given two members each shared for their whole history", () => {
    /** @scenario "Analytics aggregate across members" */
    it("counts both members' traces and the aggregate's own, never a foreign one", async () => {
      const result = await read({
        authorization: analyticsProof({
          projectId: AGGREGATE,
          shared: [
            { projectId: WHOLE_HISTORY_MEMBER, from: 0 },
            { projectId: LATE_MEMBER, from: 0 },
          ],
        }),
        table: "trace_summaries",
        series: COST_SERIES,
      });

      expect(seriesTotal(result, COST_SERIES)).toBe(1 + 2 + 4 + 8 + 32);
    });
  });

  describe("given one member shared for its whole history and one from a later start", () => {
    /** @scenario "The aggregate's trace summaries count members inside their windows" */
    it("counts the first member's every trace, the second's from its start, never a foreign one", async () => {
      const result = await read({
        authorization: aggregateProof(),
        table: "trace_summaries",
        series: COST_SERIES,
      });

      expect(seriesTotal(result, COST_SERIES)).toBe(IN_WINDOWS);
    });

    it("keeps the windows when a filter reads the evaluation side table", async () => {
      const result = await read({
        authorization: aggregateProof(),
        table: "trace_summaries",
        series: COST_SERIES,
        filters: { "evaluations.evaluator_id": [EVALUATOR] },
      });

      expect(seriesTotal(result, COST_SERIES)).toBe(IN_WINDOWS);
    });

    /** @scenario "The aggregate's evaluation chart counts members inside their windows" */
    it("scores one check across the members inside their windows, never a foreign run", async () => {
      const result = await read({
        authorization: aggregateProof(),
        table: "evaluation_runs",
        series: SCORE_SERIES,
      });

      expect(seriesTotal(result, SCORE_SERIES)).toBe(IN_WINDOWS);
    });
  });

  describe("given a plain project's proof", () => {
    it("counts its own traces alone, as before", async () => {
      const result = await read({
        authorization: analyticsProof({ projectId: AGGREGATE }),
        table: "trace_summaries",
        series: COST_SERIES,
      });

      expect(seriesTotal(result, COST_SERIES)).toBe(32);
    });

    it("scores its own check alone, as before", async () => {
      const result = await read({
        authorization: analyticsProof({ projectId: AGGREGATE }),
        table: "evaluation_runs",
        series: SCORE_SERIES,
      });

      expect(seriesTotal(result, SCORE_SERIES)).toBe(32);
    });
  });
});
