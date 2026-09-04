/** @vitest-environment node */
/** Spec: specs/evaluations/trace-evaluations-read.feature */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { startTestClickHouseEndpoints } from "@langwatch/test-harness";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EvaluationRunClickHouseReadRepository } from "../evaluation-run-read.repository";

const TENANT = "tenant_dedup";
const TRACE_ID = "trace_dedup_1";

/**
 * The columns the trace-evaluation reads touch, with the shipped types. The
 * engine and sort key matter: the dedup predicate exists because a run is
 * rewritten in place as it progresses.
 */
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
    LastProcessedEventId String, LastEventOccurredAt Nullable(DateTime64(3))
  ) ENGINE = ReplacingMergeTree(UpdatedAt)
  PARTITION BY toYearWeek(ScheduledAt)
  ORDER BY (TenantId, EvaluationId)
`;

function row(overrides: Record<string, unknown>): Record<string, unknown> {
  return {
    ProjectionId: "projection_1",
    TenantId: TENANT,
    EvaluationId: "eval_dedup_1",
    Version: "1",
    EvaluatorId: "evaluator_1",
    EvaluatorType: "custom",
    EvaluatorName: "span evaluation",
    TraceId: TRACE_ID,
    IsGuardrail: 0,
    Status: "scheduled",
    LastProcessedEventId: "event_1",
    ScheduledAt: "2026-09-04 20:00:00.000",
    CreatedAt: "2026-09-04 20:00:00.000",
    UpdatedAt: "2026-09-04 20:00:00.000",
    ...overrides,
  };
}

let client: ClickHouseClient;

describe("given an evaluation whose row was rewritten as it progressed", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "evaluation-run-read-dedup",
      names: ["shared"],
    });
    client = createClient({ url: endpoint!.url });
    // The endpoint is reused across runs, so start from an empty table.
    await client.command({ query: "DROP TABLE IF EXISTS evaluation_runs SYNC" });
    await client.command({ query: CREATE_TABLE });
    await client.insert({
      table: "evaluation_runs",
      format: "JSONEachRow",
      values: [
        row({}),
        row({
          Status: "processed",
          Score: 1,
          Passed: 1,
          StartedAt: "2026-09-04 20:00:01.000",
          CompletedAt: "2026-09-04 20:00:02.000",
          UpdatedAt: "2026-09-04 20:00:02.500",
        }),
      ],
    });
  }, 120_000);

  afterAll(async () => {
    await client?.close();
  });

  describe("when the trace behind it is read", () => {
    /** @scenario "A rewritten evaluation is not hidden by the read's own column aliases" */
    it("returns the latest version of the evaluation", async () => {
      const repository = EvaluationRunClickHouseReadRepository.create({
        resolveClient: async () => client as never,
        retentionFloor: { getFloorMs: async () => 0 },
      });

      const result = await repository.findTraceEvaluations({
        tenantId: TENANT,
        traceIds: [TRACE_ID],
      });

      expect(result[TRACE_ID]).toHaveLength(1);
      expect(result[TRACE_ID]?.[0]).toMatchObject({
        evaluationId: "eval_dedup_1",
        status: "processed",
        passed: true,
      });
      expect(result[TRACE_ID]?.[0]?.timestamps.completedAt).toBeTypeOf("number");
    });

    /** @scenario "A rewritten evaluation is not hidden by the read's own column aliases" */
    it("returns it through the by-trace read as well", async () => {
      const repository = EvaluationRunClickHouseReadRepository.create({
        resolveClient: async () => client as never,
        retentionFloor: { getFloorMs: async () => 0 },
      });

      const result = await repository.findByTraceId({ tenantId: TENANT, traceId: TRACE_ID });

      expect(result.map((run) => run.status)).toEqual(["processed"]);
    });
  });
});
