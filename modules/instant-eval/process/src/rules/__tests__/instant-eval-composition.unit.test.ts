/**
 * What the run wraps around the caller's statement, how it pages, and how it
 * samples. Every case asserts the same thing: the caller's text appears inside
 * the wrapper character for character.
 * @see specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_AFTER_PARAMETER,
  INSTANT_EVAL_AFTER_SPAN_PARAMETER,
  INSTANT_EVAL_PAGE_PARAMETER,
  INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER,
  instantEvalCountSql,
  instantEvalKeyPassSql,
  instantEvalPagePassSql,
  instantEvalPagesBySpan,
  instantEvalProbeSql,
  instantEvalSampleBuckets,
  instantEvalSampleKeysSql,
  isInstantEvalReservedParameter,
} from "../instant-eval-composition.rules.ts";

const SQL = `SELECT ConversationId, eval(conversation_bounded(ConversationId, 8000, ''), 'annoyed') AS annoyed
FROM analytics.trace_metrics
WHERE OccurredAt >= subtractDays(now(), 7)
GROUP BY ConversationId`;

const SPAN_SQL = `SELECT TraceId, SpanId, eval(llm_messages_span(TraceId, SpanId), 'refused') AS refused
FROM analytics.spans
WHERE StartTime >= subtractDays(now(), 7)`;

const keyPass = (keyColumns: readonly string[], hasCursor: boolean, sql = SQL) =>
  instantEvalKeyPassSql({ sql, keyColumns, limit: 501, hasCursor });

const sampleKeys = (keyColumns: readonly string[]) =>
  instantEvalSampleKeysSql({ sql: SQL, keyColumns, limit: 50 });

describe("given a caller's statement", () => {
  describe("when the probe is composed", () => {
    /** @scenario "The missing-column check runs the statement for no rows at all" */
    it("asks for no rows at all", () => {
      expect(instantEvalProbeSql(SQL)).toContain("LIMIT 0");
    });

    it("keeps the caller's own text unchanged inside it", () => {
      expect(instantEvalProbeSql(SQL)).toContain(SQL);
    });
  });

  describe("when the key pass is composed", () => {
    /** @scenario "Pass one selects the keys and nothing else" */
    it("selects the trace id and the key columns the statement projects", () => {
      const sql = keyPass(["ThreadId", "OccurredAt"], false);

      expect(sql).toContain(
        "SELECT q.TraceId AS TraceId, q.ThreadId AS ThreadId, q.OccurredAt AS OccurredAt",
      );
      expect(sql).not.toContain("SpanId");
    });

    /** @scenario "Pass one selects the keys and nothing else" */
    it("keeps the caller's own text unchanged inside it", () => {
      expect(keyPass([], false)).toContain(SQL);
    });

    it("orders by the trace id, which is the one column a run requires", () => {
      expect(keyPass([], false)).toContain("ORDER BY q.TraceId");
    });

    it("carries no cursor predicate on the first page", () => {
      expect(keyPass([], false)).not.toContain(INSTANT_EVAL_AFTER_PARAMETER);
    });

    it("starts after the previous page's last id on a later page", () => {
      expect(keyPass([], true)).toContain(
        `WHERE q.TraceId > {${INSTANT_EVAL_AFTER_PARAMETER}:String}`,
      );
    });
  });

  describe("when the page pass is composed", () => {
    /** @scenario "A page binds its own trace ids into the statement" */
    it("returns only the page's own trace ids", () => {
      expect(instantEvalPagePassSql(SQL)).toContain(
        `WHERE q.TraceId IN ({${INSTANT_EVAL_PAGE_PARAMETER}:Array(String)})`,
      );
    });

    /** @scenario "A page binds its own trace ids into the statement" */
    it("keeps the caller's own text unchanged inside it", () => {
      expect(instantEvalPagePassSql(SQL)).toContain(SQL);
    });

    it("keeps every output column the caller aliased", () => {
      expect(instantEvalPagePassSql(SQL)).toContain("SELECT * FROM (");
    });
  });
});

describe("given a statement that projects a span id", () => {
  /** @scenario "A statement with one row per span pages by the trace and the span" */
  it("pages by the pair, and by the trace alone without one", () => {
    expect(instantEvalPagesBySpan(["ThreadId", "SpanId"])).toBe(true);
    expect(instantEvalPagesBySpan(["ThreadId", "OccurredAt"])).toBe(false);
  });

  describe("when the first page's key pass is composed", () => {
    /** @scenario "A statement with one row per span pages by the trace and the span" */
    it("orders by the trace and the span together", () => {
      const sql = keyPass(["SpanId"], false, SPAN_SQL);

      expect(sql).toContain("ORDER BY (q.TraceId, q.SpanId)");
      expect(sql).toContain(SPAN_SQL);
      expect(sql).not.toContain("WHERE (q.TraceId");
    });
  });

  describe("when a later page's key pass is composed", () => {
    /** @scenario "A statement with one row per span pages by the trace and the span" */
    it("compares the pair against both halves of the cursor", () => {
      expect(keyPass(["SpanId"], true, SPAN_SQL)).toContain(
        `WHERE (q.TraceId, q.SpanId) > ({${INSTANT_EVAL_AFTER_PARAMETER}:String}, {${INSTANT_EVAL_AFTER_SPAN_PARAMETER}:String})`,
      );
    });
  });

  describe("when the statement projects no span id", () => {
    it("compares the trace alone, so no span parameter is bound", () => {
      const sql = keyPass(["ThreadId"], true, SPAN_SQL);

      expect(sql).toContain(`WHERE q.TraceId > {${INSTANT_EVAL_AFTER_PARAMETER}:String}`);
      expect(sql).not.toContain(INSTANT_EVAL_AFTER_SPAN_PARAMETER);
    });
  });
});

