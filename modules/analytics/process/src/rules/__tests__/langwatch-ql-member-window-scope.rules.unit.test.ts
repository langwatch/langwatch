/**
 * An aggregate's statement is kept to its members inside their grants' windows: the row policy
 * bounds the tenants, this rewrite bounds when each member is read from.
 * @see specs/lwql/aggregate-reads.feature
 */
import {
  type LangWatchQLMemberWindow,
  LangWatchQLShadowedViewError,
  LangWatchQLTableModifierError,
} from "@langwatch/analytics-contract";
import { describe, expect, it } from "vitest";

import type { LangWatchQLViewDefinition } from "../../services/langwatch-ql-catalog-shapes.service.ts";
import { hydratableProjects, scopeLangWatchQL } from "../langwatch-ql-query-scope.rules.ts";
import { LWQL_VIEW_CATALOG } from "../lwql-view-catalog.rules.ts";

const SHARED_FROM = Date.parse("2026-03-01T00:00:00.000Z");
const WHOLE_A: LangWatchQLMemberWindow = { projectId: "project_a", from: 0 };
const DATED_B: LangWatchQLMemberWindow = { projectId: "project_b", from: SHARED_FROM };

const traces = LWQL_VIEW_CATALOG.find((view) => view.name === "traces");
if (!traces) throw new Error("the catalogue has no traces view");
const { timeColumn: _dropped, ...tracesWithoutTime } = traces;
const UNDATED: LangWatchQLViewDefinition = { ...tracesWithoutTime, name: "undated" };
const UNTENANTED: LangWatchQLViewDefinition = {
  ...traces,
  name: "untenanted",
  columns: traces.columns.filter((column) => column.name !== "TenantId"),
};
const VIEWS = [...LWQL_VIEW_CATALOG, UNDATED, UNTENANTED];

const B_FROM = `(TenantId = 'project_b' AND OccurredAt >= fromUnixTimestamp64Milli(toInt64(${SHARED_FROM})))`;
const MEMBERS = `(TenantId IN ('project_a') OR ${B_FROM})`;

function scope({
  sql,
  memberWindows,
  excludeOrigins = [],
  timeWindow,
}: {
  sql: string;
  memberWindows?: readonly LangWatchQLMemberWindow[];
  excludeOrigins?: readonly string[];
  timeWindow?: { start: string; end: string };
}): string {
  return scopeLangWatchQL({
    sql,
    excludeOrigins,
    database: "analytics",
    views: VIEWS,
    ...(memberWindows ? { memberWindows } : {}),
    ...(timeWindow ? { timeWindow } : {}),
  });
}

function captureRefusal(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected the rewrite to refuse");
}

