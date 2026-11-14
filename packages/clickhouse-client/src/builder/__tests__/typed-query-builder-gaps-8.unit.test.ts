import type { CompiledWhere } from "@langwatch/authorization";
/**
 * ADR-202, "The typed builder": trace's remaining reads (handoff rp-port-trace-1 section 11). A
 * several-argument uniqExact, a keyset over aggregates in HAVING, a tuple looked up in CTEs, an
 * election on a tuple version with LIMIT 1 BY, and a day window off `now()`.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, it } from "vitest";

import {
  attributeKeysRead,
  braidActivityRead,
  braidMarkedRead,
  evaluationAttemptsRead,
  instantEvalRuns,
  instantEvalRunsRead,
  sessionCountRead,
  sessionMembersRead,
  sessionPageRead,
  spans,
  summaries,
} from "../../__tests__/fixtures/trace-gap-reads.ts";
import { TENANT_IDS_SETTING } from "../../identity/tenantSetting.ts";
import { braidCondition } from "../braid-condition.ts";
import { column, param } from "../expression.ts";
import { fn } from "../functions.ts";
import { QueryBuilderError, type QueryBuilderViolation } from "../query-builder-error.ts";
import { clickhouseRead } from "../read.ts";
import { tenantScope } from "../scope.ts";
import { defineClickHouseTable } from "../table.ts";

const single = tenantScope.single({ tenantId: "proj_a" });
const set = tenantScope.set({ tenantIds: ["proj_a", "proj_b"] });
const conversation = () => fn.mapGet(summaries.Attributes, "gen_ai.conversation.id");

function violationOf(build: () => unknown): QueryBuilderViolation | undefined {
  try {
    build();
  } catch (error) {
    if (error instanceof QueryBuilderError) return error.violation;
    throw error;
  }
  return undefined;
}

describe("given session-groups' count", () => {
  describe("when uniqExact counts tenant and conversation together", () => {
    /** @scenario "uniqExact counts distinct tuples of several arguments" */
    it("renders both arguments in one call, under the reader's tenant setting", () => {
      const statement = sessionCountRead({ scope: set });

      expect(statement.sql).toContain(
        "SELECT uniqExact(TenantId, Attributes[{v0:String}]) AS totalHits FROM trace_summaries",
      );
      expect(statement).toMatchObject({ identity: "reader", kind: "tenant" });
      expect(statement.settings[TENANT_IDS_SETTING]).toBe("proj_a,proj_b");
    });

    /** @scenario "uniqExact counts distinct tuples of several arguments" */
    it("keeps the one-argument form", () => {
      const sql = clickhouseRead({ scope: single })
        .from(summaries)
        .select({ traces: fn.uniqExact(summaries.TraceId) })
        .build().sql;

      expect(sql).toBe(
        "SELECT uniqExact(TraceId) AS traces FROM trace_summaries WHERE TenantId = {tenantId:String}",
      );
      // @ts-expect-error uniqExact takes at least one argument
      expect(() => fn.uniqExact()).not.toThrow();
    });
  });
});

describe("given session-groups' rollup page", () => {
  describe("when a cursor is given", () => {
    /** @scenario "A keyset over aggregates pages in HAVING" */
    it("compares the aggregate and the group keys' tuple in HAVING, after GROUP BY", () => {
      const statement = sessionPageRead({
        scope: single,
        cursor: { sortValue: 1.5, conversationId: "c1", tenantId: "proj_a" },
        limit: 2,
      });

      expect(statement.sql).toContain(
        " GROUP BY TenantId, Attributes[{v3:String}] HAVING (sum(TotalCost) < {v4:Float64} OR" +
          " (sum(TotalCost) = {v5:Float64} AND tuple(Attributes[{v6:String}], TenantId) >" +
          " tuple({v7:String}, {v8:String}))) ORDER BY sum(TotalCost) DESC, ConversationId ASC," +
          " TenantId ASC LIMIT 2",
      );
      expect(statement.params).toMatchObject({ v4: 1.5, v5: 1.5, v7: "c1", v8: "proj_a" });
      expect(statement.tenantId).toBe("proj_a");
    });
  });

  describe("when no cursor is given", () => {
    /** @scenario "A keyset over aggregates pages in HAVING" */
    it("renders no HAVING", () => {
      const statement = sessionPageRead({ scope: single, cursor: undefined, limit: 2 });

      expect(statement.sql).not.toContain("HAVING");
    });
  });
});