describe("given a run about to learn its size", () => {
  describe("when the count is composed", () => {
    /** @scenario "The run's total comes from a count rather than from every key" */
    it("counts inside the database, bounded one past the limit", () => {
      const sql = instantEvalCountSql({ sql: SPAN_SQL, limit: 10_001 });

      expect(sql).toContain("SELECT count() AS total");
      expect(sql).toContain("LIMIT 10001");
      expect(sql).toContain(SPAN_SQL);
    });
  });
});

describe("given a selection to sample", () => {
  describe("when the sample statement is composed", () => {
    /** @scenario "The sampled rows are spread across the selection, not taken from its start" */
    it("draws its rows from across the whole selection", () => {
      const sql = sampleKeys(["ThreadId"]);

      expect(sql).toContain(
        `cityHash64(q.TraceId) % {${INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER}:UInt64} = 0`,
      );
      expect(sql).toContain("LIMIT 50");
    });

    /** @scenario "The sampled rows are spread across the selection, not taken from its start" */
    it("is not the first rows the statement returns", () => {
      const sql = sampleKeys(["ThreadId"]);

      expect(sql).toContain("WHERE");
      expect(sql).toContain("cityHash64");
    });

    it("leaves the caller's statement character for character", () => {
      expect(sampleKeys(["ThreadId"])).toContain(SQL);
    });

    it("projects only the key columns the statement offers", () => {
      const sql = sampleKeys(["ThreadId"]);

      expect(sql).toContain("q.TraceId AS TraceId");
      expect(sql).toContain("q.ThreadId AS ThreadId");
      expect(sql).not.toContain("SpanId");
    });

    /** @scenario "A sample over spans is spread over spans, not over whole traces" */
    it("hashes the trace and span pair when the rows are spans", () => {
      const sql = sampleKeys(["SpanId", "OccurredAt"]);

      expect(sql).toContain("cityHash64(q.TraceId, q.SpanId) %");
      expect(sql).not.toContain("cityHash64(q.TraceId) %");
    });
  });

  describe("when the bucket count is chosen", () => {
    it("draws one row in every total-over-limit", () => {
      expect(instantEvalSampleBuckets({ total: 10_000, limit: 50 })).toBe(200);
      expect(instantEvalSampleBuckets({ total: 500, limit: 50 })).toBe(10);
    });

    /** @scenario "A selection only just larger than the sample is still spread" */
    it("never uses one bucket for a selection larger than the sample", () => {
      expect(instantEvalSampleBuckets({ total: 75, limit: 50 })).toBe(2);
      expect(instantEvalSampleBuckets({ total: 51, limit: 50 })).toBe(2);
      expect(instantEvalSampleBuckets({ total: 99, limit: 50 })).toBe(2);
      expect(instantEvalSampleBuckets({ total: 100, limit: 50 })).toBe(2);
    });

    /** @scenario "A selection smaller than the sample has every row sampled" */
    it("takes every row when the selection is no larger than the sample", () => {
      expect(instantEvalSampleBuckets({ total: 10, limit: 50 })).toBe(1);
      expect(instantEvalSampleBuckets({ total: 50, limit: 50 })).toBe(1);
      expect(instantEvalSampleBuckets({ total: 0, limit: 50 })).toBe(1);
    });

    it("never divides by zero buckets", () => {
      expect(instantEvalSampleBuckets({ total: 10_000, limit: 0 })).toBe(1);
    });
  });
});

describe("given a parameter name", () => {
  describe("when the run is asked whether it owns it", () => {
    /** @scenario "A request supplying a reserved run parameter is refused" */
    it("owns the page, cursor and bucket parameters", () => {
      expect(isInstantEvalReservedParameter(INSTANT_EVAL_PAGE_PARAMETER)).toBe(true);
      expect(isInstantEvalReservedParameter(INSTANT_EVAL_AFTER_PARAMETER)).toBe(true);
      expect(isInstantEvalReservedParameter(INSTANT_EVAL_AFTER_SPAN_PARAMETER)).toBe(true);
      expect(isInstantEvalReservedParameter(INSTANT_EVAL_SAMPLE_BUCKET_PARAMETER)).toBe(true);
    });

    it("owns nothing else", () => {
      expect(isInstantEvalReservedParameter("customer_id")).toBe(false);
      expect(isInstantEvalReservedParameter("dashboard_context_period_start")).toBe(false);
    });
  });
});
