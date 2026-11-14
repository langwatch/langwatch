/**
 * Trace's read of evaluation's shared `evaluation_runs`.
 * @see modules/trace/specs/trace-evaluation-runs-read.feature
 */
import { ClickHouseColumns, type ClickHouseQueryClient } from "@langwatch/clickhouse-client";
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

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

const ATTEMPT_COLUMNS = ["Attempts", "LastAttemptAt", "LastAttemptError", "NextAttemptAt"];

/** A target's column list for evaluation_runs: the attempt columns only when `held`. */
function targetColumns(held: boolean) {
  const names = ["EvaluationId", "TraceId", ...(held ? ATTEMPT_COLUMNS : [])];
  return ClickHouseColumns.over({
    read: async () => names.map((name) => ({ table: "evaluation_runs", name })),
  });
}

function repositoryOver(
  ch: ReturnType<typeof client>,
  reads: ReadRequest[] = [],
  { held = true }: { held?: boolean } = {},
) {
  return ClickHouseTraceEvaluationRunsRepository.create({
    // A built read is recorded, then answered by the same recording client.
    reader: clickHouseQueryClientDouble({
      columns: () => targetColumns(held),
      read: async (request: ReadRequest) => {
        reads.push(request);
        const result = await ch.query({
          query: request.statement.sql,
          query_params: request.statement.params,
        });
        return { rows: await result.json() };
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
          CreatedAtMs: "1758189600000",
          UpdatedAtMs: "1758189660000",
          ArchivedAtMs: null,
          ScheduledAtMs: "1758189600000",
          StartedAtMs: null,
          CompletedAtMs: "1758189660000",
          CostId: null,
          AttemptCount: 1,
          LastAttemptAtMs: "1758189650000",
          LastAttemptErrorText: "timeout",
          NextAttemptAtMs: null,
          LastEventOccurredAtMs: "1758189660000",
        },
      ]);
      const reads: ReadRequest[] = [];

      const runs = await repositoryOver(ch, reads).findRunsByTraceId({
        tenantId: TENANT,
        traceId: "trace-1",
      });

      const request = reads[0];
      expect(request?.table).toBe("evaluation_runs");
      expect(request?.statement).toMatchObject({
        kind: "tenant",
        identity: "reader",
        settings: { SQL_langwatch_tenant_ids: TENANT },
      });
      const sql = request?.statement.sql ?? "";
      expect(sql).toContain("TenantId = {tenantId:String}");
      expect(sql).toContain("ScheduledAt >= subtractDays(now(), ");
      expect(sql).toContain("max(UpdatedAt)");
      expect(sql).toMatch(/GROUP BY\s+TenantId,\s*EvaluationId/);
      // The window and the trace repeat inside the election, as main's dedup repeats them.
      const [, election = ""] = sql.split("max(UpdatedAt)");
      expect(election).toContain("ScheduledAt >= subtractDays(now(), ");
      expect(election).toContain("TraceId = {");
      expect(sql).not.toContain("toUInt16(");
      expect(Object.values(request?.statement.params ?? {})).toEqual(
        expect.arrayContaining(["trace-1", 7]),
      );
      expect(runs).toEqual([
        expect.objectContaining({
          evaluationId: "eval-1",
          isGuardrail: false,
          passed: true,
          inputs: { input: "hi" },
          createdAt: 1758189600000,
          completedAt: 1758189660000,
          startedAt: null,
          attempts: 1,
          lastAttemptAt: 1758189650000,
          lastAttemptError: "timeout",
          nextAttemptAt: null,
        }),
      ]);
    });

    /** @scenario "Attempt columns a target has not added yet read as no attempts" */
    it("selects each attempt column the target lacks as its default", async () => {
      const ch = client(() => []);
      const reads: ReadRequest[] = [];

      await repositoryOver(ch, reads, { held: false }).findRunsByTraceId({
        tenantId: TENANT,
        traceId: "trace-1",
      });

      const sql = reads[0]?.statement.sql ?? "";
      expect(sql).toMatch(/toUInt16\(\{v\d+:UInt16\}\) AS AttemptCount/);
      expect(sql).toContain("CAST(NULL AS Nullable(String)) AS LastAttemptErrorText");
      expect(sql).not.toMatch(/\bLastAttemptError\b(?!Text)/);
    });
  });

  describe("when trace reads the runs through the reader's proof", () => {
    it("fences the run read by the proof's windows on ScheduledAt", async () => {
      const ch = client(() => []);
      const reads: ReadRequest[] = [];

      await repositoryOver(ch, reads).findReadableRunsByTraceId({
        authorization,
        traceId: "trace-1",
      });

      expect(reads[0]?.statement).toMatchObject({
        kind: "tenant",
        identity: "reader",
        tenantIds: [TENANT],
        settings: { SQL_langwatch_tenant_ids: TENANT },
      });
      expect(reads[0]?.statement.sql).toContain("ScheduledAt >= subtractDays(now(), ");
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

      const reads: ReadRequest[] = [];
      const summaries = await repositoryOver(ch, reads).findSummariesByTraceIds({
        authorization,
        traceIds: ["trace-1", "trace-2"],
        since: 1_000,
      });

      const request = reads[0];
      expect(request?.table).toBe("evaluation_runs");
      expect(request?.statement).toMatchObject({
        kind: "tenant",
        identity: "reader",
        tenantIds: [TENANT],
        settings: { SQL_langwatch_tenant_ids: TENANT },
      });
      expect(request?.statement.sql).toContain("ScheduledAt >= fromUnixTimestamp64Milli(");
      expect(request?.statement.sql).toContain("max(UpdatedAt)");
      expect(Object.values(request?.statement.params ?? {})).toEqual(
        expect.arrayContaining([1_000, ["trace-1", "trace-2"]]),
      );
      expect(summaries.map((summary) => summary.traceId)).toEqual(["trace-1", "trace-2"]);
      expect(summaries[1]).toMatchObject({
        tenantId: TENANT,
        evaluationId: "eval-2",
        passed: null,
      });
    });
  });
});

