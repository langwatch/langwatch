/**
 * The judgements table as a dataset: isolated by tenant, joinable to traces,
 * and groupable by label.
 *
 * These run against the real table migration 00097 creates, because what they
 * assert is a property of the schema rather than of the repository: the sort
 * key puts `TenantId` first so a read by run id cannot cross a project, the
 * join keys the catalog publishes are columns a join can actually use, and the
 * label column is low enough cardinality to group on directly.
 *
 * @see ../instant-eval-judgments.repository.ts
 * @see ../../../../clickhouse/migrations/00097_create_instant_eval_judgments.sql
 * @see ../../../../../../../specs/analytics/lwql-judgments-view.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { ClickHouseInstantEvalJudgmentsRepository } from "../instant-eval-judgments.repository";
import type { InstantEvalJudgmentRecord } from "../judgments";

const thisProject = `test-judgments-${nanoid()}`;
const otherProject = `test-judgments-other-${nanoid()}`;
const runId = `instanteval_${nanoid()}`;
const writtenAt = Date.now();

let ch: ClickHouseClient;
let repository: ClickHouseInstantEvalJudgmentsRepository;

function judgment(
  overrides: Partial<InstantEvalJudgmentRecord>,
): InstantEvalJudgmentRecord {
  return {
    TenantId: thisProject,
    RunId: runId,
    TraceId: `trace-${nanoid()}`,
    QuestionId: "mood",
    ThreadId: `thread-${nanoid()}`,
    SpanId: "",
    Kind: "category",
    Status: "judged",
    Passed: null,
    Score: null,
    Label: "annoyed",
    Probability: 0.91,
    Probabilities: JSON.stringify({ annoyed: 0.91, calm: 0.09 }),
    Error: "",
    OccurredAt: writtenAt,
    CreatedAt: writtenAt,
    UpdatedAt: writtenAt,
    ...overrides,
  };
}

/** The trace the join reads, with only the columns that carry no default. */
const joinedTraceId = `trace-joined-${nanoid()}`;

beforeAll(async () => {
  const client = getTestClickHouseClient();
  if (!client) throw new Error("ClickHouse is not available for this test");
  ch = client;
  repository = new ClickHouseInstantEvalJudgmentsRepository(async () => ch);

  await repository.insert([
    judgment({ TraceId: joinedTraceId, Label: "annoyed" }),
    judgment({ Label: "annoyed" }),
    judgment({ Label: "calm", Probability: 0.72 }),
  ]);
  // The same run id, written by another project. The read below must not see
  // it, and the sort key is what guarantees that rather than a predicate a
  // caller could forget. One batch per tenant, which the repository enforces.
  await repository.insert([
    judgment({ TenantId: otherProject, Label: "furious" }),
  ]);

  await ch.insert({
    table: "trace_summaries",
    format: "JSONEachRow",
    values: [
      {
        ProjectionId: `projection-${nanoid()}`,
        TenantId: thisProject,
        TraceId: joinedTraceId,
        Version: "1",
        Attributes: {},
        OccurredAt: writtenAt,
        ComputedIOSchemaVersion: "1",
        ComputedInput: "how is this going",
        ComputedOutput: "badly",
        TotalDurationMs: 120,
        SpanCount: 1,
        ContainsErrorStatus: false,
        ContainsOKStatus: true,
        Models: ["gpt-5-mini"],
        TokensEstimated: false,
      },
    ],
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
});

afterAll(async () => {
  for (const tenant of [thisProject, otherProject]) {
    await ch.command({
      query: `ALTER TABLE instant_eval_judgments DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId: tenant },
    });
  }
  await ch.command({
    query: `ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}`,
    query_params: { tenantId: thisProject },
  });
});

describe("given a run's judgements in ClickHouse", () => {
  describe("when another project asks for the same run", () => {
    /** @scenario A judgement written by one project is invisible to another */
    it("returns only the judgements written for the asking project", async () => {
      const window = {
        writtenFrom: new Date(writtenAt - 60_000),
        writtenUntil: new Date(writtenAt + 60_000),
        runId,
        limit: 100,
      };

      const mine = await repository.page({
        ...window,
        projectId: thisProject,
      });
      const theirs = await repository.page({
        ...window,
        projectId: otherProject,
      });

      expect(mine.judgments).toHaveLength(3);
      expect(mine.judgments.map((one) => one.label)).not.toContain("furious");
      expect(theirs.judgments.map((one) => one.label)).toEqual(["furious"]);
    });
  });

  describe("when the judgements are joined to the traces table", () => {
    /** @scenario Judgements join back to traces on the trace id */
    it("carries the verdict and the trace on one row", async () => {
      const result = await ch.query({
        query: `
          SELECT j.Label AS verdict, t.ComputedOutput AS output
          FROM instant_eval_judgments AS j
          INNER JOIN trace_summaries AS t
            ON t.TenantId = j.TenantId AND t.TraceId = j.TraceId
          WHERE j.TenantId = {tenantId:String}
            AND j.RunId = {runId:String}
            AND j.TraceId = {traceId:String}
          LIMIT 1
        `,
        query_params: {
          tenantId: thisProject,
          runId,
          traceId: joinedTraceId,
        },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ verdict: string; output: string }>();

      expect(rows).toEqual([{ verdict: "annoyed", output: "badly" }]);
    });
  });

  describe("when the run's labels are counted", () => {
    /** @scenario Counting labels of a finished run is one grouped query */
    it("counts each label once per trace and question", async () => {
      const result = await ch.query({
        query: `
          SELECT Label AS label, count() AS judgements
          FROM (
            SELECT
              TraceId,
              QuestionId,
              argMax(Label, UpdatedAt) AS Label
            FROM instant_eval_judgments
            WHERE TenantId = {tenantId:String} AND RunId = {runId:String}
            GROUP BY TraceId, QuestionId
          )
          GROUP BY label
          ORDER BY label
        `,
        query_params: { tenantId: thisProject, runId },
        format: "JSONEachRow",
      });
      const rows = await result.json<{ label: string; judgements: number }>();

      expect(rows).toEqual([
        { label: "annoyed", judgements: 2 },
        { label: "calm", judgements: 1 },
      ]);
    });
  });
});
