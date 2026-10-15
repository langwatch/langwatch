/**
 * The origin scope a surface asks for: every catalogued view a statement reads is replaced by
 * that view minus the traces of the origins left out, and nothing else in the statement moves.
 * @see modules/analytics/adrs/003-lwql-origin-scope.md
 */
import { describe, expect, it } from "vitest";

import { scopeLangWatchQLToOrigins } from "../langwatch-ql-query-scope.rules.ts";
import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";

const WINDOW = { start: "2026-02-01T00:00:00.000Z", end: "2026-02-04T00:00:00.000Z" };
const NOT_LANGY = "ifNull(nullIf(Origin, ''), 'application') NOT IN ('langy')";
const LANGY_TRACES =
  "SELECT TraceId FROM analytics.trace_metrics " +
  "WHERE ifNull(nullIf(Origin, ''), 'application') IN ('langy')";
const WINDOW_START = "toDateTime('2026-02-01 00:00:00', 'UTC')";
const WINDOW_END = "toDateTime('2026-02-04 00:00:00', 'UTC')";
const LOOKUP_BOUND =
  ` AND OccurredAt >= subtractDays(subtractSeconds(${WINDOW_START}, ` +
  `dateDiff('second', ${WINDOW_START}, ${WINDOW_END})), 1)`;
const notALangyTrace = (bound = "") => `ifNull(TraceId, '') NOT IN (${LANGY_TRACES}${bound})`;

function scope({
  sql,
  excludeOrigins = ["langy"],
  timeWindow,
}: {
  sql: string;
  excludeOrigins?: readonly string[];
  timeWindow?: { start: string; end: string };
}): string {
  return scopeLangWatchQLToOrigins({
    sql,
    excludeOrigins,
    database: "analytics",
    views: LWQL_VIEW_CATALOG,
    ...(timeWindow ? { timeWindow } : {}),
  });
}

describe("scopeLangWatchQLToOrigins", () => {
  describe("given a view that carries each row's origin", () => {
    it("reads the view minus the rows of the origins left out", () => {
      expect(scope({ sql: "SELECT count() FROM trace_metrics" })).toBe(
        `SELECT count() FROM (SELECT * FROM trace_metrics WHERE ${NOT_LANGY}) AS trace_metrics`,
      );
    });

    it("scopes evaluation_metrics on its own origin too", () => {
      expect(scope({ sql: "SELECT count() FROM analytics.evaluation_metrics AS e" })).toBe(
        `SELECT count() FROM (SELECT * FROM analytics.evaluation_metrics WHERE ${NOT_LANGY}) AS e`,
      );
    });

    /** @scenario "AC191 Langy: a widget's own origin filter keeps its meaning" */
    it("leaves the widget's own Origin filter as written, outside the scoped view", () => {
      const own = "WHERE Origin IN ('', 'application', 'gateway') GROUP BY Origin";

      const scoped = scope({ sql: `SELECT Origin, sum(TotalCost) FROM trace_metrics ${own}` });

      expect(scoped).toBe(
        "SELECT Origin, sum(TotalCost) FROM " +
          `(SELECT * FROM trace_metrics WHERE ${NOT_LANGY}) AS trace_metrics ${own}`,
      );
    });
  });

  describe("given a view that only names the trace a row belongs to", () => {
    it("leaves out the rows of the traces trace_metrics gives those origins", () => {
      expect(scope({ sql: "SELECT count() FROM spans" })).toBe(
        `SELECT count() FROM (SELECT * FROM spans WHERE ${notALangyTrace()}) AS spans`,
      );
    });

    it("bounds the trace lookup one window and one day before the window it is given", () => {
      expect(scope({ sql: "SELECT count() FROM traces", timeWindow: WINDOW })).toBe(
        `SELECT count() FROM (SELECT * FROM traces WHERE ${notALangyTrace(LOOKUP_BOUND)}) AS traces`,
      );
    });

    it("names every origin left out, escaped as a literal", () => {
      const scoped = scope({ sql: "SELECT count() FROM spans", excludeOrigins: ["langy", "o'x"] });

      expect(scoped).toContain("IN ('langy', 'o\\'x')");
    });
  });

  describe("given a view that can tell no origin", () => {
    /** @scenario "AC192 Langy: data that is Langy's own is not filtered" */
    it("runs a statement over Langy's usage events or conversation messages as written", () => {
      const statements = ["langy_usage_events", "langy_conversation_messages"].map(
        (view) => `SELECT count() FROM ${view}`,
      );

      expect(statements.map((sql) => scope({ sql, timeWindow: WINDOW }))).toEqual(statements);
    });

    /** @scenario "AC195 Langy: per-minute rollups cannot leave Langy out yet" */
    it("runs a statement over a per-minute rollup as written, Langy's spans included", () => {
      const statements = ["trace_metrics_by_minute", "model_usage_by_minute"].map(
        (view) => `SELECT count() FROM analytics.${view}`,
      );

      expect(statements.map((sql) => scope({ sql, timeWindow: WINDOW }))).toEqual(statements);
    });
  });

  describe("given no origin to leave out", () => {
    /** @scenario "AC193 Langy: the origins a board leaves out are a list a board parameter can set later" */
    it("runs the statement as written, so every view reads Langy's conversations too", () => {
      const sql = "SELECT count() FROM traces JOIN spans USING TraceId";

      expect(scope({ sql, excludeOrigins: [], timeWindow: WINDOW })).toBe(sql);
    });
  });

  describe("given a statement that reads several views", () => {
    it("scopes each reference where it is written and keeps the names its columns go by", () => {
      const scoped = scope({
        sql: "SELECT t.TraceId FROM traces AS t JOIN spans ON spans.TraceId = t.TraceId",
      });

      expect(scoped).toBe(
        `SELECT t.TraceId FROM (SELECT * FROM traces WHERE ${notALangyTrace()}) AS t ` +
          `JOIN (SELECT * FROM spans WHERE ${notALangyTrace()}) AS spans ` +
          "ON spans.TraceId = t.TraceId",
      );
    });

    it("scopes a view read inside a WITH body and leaves the WITH name alone", () => {
      const scoped = scope({
        sql: "WITH costly AS (SELECT TraceId FROM spans WHERE Cost > 0) SELECT count() FROM costly",
      });

      expect(scoped).toBe(
        "WITH costly AS (SELECT TraceId FROM " +
          `(SELECT * FROM spans WHERE ${notALangyTrace()}) AS spans WHERE Cost > 0) ` +
          "SELECT count() FROM costly",
      );
    });

    it("scopes both halves of a UNION ALL", () => {
      const scoped = scope({
        sql:
          "SELECT TotalCost FROM trace_metrics UNION ALL " +
          "SELECT TotalCost FROM evaluation_metrics",
      });

      expect(scoped.split(NOT_LANGY)).toHaveLength(3);
    });
  });
});
