/**
 * What a pass wraps around the caller's statement, how it pages, and how it
 * samples. Every case holds the caller's text inside the wrapper character for
 * character. @see modules/instant-eval/specs/instant-eval-pipeline.feature
 */

import {
  LWQL_HYDRATION_TRACE_IDS_PARAMETER,
  LWQL_PASS_AFTER_SPAN_PARAMETER,
  LWQL_PASS_AFTER_TRACE_PARAMETER,
  LWQL_PASS_SAMPLE_BUCKET_PARAMETER,
  type LangWatchQLPassKeyColumn,
} from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { langWatchQLPassSql } from "../langwatch-ql-pass-sql.rules.ts";

const SQL = `SELECT ConversationId, eval(conversation_bounded(ConversationId, 8000, ''), 'annoyed') AS annoyed
FROM analytics.trace_metrics
WHERE OccurredAt >= subtractDays(now(), 7)
GROUP BY ConversationId`;

const SPAN_SQL = `SELECT TraceId, SpanId, eval(llm_messages_span(TraceId, SpanId), 'refused') AS refused
FROM analytics.spans
WHERE StartTime >= subtractDays(now(), 7)`;

const keyPass = ({
  keyColumns,
  after,
  sql = SQL,
}: {
  keyColumns: readonly LangWatchQLPassKeyColumn[];
  after?: { traceId: string; spanId: string | null };
  sql?: string;
}) =>
  langWatchQLPassSql({
    sql,
    pass: { kind: "keys", keyColumns, limit: 501, ...(after ? { after } : {}) },
  });

const sampleKeys = (keyColumns: readonly LangWatchQLPassKeyColumn[]) =>
  langWatchQLPassSql({ sql: SQL, pass: { kind: "sample", keyColumns, limit: 50, buckets: 7 } });

describe("given a caller's statement", () => {
  describe("when the probe is composed", () => {
    /** @scenario "The missing-column check runs the statement for no rows at all" */
    it("asks for no rows at all, around the caller's own text", () => {
      expect(langWatchQLPassSql({ sql: SQL, pass: { kind: "probe" } })).toEqual({
        sql: `SELECT * FROM (\n${SQL}\n) AS q LIMIT 0`,
        parameters: {},
      });
    });
  });

  describe("when the key pass is composed", () => {
    /** @scenario "Pass one selects the keys and nothing else" */
    it("selects the trace id and the key columns the statement projects", () => {
      const { sql } = keyPass({ keyColumns: ["ThreadId", "OccurredAt"] });

      expect(sql).toContain(
        "SELECT q.TraceId AS TraceId, q.ThreadId AS ThreadId, q.OccurredAt AS OccurredAt",
      );
      expect(sql).not.toContain("SpanId");
    });

    /** @scenario "Pass one selects the keys and nothing else" */
    it("keeps the caller's own text unchanged inside it", () => {
      expect(keyPass({ keyColumns: [] }).sql).toContain(SQL);
    });

    it("orders by the trace id and bounds the page", () => {
      const { sql } = keyPass({ keyColumns: [] });

      expect(sql).toContain("ORDER BY q.TraceId\nLIMIT 501");
    });

    it("carries no cursor on the first page", () => {
      const pass = keyPass({ keyColumns: [] });

      expect(pass.sql).not.toContain(LWQL_PASS_AFTER_TRACE_PARAMETER);
      expect(pass.parameters).toEqual({});
    });

    it("starts after the previous page's last id on a later page", () => {
      const pass = keyPass({ keyColumns: [], after: { traceId: "t0", spanId: null } });

      expect(pass.sql).toContain(`WHERE q.TraceId > {${LWQL_PASS_AFTER_TRACE_PARAMETER}:String}`);
      expect(pass.parameters).toEqual({ [LWQL_PASS_AFTER_TRACE_PARAMETER]: "t0" });
    });
  });

  describe("when the page pass is composed", () => {
    /** @scenario "A page binds its own trace ids into the statement" */
    it("returns only the page's own trace ids, around the caller's own text", () => {
      const pass = langWatchQLPassSql({ sql: SQL, pass: { kind: "page", traceIds: ["t1", "t2"] } });

      expect(pass.sql).toContain(SQL);
      expect(pass.sql).toContain("SELECT * FROM (");
      expect(pass.sql).toContain(
        `WHERE q.TraceId IN ({${LWQL_HYDRATION_TRACE_IDS_PARAMETER}:Array(String)})`,
      );
      expect(pass.parameters).toEqual({ [LWQL_HYDRATION_TRACE_IDS_PARAMETER]: ["t1", "t2"] });
    });
  });
});