describe("given session-groups' membership of two branches", () => {
  describe("when the tuple is looked up in one CTE per branch", () => {
    /** @scenario "A tuple is looked up in CTEs standing for a UNION DISTINCT" */
    it("renders each CTE under the tenant predicate and ORs the two lookups", () => {
      const { sql } = sessionMembersRead({ scope: single, minCost: 1, term: "hello" });

      expect(sql).toContain(
        "WITH traceMembers AS (SELECT DISTINCT TenantId, Attributes[{v0:String}] AS SessionId" +
          " FROM trace_summaries WHERE TenantId = {tenantId:String}",
      );
      expect(sql).toContain(
        "logMembers AS (SELECT DISTINCT TenantId, ProviderSessionId AS SessionId FROM" +
          " log_records WHERE TenantId = {tenantId:String}",
      );
      expect(sql).toContain(
        "(tuple(TenantId, Attributes[{v10:String}]) IN traceMembers OR" +
          " tuple(TenantId, Attributes[{v11:String}]) IN logMembers)",
      );
    });

    /** @scenario "A tuple is looked up in CTEs standing for a UNION DISTINCT" */
    it("does not compile a tuple looked up in a CTE of other values", () => {
      const read = () =>
        clickhouseRead({ scope: single })
          .from(summaries)
          .with("counts", (sub) => sub.from(summaries).select({ n: fn.count() }))
          .select({ TraceId: summaries.TraceId })
          .where(({ oneOf }) =>
            // @ts-expect-error a tuple of strings never reads a CTE of counts
            oneOf(fn.tuple(summaries.TenantId, conversation()), { cte: "counts" }),
          );

      expect(read().build().sql).toContain("IN counts");
    });
  });
});

describe("given instant-eval's run dating", () => {
  describe("when the election takes the max of a tuple version", () => {
    /** @scenario "A latest-version read elects on a tuple of its columns, one row per key" */
    it("renders the tuple in the key tuple and under max, then LIMIT 1 BY the run", () => {
      const statement = instantEvalRunsRead({ scope: single, runIds: ["r1", "r1", "r2"] });

      expect(statement.sql).toBe(
        "SELECT RunId, toUnixTimestamp64Milli(CreatedAt) AS CreatedAtMs," +
          " toUnixTimestamp64Milli(FinishedAt) AS FinishedAtMs FROM instant_eval_runs" +
          " WHERE TenantId = {tenantId:String} AND RunId IN ({v1:Array(String)})" +
          " AND (TenantId, RunId, tuple(WrittenAt, ifNull(AcceptedAt, toDateTime64({v0:UInt32}, 3))," +
          " LastEventId)) IN (SELECT TenantId, RunId, max(tuple(WrittenAt, ifNull(AcceptedAt," +
          " toDateTime64({v0:UInt32}, 3)), LastEventId)) FROM instant_eval_runs" +
          " WHERE TenantId = {tenantId:String} AND RunId IN ({v1:Array(String)})" +
          " GROUP BY TenantId, RunId) LIMIT 1 BY RunId",
      );
      expect(statement.params).toEqual({ tenantId: "proj_a", v0: 0, v1: ["r1", "r2"] });
    });
  });

  describe("when the tuple version reads the tenant column or no column", () => {
    /** @scenario "A latest-version read elects on a tuple of its columns, one row per key" */
    it("refuses it", () => {
      const read = () =>
        clickhouseRead({ scope: single })
          .from(instantEvalRuns)
          .select({ RunId: instantEvalRuns.RunId });

      expect(
        violationOf(() =>
          read().latestVersion({
            version: fn.tuple(instantEvalRuns.WrittenAt, instantEvalRuns.TenantId),
          }),
        ),
      ).toEqual({
        kind: "version-outside-election",
        table: "instant_eval_runs",
        column: "instant_eval_runs.TenantId",
      });
      expect(
        violationOf(() => read().latestVersion({ version: fn.tuple(param.uint32(1)) })),
      ).toEqual({ kind: "version-outside-election", table: "instant_eval_runs", column: "call" });
    });
  });
});

