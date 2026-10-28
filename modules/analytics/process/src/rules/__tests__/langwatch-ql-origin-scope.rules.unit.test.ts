/**
 * The origin scope a surface asks for: every catalogued view a statement reads is replaced by
 * that view minus the traces of the origins left out, and nothing else in the statement moves.
 * @see modules/analytics/adrs/003-lwql-origin-scope.md
 */
import { TRACE_SOURCES } from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import { scopeLangWatchQL } from "../langwatch-ql-query-scope.rules.ts";
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
  leftOut = ["langy"],
  timeWindow,
}: {
  sql: string;
  /** The origins the run leaves out, sent as the sources left in. */
  leftOut?: readonly string[];
  timeWindow?: { start: string; end: string };
}): string {
  return scopeLangWatchQL({
    sql,
    ...(leftOut.length > 0
      ? { sources: TRACE_SOURCES.filter((source) => !leftOut.includes(source)) }
      : {}),
    database: "analytics",
    views: LWQL_VIEW_CATALOG,
    ...(timeWindow ? { timeWindow } : {}),
  });
}

describe("scopeLangWatchQL", () => {
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

    it("names every origin left out", () => {
      const scoped = scope({ sql: "SELECT count() FROM spans", leftOut: ["langy", "gateway"] });

      expect(scoped).toContain("IN ('gateway', 'langy')");
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
    /** @scenario "AC193 Sources: a run whose sources hold every origin reads every trace, Langy's included" */
    it("runs the statement as written, so every view reads Langy's conversations too", () => {
      const sql = "SELECT count() FROM traces JOIN spans USING TraceId";

      expect(scope({ sql, leftOut: [], timeWindow: WINDOW })).toBe(sql);
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

    /** @scenario "A WITH name spelt like a narrowed view is refused" */
    it("reads a WITH named like a view as the WITH, since only member windows refuse it", () => {
      const sql = "WITH traces AS (SELECT 1 AS n) SELECT n FROM traces";

      expect(scope({ sql })).toBe(sql);
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

describe("given a widget counting Langy's turns by name, which the gateway stores", () => {
  const TURNS = "SELECT count() FROM traces WHERE TraceName = 'langy.turn'";

  /** @scenario "AC201 Widget data: a query whose sources hold langy reads Langy's turns, the gateway-stored ones included" */
  it("runs the statement as written when no origin is left out: the server adds no default", () => {
    expect(scope({ sql: TURNS, leftOut: [], timeWindow: WINDOW })).toBe(TURNS);
  });

  /** @scenario "AC201b Widget data: a query left at the default leaves Langy's turns out" */
  it("drops Langy's traces by their origin, whatever source stored them, when langy is left out", () => {
    expect(scope({ sql: TURNS, timeWindow: WINDOW })).toBe(
      `SELECT count() FROM (SELECT * FROM traces WHERE ${notALangyTrace(LOOKUP_BOUND)}) AS traces ` +
        "WHERE TraceName = 'langy.turn'",
    );
  });
});

describe("given a dashboard query's sources", () => {
  const ORIGIN = "ifNull(nullIf(Origin, ''), 'application')";
  const scoped = (sources: Parameters<typeof scopeLangWatchQL>[0]["sources"], sql: string) =>
    scopeLangWatchQL({
      sql,
      sources,
      database: "analytics",
      views: LWQL_VIEW_CATALOG,
    });

  /** @scenario "AC200b Sources: a query saved with picked sources counts only traces of those origins" */
  it("keeps only the picked origins", () => {
    expect(scoped(["application", "langy"], "SELECT count() FROM trace_metrics")).toBe(
      "SELECT count() FROM (SELECT * FROM trace_metrics " +
        `WHERE ${ORIGIN} IN ('application', 'langy')) AS trace_metrics`,
    );
    expect(scoped(["langy"], "SELECT count() FROM spans")).toBe(
      "SELECT count() FROM (SELECT * FROM spans WHERE ifNull(TraceId, '') NOT IN " +
        `(SELECT TraceId FROM analytics.trace_metrics WHERE ${ORIGIN} NOT IN ('langy'))) AS spans`,
    );
  });

  /** @scenario "AC200l Sources: other counts every origin outside the eight known ones" */
  it("with other picked, drops only the known origins left unpicked", () => {
    expect(scoped(["application", "other"], "SELECT count() FROM trace_metrics")).toBe(
      `SELECT count() FROM (SELECT * FROM trace_metrics WHERE ${ORIGIN} NOT IN ` +
        "('simulation', 'evaluation', 'coding_agent', 'gateway', 'workflow', 'playground', " +
        "'langy')) AS trace_metrics",
    );
  });

  it("runs the statement as written when every source is picked", () => {
    const sql = "SELECT count() FROM trace_metrics";
    expect(
      scoped(
        [
          "application",
          "simulation",
          "evaluation",
          "coding_agent",
          "gateway",
          "workflow",
          "playground",
          "langy",
          "other",
        ],
        sql,
      ),
    ).toBe(sql);
  });

  /** @scenario "AC200f Sources: a query that stores none counts application traces" */
  it("reads a widget query storing none (null) as the default, application, on the server", () => {
    expect(scoped(null, "SELECT count() FROM trace_metrics")).toBe(
      `SELECT count() FROM (SELECT * FROM trace_metrics WHERE ${ORIGIN} IN ('application')) AS trace_metrics`,
    );
    expect(scoped(null, "SELECT count() FROM trace_metrics")).toBe(
      scoped(["application"], "SELECT count() FROM trace_metrics"),
    );
  });

  /** @scenario "AC200m Sources: a query with no source picked counts nothing and says so" */
  it("reads no row of any view when none is picked", () => {
    expect(scoped([], "SELECT count() FROM trace_metrics")).toBe(
      "SELECT count() FROM (SELECT * FROM trace_metrics WHERE 0) AS trace_metrics",
    );
  });
});
