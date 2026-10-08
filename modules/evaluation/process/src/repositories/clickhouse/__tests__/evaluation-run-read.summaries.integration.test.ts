/** @vitest-environment node */
/**
 * The trace list's evaluation summaries, written and read back over real ClickHouse.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SUMMARY_ERROR_TEXT_MAX_CHARS } from "../../../rules/evaluation-summary-error.rules.ts";
import { EvaluationRunClickHouseReadRepository } from "../evaluation-run-read.repository.ts";
import { EvaluationRunClickHouseWriteRepository } from "../evaluation-run-write.repository.ts";

const TENANT = "tenant_summaries";
const TRACE_ID = "trace_summaries_1";

/** The shipped evaluation_runs columns the write and the summary read touch. */
const CREATE_TABLE = `
  CREATE TABLE evaluation_runs (
    ProjectionId String, TenantId String, EvaluationId String, Version String,
    EvaluatorId String, EvaluatorType LowCardinality(String),
    EvaluatorName Nullable(String), TraceId Nullable(String),
    IsGuardrail UInt8 DEFAULT 0, Status LowCardinality(String),
    Score Nullable(Float64), Passed Nullable(UInt8), Label Nullable(String),
    Details Nullable(String), Inputs Nullable(String), Error Nullable(String),
    ErrorDetails Nullable(String),
    CreatedAt DateTime64(3) DEFAULT now64(3), UpdatedAt DateTime64(3) DEFAULT now64(3),
    ArchivedAt Nullable(DateTime64(3)),
    ScheduledAt DateTime64(3) DEFAULT now64(3), StartedAt Nullable(DateTime64(3)),
    CompletedAt Nullable(DateTime64(3)), CostId Nullable(String),
    LastProcessedEventId String, LastEventOccurredAt Nullable(DateTime64(3)),
    _retention_days UInt16 DEFAULT 49
  ) ENGINE = ReplacingMergeTree(UpdatedAt)
  PARTITION BY toYearWeek(ScheduledAt)
  ORDER BY (TenantId, EvaluationId)
`;

const NOW = Date.now() - 60 * 1000;
const PADDED_ERROR = "  \n free_budget_exhausted: spent \t ";
const LONG_ERROR = "y".repeat(5_000);

function evaluationRun(overrides: Partial<EvaluationRunData>): EvaluationRunData {
  return {
    evaluationId: "eval_errored",
    evaluatorId: "monitor-errored",
    evaluatorType: "test/evaluator",
    evaluatorName: "Test Evaluator",
    traceId: TRACE_ID,
    isGuardrail: false,
    status: "error",
    score: null,
    passed: null,
    label: null,
    details: null,
    inputs: null,
    error: PADDED_ERROR,
    errorDetails: null,
    createdAt: NOW,
    updatedAt: NOW,
    LastEventOccurredAt: NOW,
    archivedAt: null,
    scheduledAt: NOW,
    startedAt: NOW,
    completedAt: NOW,
    costId: null,
    ...overrides,
  };
}

let client: ClickHouseClient;
let reads: EvaluationRunClickHouseReadRepository;

async function summaryErrorOf(evaluationId: string) {
  const summaries = await reads.findSummariesByTraceIds({
    tenantId: TENANT,
    traceIds: [TRACE_ID],
    since: NOW - 60 * 60 * 1000,
  });
  return summaries[TRACE_ID]?.find((summary) => summary.evaluationId === evaluationId)?.error;
}

describe("given a trace whose evaluation runs stored an error text", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "evaluation-run-read-summaries",
      names: ["shared"],
      environment: process.env,
    });
    client = createClient({
      url: endpoint!.url,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
    await client.command({ query: "DROP TABLE IF EXISTS evaluation_runs SYNC" });
    await client.command({ query: CREATE_TABLE });

    const resolveClient = async () => client as never;
    const writes = EvaluationRunClickHouseWriteRepository.create({ resolveClient });
    reads = EvaluationRunClickHouseReadRepository.create({ resolveClient });
    const runs = [
      evaluationRun({}),
      evaluationRun({ evaluationId: "eval_processed", status: "processed", score: 1 }),
      evaluationRun({ evaluationId: "eval_skipped", status: "skipped" }),
      evaluationRun({ evaluationId: "eval_long", error: LONG_ERROR }),
    ];
    for (const data of runs) await writes.upsert({ data, tenantId: TENANT });
  }, 120_000);

  afterAll(async () => {
    await client?.close();
  });

  describe("when the trace list reads the trace's evaluation summaries", () => {
    /** @scenario "The trace list's evaluation summary carries the error text of an errored run only" */
    it("carries an errored run's error text without the surrounding whitespace", async () => {
      expect(await summaryErrorOf("eval_errored")).toBe("free_budget_exhausted: spent");
    });

    /** @scenario "The trace list's evaluation summary carries the error text of an errored run only" */
    it("carries no error text for a processed or skipped run", async () => {
      expect(await summaryErrorOf("eval_processed")).toBeNull();
      expect(await summaryErrorOf("eval_skipped")).toBeNull();
    });

    it("cuts a long error text short", async () => {
      expect(await summaryErrorOf("eval_long")).toBe(
        `${"y".repeat(SUMMARY_ERROR_TEXT_MAX_CHARS)}…`,
      );
    });
  });
});