describe("given evaluation-runs' attempt read", () => {
  describe("when the target holds the attempt columns", () => {
    /** @scenario "A select reads the columns its target holds and a day window off now()" */
    it("reads them, and repeats the day window and trace in the election", () => {
      const { sql, params } = evaluationAttemptsRead({
        scope: single,
        traceId: "t1",
        holds: () => true,
      });

      expect(sql).toContain(
        "SELECT EvaluationId, Attempts AS AttemptCount," +
          " toUnixTimestamp64Milli(LastAttemptAt) AS LastAttemptAtMs FROM evaluation_runs",
      );
      expect(sql).toContain(
        "FROM evaluation_runs WHERE TenantId = {tenantId:String} AND ScheduledAt >=" +
          " subtractDays(now(), {v0:UInt32}) AND TraceId = {v1:String} GROUP BY",
      );
      expect(params).toMatchObject({ v0: 7, v1: "t1" });
    });
  });

  describe("when the target lacks them", () => {
    /** @scenario "A select reads the columns its target holds and a day window off now()" */
    it("reads each as its typed default", () => {
      const { sql } = evaluationAttemptsRead({ scope: single, traceId: "t1", holds: () => false });

      expect(sql).toContain(
        "SELECT EvaluationId, toUInt16({v0:UInt16}) AS AttemptCount," +
          " toUnixTimestamp64Milli(CAST(NULL AS Nullable(DateTime64(3)))) AS LastAttemptAtMs",
      );
    });
  });

  describe("when the day count is fractional or negative", () => {
    /** @scenario "A select reads the columns its target holds and a day window off now()" */
    it("refuses it", () => {
      expect(violationOf(() => fn.subtractDays(fn.now(), 1.5))).toEqual({
        kind: "bad-constant",
        value: 1.5,
      });
      expect(violationOf(() => fn.subtractDays(fn.now(), -1))).toEqual({
        kind: "bad-constant",
        value: -1,
      });
    });
  });
});

const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};
const SIGNED: CompiledWhere = {
  version: 1,
  tree: {
    kind: "and",
    terms: [
      { kind: "nameEquals", value: "llm'); DROP" },
      { kind: "verified", key: "orchestrator" },
    ],
  },
};
const braidOf = (compiledWhere: CompiledWhere, fromMs = 0) => ({
  compiledWhere,
  reader: "proj_reader",
  fromMs,
  untilMs: fromMs + 1000,
});