const EVALUATION_ROW = {
  ...SUMMARY_ROW,
  Details: null,
  Error: null,
  ScheduledAtMs: "1758189600000",
  StartedAtMs: null,
  CompletedAtMs: null,
  AttemptCount: 0,
  LastAttemptAtMs: null,
  LastAttemptErrorText: null,
  NextAttemptAtMs: null,
};

describe("given reading a trace's evaluations with their inputs exceeds ClickHouse's memory limit", () => {
  describe("when trace reads the evaluations of that trace", () => {
    /** @scenario "A trace's evaluations retry without their inputs when ClickHouse runs out of memory" */
    it("reads them again without inputs and answers every asked trace", async () => {
      const ch = client((request) =>
        request.query.includes("Inputs")
          ? new Error("Code: 241. DB::Exception: Memory limit (total) exceeded")
          : [EVALUATION_ROW],
      );
      const reads: ReadRequest[] = [];

      const evaluations = await repositoryOver(ch, reads).findTraceEvaluations({
        tenantId: TENANT,
        traceIds: ["trace-1", "trace-quiet"],
      });

      expect(ch.query).toHaveBeenCalledTimes(2);
      for (const request of reads) {
        expect(request.statement).toMatchObject({
          kind: "tenant",
          identity: "reader",
          settings: { SQL_langwatch_tenant_ids: TENANT },
        });
      }
      // The trace list repeats inside the election, as main's dedup repeats it.
      const [, election = ""] = (reads[1]?.statement.sql ?? "").split("max(UpdatedAt)");
      expect(election).toMatch(/TraceId IN \(?\{v\d+:Array\(String\)\}/);
      expect(Object.values(reads[1]?.statement.params ?? {})).toEqual(
        expect.arrayContaining([["trace-1", "trace-quiet"]]),
      );
      expect(evaluations["trace-quiet"]).toEqual([]);
      expect(evaluations["trace-1"]?.[0]).toMatchObject({
        evaluationId: "eval-1",
        timestamps: { scheduledAt: 1758189600000, startedAt: null, completedAt: null },
      });
      expect(evaluations["trace-1"]?.[0]).not.toHaveProperty("inputs");
    });
  });

  describe("when trace reads the evaluations through the reader's proof", () => {
    it("fences the read by the proof's windows on ScheduledAt", async () => {
      const ch = client(() => []);
      const reads: ReadRequest[] = [];

      await repositoryOver(ch, reads).findReadableTraceEvaluations({
        authorization,
        traceIds: ["trace-1"],
      });

      expect(reads[0]?.statement).toMatchObject({
        kind: "tenant",
        identity: "reader",
        tenantIds: [TENANT],
        settings: { SQL_langwatch_tenant_ids: TENANT },
      });
      expect(reads[0]?.statement.sql).toContain("Inputs");
    });
  });
});

describe("given the target's evaluation_runs does not have the attempt columns yet", () => {
  describe("when trace reads the evaluations of a trace", () => {
    /** @scenario "Attempt columns a target has not added yet read as no attempts" */
    it("names each missing attempt column as its default and reads no attempts", async () => {
      const ch = client(() => [EVALUATION_ROW]);
      const reads: ReadRequest[] = [];

      const read = await repositoryOver(ch, reads, { held: false }).findTraceEvaluations({
        tenantId: TENANT,
        traceIds: ["trace-1"],
      });

      expect(reads[0]?.statement.sql).toMatch(/toUInt16\(\{v\d+:UInt16\}\) AS AttemptCount/);
      expect(reads[0]?.statement.sql).not.toMatch(/\bLastAttemptError\b(?!Text)/);
      expect(read["trace-1"]?.[0]).toMatchObject({ attempts: 0, lastAttemptError: null });
    });
  });
});

describe("given a run with failed attempts", () => {
  describe("when trace reads the evaluations of a trace", () => {
    /** @scenario "A run's attempts reach the trace's evaluation" */
    it("reads the attempt moments as epoch milliseconds, not as timezone-less text", async () => {
      const ch = client(() => [
        {
          ...EVALUATION_ROW,
          AttemptCount: 2,
          LastAttemptAtMs: "1700000015000",
          NextAttemptAtMs: 1_700_000_025_000,
        },
      ]);
      const reads: ReadRequest[] = [];

      const read = await repositoryOver(ch, reads).findTraceEvaluations({
        tenantId: TENANT,
        traceIds: ["trace-1"],
      });

      expect(reads[0]?.statement.sql).toContain(
        "toUnixTimestamp64Milli(LastAttemptAt) AS LastAttemptAtMs",
      );
      expect(read["trace-1"]?.[0]).toMatchObject({
        attempts: 2,
        lastAttemptAt: 1_700_000_015_000,
        nextAttemptAt: 1_700_000_025_000,
      });
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