describe("scopeLangWatchQL with member windows", () => {
  describe("given a member shared from a point in time", () => {
    /** @scenario "Every view the statement reads is narrowed to each member's window" */
    it("keeps whole-history members outright and the dated member from its start", () => {
      expect(scope({ sql: "SELECT count() FROM traces", memberWindows: [WHOLE_A, DATED_B] })).toBe(
        `SELECT count() FROM (SELECT * FROM traces WHERE ${MEMBERS}) AS traces`,
      );
    });

    /** @scenario "A view joined to itself is narrowed on both sides" */
    it("narrows every reference to the same view", () => {
      const scoped = scope({
        sql: "SELECT count() FROM traces AS a JOIN traces AS b ON a.TraceId = b.TraceId",
        memberWindows: [WHOLE_A, DATED_B],
      });

      expect(scoped).toBe(
        `SELECT count() FROM (SELECT * FROM traces WHERE ${MEMBERS}) AS a ` +
          `JOIN (SELECT * FROM traces WHERE ${MEMBERS}) AS b ON a.TraceId = b.TraceId`,
      );
    });

    it("narrows a view read inside a WITH body", () => {
      const scoped = scope({
        sql: "WITH t AS (SELECT TraceId FROM traces) SELECT count() FROM t",
        memberWindows: [WHOLE_A, DATED_B],
      });

      expect(scoped).toBe(
        `WITH t AS (SELECT TraceId FROM (SELECT * FROM traces WHERE ${MEMBERS}) AS traces) ` +
          "SELECT count() FROM t",
      );
    });

    /** @scenario "A view with no time column reads only members shared for their whole history" */
    it("keeps only whole-history members on a view with no time column", () => {
      expect(scope({ sql: "SELECT count() FROM undated", memberWindows: [WHOLE_A, DATED_B] })).toBe(
        "SELECT count() FROM (SELECT * FROM undated WHERE (TenantId IN ('project_a'))) AS undated",
      );
    });

    it("reads nothing from a view with no time column when every member is dated", () => {
      expect(scope({ sql: "SELECT count() FROM undated", memberWindows: [DATED_B] })).toBe(
        "SELECT count() FROM (SELECT * FROM undated WHERE 0) AS undated",
      );
    });

    it("reads nothing from a view that names no tenant", () => {
      expect(
        scope({ sql: "SELECT count() FROM untenanted", memberWindows: [WHOLE_A, DATED_B] }),
      ).toBe("SELECT count() FROM (SELECT * FROM untenanted WHERE 0) AS untenanted");
    });

    it("reads nothing from a view outside the catalogue", () => {
      expect(
        scope({ sql: "SELECT count() FROM analytics.unknown", memberWindows: [DATED_B] }),
      ).toBe("SELECT count() FROM (SELECT * FROM analytics.unknown WHERE 0) AS unknown");
    });

    it("adds the window after the origins left out, on the same reference", () => {
      const scoped = scope({
        sql: "SELECT count() FROM trace_metrics",
        memberWindows: [WHOLE_A, DATED_B],
        excludeOrigins: ["langy"],
      });

      expect(scoped).toBe(
        "SELECT count() FROM (SELECT * FROM trace_metrics WHERE " +
          "ifNull(nullIf(Origin, ''), 'application') NOT IN ('langy') AND " +
          `(TenantId IN ('project_a') OR (TenantId = 'project_b' AND ` +
          `OccurredAt >= fromUnixTimestamp64Milli(toInt64(${SHARED_FROM}))))) AS trace_metrics`,
      );
    });

    it("escapes a member id as a literal", () => {
      const scoped = scope({
        sql: "SELECT count() FROM traces",
        memberWindows: [{ projectId: "o'x", from: SHARED_FROM }],
      });

      expect(scoped).toContain("TenantId = 'o\\'x'");
    });

    /** @scenario "FINAL or SAMPLE on a narrowed view is refused with a clear message" */
    it.each([
      ["FINAL", "SELECT count() FROM traces FINAL"],
      ["SAMPLE", "SELECT count() FROM traces AS t SAMPLE 0.5"],
    ])("refuses %s instead of sending a statement the store rejects", (modifier, sql) => {
      const refusal = captureRefusal(() => scope({ sql, memberWindows: [WHOLE_A, DATED_B] }));

      expect(refusal).toBeInstanceOf(LangWatchQLTableModifierError);
      expect((refusal as LangWatchQLTableModifierError).meta).toEqual({ modifiers: [modifier] });
    });

    /** @scenario "A WITH name spelt like a narrowed view is refused" */
    it.each([
      [
        "declared in a subquery the outer view sits beside",
        "SELECT count() FROM traces WHERE 1 IN (WITH traces AS (SELECT 1 AS n) SELECT n FROM traces)",
      ],
      [
        "declared in one branch of a UNION",
        "SELECT count() FROM traces UNION ALL (WITH traces AS (SELECT 1 AS n) SELECT n FROM traces)",
      ],
      ["spelt in another case", "WITH Traces AS (SELECT 1 AS n) SELECT count() FROM traces"],
    ])("refuses a WITH name %s, which would hide the view from the window", (_case, sql) => {
      const refusal = captureRefusal(() => scope({ sql, memberWindows: [WHOLE_A, DATED_B] }));

      expect(refusal).toBeInstanceOf(LangWatchQLShadowedViewError);
      expect((refusal as LangWatchQLShadowedViewError).meta).toEqual({ names: ["traces"] });
    });

    it("narrows the outer view beside a nested WITH whose name is no view's", () => {
      const scoped = scope({
        sql: "SELECT count() FROM traces WHERE 1 IN (WITH t AS (SELECT 1 AS n) SELECT n FROM t)",
        memberWindows: [WHOLE_A, DATED_B],
      });

      expect(scoped).toBe(
        `SELECT count() FROM (SELECT * FROM traces WHERE ${MEMBERS}) AS traces ` +
          "WHERE 1 IN (WITH t AS (SELECT 1 AS n) SELECT n FROM t)",
      );
    });
  });

  describe("given a dated member's evaluations", () => {
    const traceInside = (bound = "") =>
      "(ifNull(TraceId, '') = '' OR (TenantId, TraceId) IN (SELECT TenantId, TraceId " +
      "FROM analytics.traces WHERE TenantId = 'project_b' " +
      `AND OccurredAt >= fromUnixTimestamp64Milli(toInt64(${SHARED_FROM}))${bound}))`;

    /** @scenario "The aggregate counts a member's evaluations by when their trace occurred" */
    it("reads an evaluation only when its trace is inside the window", () => {
      expect(
        scope({ sql: "SELECT count() FROM evaluations", memberWindows: [WHOLE_A, DATED_B] }),
      ).toBe(
        "SELECT count() FROM (SELECT * FROM evaluations WHERE (TenantId IN ('project_a') OR " +
          "(TenantId = 'project_b' AND " +
          `ScheduledAt >= fromUnixTimestamp64Milli(toInt64(${SHARED_FROM})) AND ${traceInside()}))) ` +
          "AS evaluations",
      );
    });

    it("bounds the trace lookup by the statement's period, as the origin lookup is bounded", () => {
      const windowStart = "toDateTime('2026-03-10 00:00:00', 'UTC')";
      const windowEnd = "toDateTime('2026-03-13 00:00:00', 'UTC')";
      const lookupBound =
        ` AND OccurredAt >= subtractDays(subtractSeconds(${windowStart}, ` +
        `dateDiff('second', ${windowStart}, ${windowEnd})), 1)`;

      expect(
        scope({
          sql: "SELECT count() FROM evaluations",
          memberWindows: [DATED_B],
          timeWindow: { start: "2026-03-10T00:00:00.000Z", end: "2026-03-13T00:00:00.000Z" },
        }),
      ).toBe(
        "SELECT count() FROM (SELECT * FROM evaluations WHERE ((TenantId = 'project_b' AND " +
          `ScheduledAt >= fromUnixTimestamp64Milli(toInt64(${SHARED_FROM})) AND ` +
          `${traceInside(lookupBound)}))) AS evaluations`,
      );
    });

    it("reads no dated member from the per-minute evaluation rollup, which names no trace", () => {
      expect(
        scope({
          sql: "SELECT sum(EvalCount) FROM evaluation_metrics_by_minute",
          memberWindows: [WHOLE_A, DATED_B],
        }),
      ).toBe(
        "SELECT sum(EvalCount) FROM (SELECT * FROM evaluation_metrics_by_minute " +
          "WHERE (TenantId IN ('project_a'))) AS evaluation_metrics_by_minute",
      );
    });

    it("reads no dated member's evaluations when the traces view is out of reach", () => {
      const scoped = scopeLangWatchQL({
        sql: "SELECT count() FROM evaluations",
        excludeOrigins: [],
        database: "analytics",
        views: VIEWS.filter((view) => view.name !== "traces"),
        memberWindows: [WHOLE_A, DATED_B],
      });

      expect(scoped).toBe(
        "SELECT count() FROM (SELECT * FROM evaluations WHERE (TenantId IN ('project_a'))) " +
          "AS evaluations",
      );
    });

    it("keeps a trace view's window on the trace's own time", () => {
      expect(scope({ sql: "SELECT count() FROM traces", memberWindows: [DATED_B] })).toBe(
        `SELECT count() FROM (SELECT * FROM traces WHERE (${B_FROM})) AS traces`,
      );
    });
  });

  describe("given members all shared for their whole history", () => {
    it("runs the statement as written, since the row policy bounds them exactly", () => {
      const sql = "SELECT count() FROM traces";

      expect(scope({ sql, memberWindows: [WHOLE_A] })).toBe(sql);
    });

    it("leaves FINAL in place, since the statement is not rewritten", () => {
      const sql = "SELECT count() FROM traces FINAL";

      expect(scope({ sql, memberWindows: [WHOLE_A] })).toBe(sql);
    });
  });

  describe("given a plain project", () => {
    /** @scenario "A plain project's statement is left as written" */
    it("runs the statement as written", () => {
      const sql = "SELECT count() FROM traces JOIN spans USING TraceId";

      expect(scope({ sql })).toBe(sql);
    });
  });
});

describe("hydratableProjects", () => {
  const A = { id: "project_a", lwqlKey: "key_a" };
  const B = { id: "project_b", lwqlKey: "key_b" };

  /** @scenario "App functions read text only from members shared for their whole history" */
  it("reads text from whole-history members only on an aggregate", () => {
    expect(hydratableProjects({ projects: [A, B], memberWindows: [WHOLE_A, DATED_B] })).toEqual([
      A,
    ]);
  });

  it("reads text from every project of a plain run", () => {
    expect(hydratableProjects({ projects: [A, B], memberWindows: undefined })).toEqual([A, B]);
  });
});