describe("given a statement that projects a span id", () => {
  describe("when the first page's key pass is composed", () => {
    /** @scenario "A statement with one row per span pages by the trace and the span" */
    it("orders by the trace and the span together", () => {
      const { sql } = keyPass({ keyColumns: ["SpanId"], sql: SPAN_SQL });

      expect(sql).toContain("ORDER BY (q.TraceId, q.SpanId)");
      expect(sql).toContain(SPAN_SQL);
      expect(sql).not.toContain("WHERE (q.TraceId");
    });
  });

  describe("when a later page's key pass is composed", () => {
    /** @scenario "A statement with one row per span pages by the trace and the span" */
    it("compares the pair against both halves of the cursor", () => {
      const pass = keyPass({
        keyColumns: ["SpanId"],
        after: { traceId: "t0", spanId: "s0" },
        sql: SPAN_SQL,
      });

      expect(pass.sql).toContain(
        `WHERE (q.TraceId, q.SpanId) > ({${LWQL_PASS_AFTER_TRACE_PARAMETER}:String}, {${LWQL_PASS_AFTER_SPAN_PARAMETER}:String})`,
      );
      expect(pass.parameters).toEqual({
        [LWQL_PASS_AFTER_TRACE_PARAMETER]: "t0",
        [LWQL_PASS_AFTER_SPAN_PARAMETER]: "s0",
      });
    });
  });

  describe("when the statement projects no span id", () => {
    /** @scenario "A statement with one row per span pages by the trace and the span" */
    it("compares the trace alone, so no span parameter is bound", () => {
      const pass = keyPass({
        keyColumns: ["ThreadId"],
        after: { traceId: "t0", spanId: "s0" },
        sql: SPAN_SQL,
      });

      expect(pass.sql).toContain(`WHERE q.TraceId > {${LWQL_PASS_AFTER_TRACE_PARAMETER}:String}`);
      expect(pass.sql).not.toContain(LWQL_PASS_AFTER_SPAN_PARAMETER);
      expect(pass.parameters).toEqual({ [LWQL_PASS_AFTER_TRACE_PARAMETER]: "t0" });
    });
  });
});

describe("given a run about to learn its size", () => {
  describe("when the count is composed", () => {
    /** @scenario "The run's total comes from a count rather than from every key" */
    it("counts inside the database, bounded one past the limit", () => {
      const { sql } = langWatchQLPassSql({ sql: SPAN_SQL, pass: { kind: "count", limit: 10_001 } });

      expect(sql).toContain("SELECT count() AS total");
      expect(sql).toContain("LIMIT 10001");
      expect(sql).toContain(SPAN_SQL);
    });
  });
});

describe("given a selection to sample", () => {
  describe("when the sample statement is composed", () => {
    /** @scenario "The sampled rows are spread across the selection, not taken from its start" */
    it("draws its rows from across the whole selection by a bound bucket count", () => {
      const pass = sampleKeys(["ThreadId"]);

      expect(pass.sql).toContain(
        `WHERE cityHash64(q.TraceId) % {${LWQL_PASS_SAMPLE_BUCKET_PARAMETER}:UInt64} = 0`,
      );
      expect(pass.sql).toContain("LIMIT 50");
      expect(pass.sql).toContain(SQL);
      expect(pass.parameters).toEqual({ [LWQL_PASS_SAMPLE_BUCKET_PARAMETER]: 7 });
    });

    it("projects only the key columns the statement offers", () => {
      const { sql } = sampleKeys(["ThreadId"]);

      expect(sql).toContain("q.TraceId AS TraceId, q.ThreadId AS ThreadId");
      expect(sql).not.toContain("SpanId");
    });

    /** @scenario "A sample over spans is spread over spans, not over whole traces" */
    it("hashes the trace and span pair when the rows are spans", () => {
      const { sql } = sampleKeys(["SpanId", "OccurredAt"]);

      expect(sql).toContain("cityHash64(q.TraceId, q.SpanId) %");
      expect(sql).not.toContain("cityHash64(q.TraceId) %");
    });
  });
});
