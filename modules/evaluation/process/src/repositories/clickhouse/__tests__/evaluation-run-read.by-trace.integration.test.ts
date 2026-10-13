/** @vitest-environment node */
/**
 * The by-trace read a dispatch-time re-check confirms an evaluation verdict against,
 * written and read back over real ClickHouse.
 * @see specs/automations/process-manager-dispatch.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { narrowAuthorization } from "@langwatch/authorization";
import { AuthorizedClickHouse } from "@langwatch/clickhouse-client";
import { startTestClickHouseEndpoints } from "@langwatch/clickhouse-client/testing";
import type { EvaluationRunData } from "@langwatch/evaluation-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  aggregateProof,
  ownProof,
} from "../../../__tests__/support/authorization-proofs.fixture.ts";
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
    reads = EvaluationRunClickHouseReadRepository.create({
      clickhouse: new AuthorizedClickHouse({ resolveClient }),
    });
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
      const result = await reads.findByTraceId({
        authorization: ownProof({ projectId: TENANT }),
        traceId: TRACE_ID,
      });

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
      const result = await reads.findByTraceId({
        authorization: ownProof({ projectId: TENANT }),
        traceId: "trace_without_runs",
      });

      expect(result).toEqual([]);
    });
  });

  describe("when the read is fenced by an aggregate's proof", () => {
    const SHARED_TRACE_ID = "trace_by_trace_shared";
    const proof = () =>
      aggregateProof({
        projectId: "tenant_aggregate",
        members: [
          { projectId: "tenant_member_a", from: 0 },
          { projectId: "tenant_member_b", from: 0 },
        ],
      });

    beforeAll(async () => {
      const writes = EvaluationRunClickHouseWriteRepository.create({
        resolveClient: async () => client as never,
      });
      for (const [tenantId, evaluatorId] of [
        ["tenant_member_a", "monitor-a"],
        ["tenant_member_b", "monitor-b"],
        ["tenant_outsider", "monitor-out"],
      ] as const) {
        await writes.upsert({
          data: evaluationRun({
            evaluationId: `eval_${evaluatorId}`,
            evaluatorId,
            traceId: SHARED_TRACE_ID,
          }),
          tenantId,
        });
      }
    });

    it("narrowed to one member, returns that member's run and not the other's of the same trace", async () => {
      const narrowed = narrowAuthorization({
        authorization: proof(),
        projectId: "tenant_member_a",
      });
      expect(narrowed).not.toBeNull();
      const result = narrowed
        ? await reads.findByTraceId({ authorization: narrowed, traceId: SHARED_TRACE_ID })
        : [];

      expect(result.map((run) => run.evaluatorId)).toEqual(["monitor-a"]);
    });

    it("spanning every member, reads each member's run and nothing outside the proof", async () => {
      const result = await reads.findByTraceId({
        authorization: proof(),
        traceId: SHARED_TRACE_ID,
      });

      expect(result.map((run) => run.evaluatorId).toSorted()).toEqual(["monitor-a", "monitor-b"]);
    });
  });
});
