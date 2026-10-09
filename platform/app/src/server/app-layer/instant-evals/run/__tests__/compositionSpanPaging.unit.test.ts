/**
 * What the run wraps when a statement has more than one row per trace.
 *
 * `TraceId` is the one column a run requires, so it is always there to order
 * by, but it is not unique: a statement over `analytics.spans` projects one
 * row per span. Ordering by the trace alone would cut a trace's span rows
 * across a page boundary, and the next page, starting at `TraceId > cursor`,
 * would skip the rest of them.
 *
 * @see ../composition.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_AFTER_PARAMETER,
  INSTANT_EVAL_AFTER_SPAN_PARAMETER,
  instantEvalCountSql,
  instantEvalKeyPassSql,
  instantEvalPagesBySpan,
  isInstantEvalReservedParameter,
} from "../composition";

const SQL = `SELECT TraceId, SpanId, eval(llm_messages_span(TraceId, SpanId), 'refused') AS refused
FROM analytics.spans
WHERE StartTime >= subtractDays(now(), 7)`;

describe("given a statement that projects a span id", () => {
  describe("when the key columns are read", () => {
    /** @scenario "A statement with one row per span pages by the trace and the span" */
    it("pages by the pair", () => {
      expect(instantEvalPagesBySpan(["ThreadId", "SpanId"])).toBe(true);
      expect(instantEvalPagesBySpan(["ThreadId", "OccurredAt"])).toBe(false);
    });
  });

  describe("when the first page's key pass is composed", () => {
    /** @scenario "A statement with one row per span pages by the trace and the span" */
    it("orders by the trace and the span together", () => {
      const sql = instantEvalKeyPassSql({
        sql: SQL,
        keyColumns: ["SpanId"],
        limit: 501,
        hasCursor: false,
      });

      expect(sql).toContain("ORDER BY (q.TraceId, q.SpanId)");
      expect(sql).toContain(SQL);
      // No cursor predicate of its own on the first page; the WHERE the text
      // does hold is the caller's, inside the subquery.
      expect(sql).not.toContain("WHERE (q.TraceId");
    });
  });

  describe("when a later page's key pass is composed", () => {
    /** @scenario "A statement with one row per span pages by the trace and the span" */
    it("compares the pair against both halves of the cursor", () => {
      const sql = instantEvalKeyPassSql({
        sql: SQL,
        keyColumns: ["SpanId"],
        limit: 501,
        hasCursor: true,
      });

      expect(sql).toContain(
        `WHERE (q.TraceId, q.SpanId) > ({${INSTANT_EVAL_AFTER_PARAMETER}:String}, {${INSTANT_EVAL_AFTER_SPAN_PARAMETER}:String})`,
      );
    });
  });

  describe("when the statement projects no span id", () => {
    it("compares the trace alone, so no span parameter is bound", () => {
      const sql = instantEvalKeyPassSql({
        sql: SQL,
        keyColumns: ["ThreadId"],
        limit: 501,
        hasCursor: true,
      });

      expect(sql).toContain(
        `WHERE q.TraceId > {${INSTANT_EVAL_AFTER_PARAMETER}:String}`,
      );
      expect(sql).not.toContain(INSTANT_EVAL_AFTER_SPAN_PARAMETER);
    });
  });

  describe("when the span cursor parameter is named by a caller", () => {
    /** @scenario "A request supplying a reserved run parameter is refused" */
    it("is reserved like the other two", () => {
      expect(
        isInstantEvalReservedParameter(INSTANT_EVAL_AFTER_SPAN_PARAMETER),
      ).toBe(true);
    });
  });
});

describe("given a run about to learn its size", () => {
  describe("when the count is composed", () => {
    /** @scenario "The run's total comes from a count rather than from every key" */
    it("counts inside the database, bounded one past the limit", () => {
      const sql = instantEvalCountSql({ sql: SQL, limit: 10_001 });

      // One row comes back whatever the selection's size, which is what keeps
      // the total off the executor's byte ceiling; the inner LIMIT keeps a
      // ten-million-row selection from being scanned to its end.
      expect(sql).toContain("SELECT count() AS total");
      expect(sql).toContain("LIMIT 10001");
      expect(sql).toContain(SQL);
    });
  });
});
