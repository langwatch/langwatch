/**
 * Trace's read of evaluation's shared `evaluation_runs`.
 * @see modules/trace/specs/trace-evaluation-runs-read.feature
 */
import { AuthorizedClickHouse, type QueryRequest } from "@langwatch/clickhouse-client";
import { clickHouseQueryClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it, vi } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { ClickHouseTraceEvaluationRunsRepository } from "../trace-evaluation-runs.repository.ts";

type ChQuery = { query: string; query_params?: Record<string, unknown> };

const TENANT = "project-1";
const authorization = ownProof({ projectId: TENANT });
const SUMMARY_ROW = {
  EvaluationId: "eval-1",
  EvaluatorId: "customeval_tone",
  EvaluatorType: "custom",
  EvaluatorName: "Tone",
  TraceId: "trace-1",
  IsGuardrail: 0,
  Status: "processed",
  Score: 0.9,
  Passed: 1,
  Label: null,
};

function client(answer: (request: ChQuery) => unknown[] | Error) {
  const query = vi.fn(async (request: ChQuery) => {
    const rows = answer(request);
    if (rows instanceof Error) throw rows;
    return { json: async () => rows };
  });
  return { query };
}

function repositoryOver(ch: ReturnType<typeof client>) {
  // The proof-checked reader hands its expanded statement to the same recording client.
  const authorized = clickHouseQueryClientDouble({
    query: async (request: QueryRequest) => {
      const result = await ch.query({ query: request.sql, query_params: request.params });
      return { rows: await result.json() };
    },
  });
  return ClickHouseTraceEvaluationRunsRepository.create({
    resolveClient: async () => ch,
    clickhouse: new AuthorizedClickHouse({ resolveClient: async () => authorized }),
  });
}

describe("given evaluation has recorded runs against a trace", () => {
  describe("when trace reads the runs recorded against that trace", () => {
    /**
     * @scenario "A trace's evaluation runs are the latest version of each run from the last seven days"
     * @scenario "A trace whose evaluation has landed still reads"
     */
    it("reads the tenant's latest version of each run over seven days and maps each row", async () => {
      const ch = client(() => [
        {
          ...SUMMARY_ROW,
          Details: "calm",
          Inputs: '{"input":"hi"}',
          Error: null,
          ErrorDetails: null,
          CreatedAt: "1758189600000",
          UpdatedAt: "1758189660000",
          ArchivedAt: null,
          ScheduledAt: "1758189600000",
          StartedAt: null,
          CompletedAt: "1758189660000",
          CostId: null,
          LastEventOccurredAt: "1758189660000",
        },
      ]);

      const runs = await repositoryOver(ch).findRunsByTraceId({
        tenantId: TENANT,
        traceId: "trace-1",
      });

      const request = ch.query.mock.calls[0]?.[0];
      expect(request?.query).toContain("FROM evaluation_runs AS runs");
      expect(request?.query).toContain("ScheduledAt >= now() - INTERVAL 7 DAY");
      expect(request?.query).toContain("SELECT TenantId, EvaluationId, max(UpdatedAt)");
      expect(request?.query_params).toEqual({ tenantId: TENANT, traceId: "trace-1" });
      expect(runs).toEqual([
        expect.objectContaining({
          evaluationId: "eval-1",
          isGuardrail: false,
          passed: true,
          inputs: { input: "hi" },
          createdAt: 1758189600000,
          completedAt: 1758189660000,
          startedAt: null,
        }),
      ]);
    });
  });
});

describe("given evaluation has recorded runs against the traces on one list page", () => {
  describe("when trace reads the page's evaluation summaries", () => {
    /** @scenario "The trace list's evaluation summaries are read per trace since the window opened" */
    it("reads the tenant's latest runs scheduled since the window opened, grouped by trace", async () => {
      const ch = client(() => [
        { ...SUMMARY_ROW, TenantId: TENANT },
        {
          ...SUMMARY_ROW,
          TenantId: TENANT,
          EvaluationId: "eval-2",
          TraceId: "trace-2",
          Passed: null,
        },
      ]);

      const summaries = await repositoryOver(ch).findSummariesByTraceIds({
        authorization,
        traceIds: ["trace-1", "trace-2"],
        since: 1_000,
      });

      const request = ch.query.mock.calls[0]?.[0];
      expect(request?.query).toContain("ScheduledAt >= fromUnixTimestamp64Milli({since:Int64})");
      expect(request?.query).toContain("TenantId IN ({tenantScope");
      expect(request?.query_params).toMatchObject({
        traceIds: ["trace-1", "trace-2"],
        since: 1_000,
      });
      expect(Object.values(request?.query_params ?? {})).toContainEqual([TENANT]);
      expect(summaries.map((summary) => summary.traceId)).toEqual(["trace-1", "trace-2"]);
      expect(summaries[1]).toMatchObject({
        tenantId: TENANT,
        evaluationId: "eval-2",
        passed: null,
      });
    });
  });
});

describe("given reading a trace's evaluations with their inputs exceeds ClickHouse's memory limit", () => {
  describe("when trace reads the evaluations of that trace", () => {
    /** @scenario "A trace's evaluations retry without their inputs when ClickHouse runs out of memory" */
    it("reads them again without inputs and answers every asked trace", async () => {
      const ch = client((request) =>
        request.query.includes("Inputs")
          ? new Error("Code: 241. DB::Exception: Memory limit (total) exceeded")
          : [
              {
                ...SUMMARY_ROW,
                Details: null,
                Error: null,
                ScheduledAt: "1758189600000",
                StartedAt: null,
                CompletedAt: null,
              },
            ],
      );

      const evaluations = await repositoryOver(ch).findTraceEvaluations({
        tenantId: TENANT,
        traceIds: ["trace-1", "trace-quiet"],
      });

      expect(ch.query).toHaveBeenCalledTimes(2);
      expect(evaluations["trace-quiet"]).toEqual([]);
      expect(evaluations["trace-1"]?.[0]).toMatchObject({
        evaluationId: "eval-1",
        timestamps: { scheduledAt: 1758189600000, startedAt: null, completedAt: null },
      });
      expect(evaluations["trace-1"]?.[0]).not.toHaveProperty("inputs");
    });
  });
});

describe("given no traces", () => {
  describe("when trace reads evaluation summaries or evaluations for them", () => {
    /** @scenario "Trace asks nothing of evaluation_runs for an empty list of traces" */
    it("answers empty without querying ClickHouse", async () => {
      const ch = client(() => []);
      const repository = repositoryOver(ch);

      expect(
        await repository.findSummariesByTraceIds({ authorization, traceIds: [], since: 0 }),
      ).toEqual([]);
      expect(await repository.findTraceEvaluations({ tenantId: TENANT, traceIds: [] })).toEqual({});
      expect(ch.query).not.toHaveBeenCalled();
    });
  });
});
