/** @vitest-environment node */
/**
 * The by-trace read a dispatch-time re-check confirms an evaluation verdict against,
 * written and read back over real ClickHouse.
 * @see specs/automations/process-manager-dispatch.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EvaluationRunClickHouseReadRepository } from "../evaluation-run-read.repository.ts";
import { EvaluationRunClickHouseWriteRepository } from "../evaluation-run-write.repository.ts";

const TENANT = "tenant_by_trace";
const TRACE_ID = "trace_by_trace_1";
const OTHER_TRACE_ID = "trace_by_trace_2";

/** The shipped evaluation_runs columns the write and the by-trace read touch. */
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

/** A minute ago: the by-trace read only looks back seven days. */
const NOW = Date.now() - 60 * 1000;

function evaluationRun(overrides: Partial<EvaluationRunData>): EvaluationRunData {
  return {
    evaluationId: "eval_failing",
    evaluatorId: "monitor-failing",
    evaluatorType: "test/evaluator",
    evaluatorName: "Test Evaluator",
    traceId: TRACE_ID,
    isGuardrail: false,
    status: "processed",
    score: 0,
    passed: false,
    label: null,
    details: "",
    inputs: null,
    error: null,
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

describe("given a trace whose evaluation runs are stored", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "evaluation-run-read-by-trace",
      names: ["shared"],
      environment: process.env,
    });
    // The production member parses the write's ISO moments the same way.
    client = createClient({
      url: endpoint!.url,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
    // The endpoint is reused across runs, so start from an empty table.
    await client.command({ query: "DROP TABLE IF EXISTS evaluation_runs SYNC" });
    await client.command({ query: CREATE_TABLE });

    const resolveClient = async () => client as never;
    const writes = EvaluationRunClickHouseWriteRepository.create({ resolveClient });
    reads = EvaluationRunClickHouseReadRepository.create({ resolveClient });
    const runs = [
      evaluationRun({}),
      evaluationRun({
        evaluationId: "eval_passing",
        evaluatorId: "monitor-passing",
        passed: true,
        score: 1,
      }),
      evaluationRun({ evaluationId: "eval_rewritten", evaluatorId: "monitor-rewritten" }),
      evaluationRun({
        evaluationId: "eval_rewritten",
        evaluatorId: "monitor-rewritten",
        passed: true,
        score: 1,
        updatedAt: NOW + 1000,
      }),
      evaluationRun({ evaluationId: "eval_other_trace", traceId: OTHER_TRACE_ID }),
    ];
    for (const data of runs) await writes.upsert({ data, tenantId: TENANT });
  }, 120_000);

  afterAll(async () => {
    await client?.close();
  });

  describe("when the trace's runs are read by trace", () => {
    it("returns the latest version of each run on the trace and no other trace's run", async () => {
      const result = await reads.findByTraceId({ tenantId: TENANT, traceId: TRACE_ID });

      const verdicts = Object.fromEntries(result.map((run) => [run.evaluationId, run.passed]));
      expect(verdicts).toEqual({
        eval_failing: false,
        eval_passing: true,
        eval_rewritten: true,
      });
      expect(result).toHaveLength(3);
      expect(result.every((run) => run.traceId === TRACE_ID)).toBe(true);
    });
  });

  describe("when a trace with no runs is read", () => {
    it("returns no runs", async () => {
      const result = await reads.findByTraceId({ tenantId: TENANT, traceId: "trace_without_runs" });

      expect(result).toEqual([]);
    });
  });
});
