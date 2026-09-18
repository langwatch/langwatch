/**
 * What the run wraps around the caller's statement, and what it refuses.
 *
 * The one thing every case here asserts is the same: the caller's text appears
 * inside the wrapper character for character.
 *
 * @see ../composition.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-pipeline.feature
 */

import { describe, expect, it } from "vitest";

import {
  INSTANT_EVAL_AFTER_PARAMETER,
  INSTANT_EVAL_PAGE_PARAMETER,
  instantEvalKeyPassSql,
  instantEvalPagePassSql,
  instantEvalProbeSql,
  isInstantEvalReservedParameter,
} from "../composition";

const SQL = `SELECT ConversationId, eval(conversation_bounded(ConversationId, 8000, ''), 'annoyed') AS annoyed
FROM analytics.trace_metrics
WHERE OccurredAt >= subtractDays(now(), 7)
GROUP BY ConversationId`;

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
      const sql = instantEvalKeyPassSql({
        sql: SQL,
        keyColumns: ["ThreadId", "OccurredAt"],
        limit: 500,
        hasCursor: false,
      });

      expect(sql).toContain(
        "SELECT q.TraceId AS TraceId, q.ThreadId AS ThreadId, q.OccurredAt AS OccurredAt",
      );
      expect(sql).not.toContain("SpanId");
    });

    /** @scenario "Pass one selects the keys and nothing else" */
    it("keeps the caller's own text unchanged inside it", () => {
      expect(
        instantEvalKeyPassSql({
          sql: SQL,
          keyColumns: [],
          limit: 10,
          hasCursor: false,
        }),
      ).toContain(SQL);
    });

    it("orders by the trace id, which is the one column a run requires", () => {
      expect(
        instantEvalKeyPassSql({
          sql: SQL,
          keyColumns: [],
          limit: 10,
          hasCursor: false,
        }),
      ).toContain("ORDER BY q.TraceId");
    });

    it("carries no cursor predicate on the first page", () => {
      expect(
        instantEvalKeyPassSql({
          sql: SQL,
          keyColumns: [],
          limit: 10,
          hasCursor: false,
        }),
      ).not.toContain(INSTANT_EVAL_AFTER_PARAMETER);
    });

    it("starts after the previous page's last id on a later page", () => {
      expect(
        instantEvalKeyPassSql({
          sql: SQL,
          keyColumns: [],
          limit: 10,
          hasCursor: true,
        }),
      ).toContain(`WHERE q.TraceId > {${INSTANT_EVAL_AFTER_PARAMETER}:String}`);
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

describe("given a parameter name", () => {
  describe("when the run is asked whether it owns it", () => {
    it("owns the page and cursor parameters", () => {
      expect(isInstantEvalReservedParameter(INSTANT_EVAL_PAGE_PARAMETER)).toBe(
        true,
      );
      expect(isInstantEvalReservedParameter(INSTANT_EVAL_AFTER_PARAMETER)).toBe(
        true,
      );
    });

    it("owns nothing else", () => {
      expect(isInstantEvalReservedParameter("customer_id")).toBe(false);
      expect(
        isInstantEvalReservedParameter("dashboard_context_period_start"),
      ).toBe(false);
    });
  });
});