describe("given a braid's compiled condition as a plain condition", () => {
  describe("when it is a term of argMax inside a derived read, per braid", () => {
    /** @scenario "A braid's compiled condition is a plain condition binding every key and literal" */
    it("binds each braid's keys and literals under its own prefix, no literal in the text", () => {
      const { sql, params } = braidActivityRead({
        scope: single,
        braids: [braidOf(WEB), braidOf(WEB, 500)],
        sinceMs: 0,
      });

      expect(sql).toContain(
        "argMax((StartTime >= fromUnixTimestamp64Milli({v0:Int64}) AND StartTime <" +
          " fromUnixTimestamp64Milli({v1:Int64}) AND (SpanAttributes[{b2_k:Array(String)}[1]] =" +
          " {b2_v:Array(String)}[1])), UpdatedAt) AS a0",
      );
      expect(sql).toContain("SELECT countIf(a0) AS a0, countIf(a1) AS a1 FROM (SELECT argMax(");
      expect(params).toMatchObject({ b2_k: ["orchestrator"], b2_v: ["web"], b5_v: ["web"] });
      expect(sql).not.toContain("orchestrator");
      expect(sql).not.toContain("'web'");
    });
  });

  describe("when the same condition is selected and filtered on, with Verified()", () => {
    /** @scenario "A braid's compiled condition is a plain condition binding every key and literal" */
    it("renders it twice under one prefix, and binds the reader", () => {
      const braided = braidCondition(spans, braidOf(SIGNED));
      const { sql, params } = clickhouseRead({ scope: single })
        .from(spans)
        .select({ SpanId: spans.SpanId, Braided: braided })
        .where(({ not }) => not(braided))
        .build();

      expect(sql).toBe(
        "SELECT SpanId, (SpanName = {b0_v:Array(String)}[1] AND mapContains(SpanAttributes," +
          " {b0_k:Array(String)}[1]) AND SpanAttributes[{b0_k:Array(String)}[2]] =" +
          " {b0_reader:String}) AS Braided FROM stored_spans WHERE TenantId = {tenantId:String}" +
          " AND NOT ((SpanName = {b0_v:Array(String)}[1] AND mapContains(SpanAttributes," +
          " {b0_k:Array(String)}[1]) AND SpanAttributes[{b0_k:Array(String)}[2]] =" +
          " {b0_reader:String}))",
      );
      expect(params).toEqual({
        tenantId: "proj_a",
        b0_v: ["llm'); DROP"],
        b0_k: ["orchestrator", "langwatch.reserved.verified.orchestrator"],
        b0_reader: "proj_reader",
      });
      expect(braidMarkedRead({ scope: single, braid: braidOf(WEB), traceId: "t1" }).sql).toContain(
        "(SpanAttributes[{b0_k:Array(String)}[1]] = {b0_v:Array(String)}[1]) AS Braided",
      );
    });
  });

  describe("when the table lacks a column the terms read, or the read joins", () => {
    /** @scenario "A braid's compiled condition is a plain condition binding every key and literal" */
    it("refuses it", () => {
      const bare = defineClickHouseTable({
        name: "stored_spans",
        tenantColumn: "TenantId",
        sortKey: ["TenantId", "TraceId", "SpanId"],
        columns: {
          TenantId: column.string(),
          TraceId: column.string(),
          SpanId: column.string(),
          SpanAttributes: column.stringMap(),
        },
      });
      expect(violationOf(() => braidCondition(bare, braidOf(SIGNED)))).toEqual({
        kind: "foreign-column",
        table: "stored_spans",
        column: "SpanName",
      });
      expect(
        violationOf(() =>
          clickhouseRead({ scope: single })
            .from(spans)
            .innerJoin(summaries, ({ eq }) => eq(summaries.TraceId, spans.TraceId))
            .select({ SpanId: spans.SpanId })
            .where(() => braidCondition(spans, braidOf(WEB)))
            .build(),
        ),
      ).toEqual({ kind: "unsupported-operand", column: "braid" });
    });
  });
});

describe("given trace braid's attribute keys over a sample", () => {
  describe("when main's ARRAY JOIN is arrayJoin in a derived read of the sample", () => {
    /** @scenario "An ARRAY JOIN over a sample is arrayJoin in a derived read" */
    it("joins each key once, filters and groups it outside, the sample limited inside", () => {
      const { sql } = attributeKeysRead({
        scope: single,
        sinceMs: 0,
        sampleRows: 50_000,
        excludedPrefix: "langwatch.",
        limit: 10,
      });

      expect(sql).toBe(
        "SELECT key, count() AS spanCount FROM (SELECT arrayJoin(mapKeys(SpanAttributes)) AS key" +
          " FROM (SELECT SpanAttributes FROM stored_spans WHERE TenantId = {tenantId:String} AND" +
          " StartTime >= fromUnixTimestamp64Milli({v0:Int64}) LIMIT 50000) AS sampled) AS keys" +
          " WHERE NOT (startsWith(key, {v1:String})) GROUP BY key ORDER BY spanCount DESC," +
          " key ASC LIMIT 10",
      );
    });
  });
});
