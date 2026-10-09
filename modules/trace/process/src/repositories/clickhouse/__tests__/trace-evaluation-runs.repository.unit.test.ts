/**
 * Trace's read of evaluation's shared `evaluation_runs`.
 * @see modules/trace/specs/trace-evaluation-runs-read.feature
 */
import { aggregateProof, ownProof } from "@langwatch/authorization/testing";
import type { QueryRequest } from "@langwatch/clickhouse-client";
import { describe, expect, it, vi } from "vitest";

import { AuthorizedTraceReadsRepository } from "../clickhouse.trace-member-client.repository.ts";
import { ClickHouseTraceEvaluationRunsRepository } from "../trace-evaluation-runs.repository.ts";

const TENANT = "project-1";
const authorization = ownProof({ projectId: TENANT, now: Date.now() });
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

/** A recording reader: each request is the statement as the proof's fence expanded it. */
function client(answer: (request: QueryRequest) => unknown[] | Error) {
  const query = vi.fn(async (request: QueryRequest): Promise<{ rows: unknown[] }> => {
    const rows = answer(request);
    if (rows instanceof Error) throw rows;
    return { rows };
  });
  return { query };
}

function repositoryOver(ch: ReturnType<typeof client>) {
  return ClickHouseTraceEvaluationRunsRepository.create({
    reads: AuthorizedTraceReadsRepository.create({
      clickhouse: {
        query: async <Row>(request: QueryRequest) => {
          const { rows } = await ch.query(request);
          return { rows: rows as Row[] };
        },
      },
    }),
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
        authorization,
        traceId: "trace-1",
      });

      const request = ch.query.mock.calls[0]?.[0];
      expect(request?.sql).toContain("FROM evaluation_runs AS runs");
      expect(request?.sql).toContain("ScheduledAt >= now() - INTERVAL 7 DAY");
      expect(request?.sql).toContain("SELECT TenantId, EvaluationId, max(UpdatedAt)");
      expect(request?.tenantId).toBe(TENANT);
      expect(request?.params).toEqual({ traceId: "trace-1", tenantScope_all: [TENANT] });
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

  describe("when an aggregate reads them through a member's windowed grant", () => {
    it("windows the dedup subquery, never the outer scope that projects ScheduledAt", async () => {
      const ch = client(() => []);
      const aggregate = aggregateProof({
        projectId: "aggregate",
        members: [{ projectId: "member-a", from: 1_000, until: 2_000 }],
        now: Date.now(),
      });

      await repositoryOver(ch).findRunsByTraceId({ authorization: aggregate, traceId: "trace-1" });
      await repositoryOver(ch).findTraceEvaluations({
        authorization: aggregate,
        traceIds: ["trace-1"],
      });

      for (const [request] of ch.query.mock.calls) {
        const [outer, subquery] = request.sql.split(
          "SELECT TenantId, EvaluationId, max(UpdatedAt)",
        );
        expect(outer).toContain("TenantId IN ({tenantScope_all:Array(String)})");
        expect(outer).not.toContain("has({tenantScope_ids");
        expect(subquery).toContain("has({tenantScope_ids");
        expect(request.tenantIds).toEqual(["aggregate", "member-a"]);
      }
    });
  });
});

describe("given evaluation has recorded runs against the traces on one list page", () => {
  describe("when trace reads the page's evaluation summaries", () => {
    /** @scenario "The trace list's evaluation summaries are read per trace since the window opened" */
    it("reads the tenant's latest runs scheduled since the window opened, grouped by trace", async () => {
      const ch = client(() => [
        SUMMARY_ROW,
        { ...SUMMARY_ROW, EvaluationId: "eval-2", TraceId: "trace-2", Passed: null },
      ]);

      const summaries = await repositoryOver(ch).findSummariesByTraceIds({
        authorization,
        traceIds: ["trace-1", "trace-2"],
        since: 1_000,
      });

      const request = ch.query.mock.calls[0]?.[0];
      expect(request?.sql).toContain("ScheduledAt >= fromUnixTimestamp64Milli({since:Int64})");
      expect(request?.params).toEqual({
        traceIds: ["trace-1", "trace-2"],
        since: 1_000,
        tenantScope_all: [TENANT],
      });
      expect(Object.keys(summaries)).toEqual(["trace-1", "trace-2"]);
      expect(summaries["trace-2"]?.[0]).toMatchObject({ evaluationId: "eval-2", passed: null });
    });
  });
});

describe("given reading a trace's evaluations with their inputs exceeds ClickHouse's memory limit", () => {
  describe("when trace reads the evaluations of that trace", () => {
    /** @scenario "A trace's evaluations retry without their inputs when ClickHouse runs out of memory" */
    it("reads them again without inputs and answers every asked trace", async () => {
      const ch = client((request) =>
        request.sql.includes("Inputs")
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
        authorization,
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
      ).toEqual({});
      expect(await repository.findTraceEvaluations({ authorization, traceIds: [] })).toEqual({});
      expect(ch.query).not.toHaveBeenCalled();
    });
  });
});
