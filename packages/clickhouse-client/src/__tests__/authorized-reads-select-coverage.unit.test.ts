/**
 * ADR-201 v1.19: every select that reads a table carries a tenant marker in its own WHERE, and no
 * alias takes a name the fence reads, so neither a second select nor a shadowing alias reads past
 * the fence. Spec: specs/governance/aggregate-project.feature
 */
import {
  TENANT_SCOPE_TIME_COLUMNS,
  tenantScope,
  tenantScopeWithConditions,
  tenantSet,
} from "@langwatch/clickhouse-markers";
import { describe, expect, it } from "vitest";

import { expandFragment, expandStatement, FENCE_READ_NAMES } from "../authorized-reads.ts";
import { StatementScopeError, type StatementScopeViolation } from "../statementScopeError.ts";

const FENCE = { own: ["proj_reader"], shared: [] };
const C = tenantScopeWithConditions("StartTime");
const SPANS = `SELECT SpanId FROM stored_spans WHERE ${C}`;

function violationOf(render: () => unknown): StatementScopeViolation | undefined {
  try {
    render();
    return undefined;
  } catch (error) {
    if (error instanceof StatementScopeError) return error.violation;
    throw error;
  }
}

const statementViolation = (query: string) =>
  violationOf(() => expandStatement({ query, queryParams: { s: "x" }, fence: FENCE }));

describe("a select reading a table", () => {
  describe("when it carries no tenant marker of its own", () => {
    const unfenced: (readonly [string, string, string])[] = [
      [
        "a UNION arm",
        `${SPANS} UNION ALL SELECT SpanId FROM stored_spans WHERE 1 = 1`,
        "no-marker",
      ],
      [
        "a scalar subquery in the SELECT list",
        `SELECT SpanId, (SELECT any(SpanName) FROM stored_spans WHERE SpanId = {s:String}) AS n` +
          ` FROM stored_spans WHERE ${C}`,
        "no-marker",
      ],
      [
        "a nested select in the WHERE",
        `${SPANS} AND TraceId IN (SELECT TraceId FROM trace_summaries WHERE 1 = 1)`,
        "no-marker",
      ],
      [
        "an arm bounded by an id alone",
        `${SPANS} UNION ALL SELECT SpanId FROM stored_spans WHERE {{idBound:stored_spans.SpanId:s}}`,
        "no-marker",
      ],
      [
        "a CTE declared inside a subquery",
        `${SPANS} AND TraceId IN (WITH t AS (SELECT TraceId FROM trace_summaries WHERE` +
          ` ${tenantScope("OccurredAt")}) SELECT TraceId FROM t)`,
        "no-marker",
      ],
      [
        "a JOIN to a table",
        `SELECT b.SpanName FROM stored_spans a JOIN stored_spans b ON a.TraceId = b.TraceId WHERE ${C}`,
        "table-join",
      ],
      ["a comma join", `SELECT SpanId FROM stored_spans, trace_summaries WHERE ${C}`, "table-join"],
      ["an IN over a table by name", `${SPANS} AND TraceId IN trace_summaries`, "table-in"],
      ["a table function", `SELECT toString(number) FROM numbers(10) WHERE ${C}`, "table-function"],
      [
        "a table function in a UNION arm",
        `${SPANS} UNION ALL SELECT toString(number) FROM numbers(10)`,
        "table-function",
      ],
    ];

    for (const [name, query, reason] of unfenced) {
      /** @scenario "Every select that reads a table carries a tenant marker of its own" */
      it(`refuses ${name}`, () => {
        expect(statementViolation(query)).toEqual({ kind: "unfenced-select", reason });
      });
    }

    /** @scenario "Every select that reads a table carries a tenant marker of its own" */
    it("refuses a fragment that opens a UNION arm of its own", () => {
      const violation = violationOf(() =>
        expandFragment({
          fragment: `${C} UNION ALL SELECT SpanId FROM stored_spans WHERE 1 = 1`,
          queryParams: {},
          fence: FENCE,
        }),
      );

      expect(violation).toEqual({ kind: "unfenced-select", reason: "no-marker" });
    });
  });

  describe("when every select reading a table is fenced on its own", () => {
    const fenced: (readonly [string, string])[] = [
      ["each UNION arm", `${SPANS} UNION ALL ${SPANS}`],
      ["a scalar subquery", `SELECT SpanId, (${SPANS} LIMIT 1) AS n FROM stored_spans WHERE ${C}`],
      ["a fenced subquery in FROM", `SELECT SpanId FROM (${SPANS})`],
      [
        "a JOIN to a fenced subquery",
        `SELECT a.SpanId FROM stored_spans a JOIN (SELECT TraceId FROM trace_summaries WHERE` +
          ` ${tenantSet()}) b ON a.TraceId = b.TraceId WHERE ${C}`,
      ],
      [
        "the statement's own CTE",
        `WITH t AS (SELECT TraceId FROM trace_summaries WHERE ${tenantScope("OccurredAt")})` +
          ` ${SPANS} AND TraceId IN (SELECT TraceId FROM t)`,
      ],
      ["a select with no FROM", `${SPANS} AND 1 IN (SELECT 1)`],
      ["a FROM inside trim", `SELECT trim(BOTH '"' FROM SpanName) FROM stored_spans WHERE ${C}`],
      [
        "an ARRAY JOIN with its own alias",
        `SELECT key FROM stored_spans ARRAY JOIN mapKeys(SpanAttributes) AS key WHERE ${C}`,
      ],
    ];

    for (const [name, query] of fenced) {
      /** @scenario "Every select that reads a table carries a tenant marker of its own" */
      it(`renders ${name}`, () => {
        expect(statementViolation(query)).toBeUndefined();
      });
    }
  });
});

describe("an alias", () => {
  describe("when it takes a name the fence reads", () => {
    const shadows: (readonly [string, string])[] = [
      ["a SELECT-list alias", `SELECT SpanId, 'proj_reader' AS TenantId FROM stored_spans`],
      [
        "a map alias",
        `SELECT SpanId, map('orchestrator', 'web') AS SpanAttributes FROM stored_spans`,
      ],
      ["a WITH alias", `WITH 'proj_reader' AS TenantId SELECT SpanId FROM stored_spans`],
      ["an alias with no AS", `SELECT SpanId, 'proj_reader' TenantId FROM stored_spans`],
      ["a column renamed with no AS", `SELECT SpanId, SpanId TenantId FROM stored_spans`],
      ["a backquoted alias", "SELECT SpanId, 'x' AS `TenantId` FROM stored_spans"],
      ["a double-quoted alias", `SELECT SpanId, 'x' AS "SpanName" FROM stored_spans`],
      ["an alias in another case", `SELECT SpanId, 'x' as tenantid FROM stored_spans`],
      ["an alias a parameter names", `SELECT SpanId, 'x' AS {a:Identifier} FROM stored_spans`],
      ["an ARRAY JOIN alias", `SELECT SpanId FROM stored_spans ARRAY JOIN ['x'] AS TenantId`],
      [
        "an alias outside the fenced subquery",
        `SELECT map('orchestrator', 'web') AS SpanAttributes FROM (SELECT SpanId FROM stored_spans` +
          ` WHERE ${C})`,
      ],
      [
        "a CTE named like the span table",
        `WITH stored_spans AS (SELECT SpanId FROM trace_summaries WHERE ${C}) SELECT SpanId FROM` +
          " stored_spans",
      ],
    ];

    for (const [name, head] of shadows) {
      /** @scenario "No alias takes a name the fence reads" */
      it(`refuses ${name}`, () => {
        const query = head.includes("WHERE") ? head : `${head} WHERE ${C}`;

        expect(statementViolation(query)?.kind).toBe("shadowing-alias");
      });
    }

    const columns = [...TENANT_SCOPE_TIME_COLUMNS, "UpdatedAt", "TraceId", "ResourceAttributes"];
    for (const column of columns) {
      /** @scenario "No alias takes a name the fence reads" */
      it(`refuses an alias named ${column}`, () => {
        const query = `SELECT SpanId, now() AS ${column} FROM stored_spans WHERE ${C}`;

        expect(statementViolation(query)).toEqual({ kind: "shadowing-alias", name: column });
      });
    }
  });

  describe("when it takes a name the fence does not read", () => {
    /** @scenario "No alias takes a name the fence reads" */
    it("renders the alias, a qualified column and a cast", () => {
      const query =
        `SELECT SpanId AS id, toUnixTimestamp64Milli(StartTime) AS startedMs, s.TenantId,` +
        ` CAST(SpanName AS String) FROM stored_spans AS s WHERE ${C}`;

      expect(statementViolation(query)).toBeUndefined();
    });
  });

  describe("given the names the fence reads", () => {
    /** @scenario "No alias takes a name the fence reads" */
    it("holds every column a marker, an election or a braid condition reads", () => {
      const expected = [
        "TenantId",
        "TraceId",
        "SpanId",
        "UpdatedAt",
        "SpanName",
        "SpanAttributes",
        "ResourceAttributes",
        "stored_spans",
        ...TENANT_SCOPE_TIME_COLUMNS,
      ].map((name) => name.toLowerCase());

      expect([...FENCE_READ_NAMES].toSorted()).toEqual([...new Set(expected)].toSorted());
    });
  });
});

describe("a statement naming a setting the reader pins", () => {
  /** @scenario "A column always wins over an alias of its name" */
  it("is refused", () => {
    const query = `${SPANS} SETTINGS prefer_column_name_to_alias = 0`;

    expect(statementViolation(query)).toEqual({
      kind: "pinned-setting",
      setting: "prefer_column_name_to_alias",
    });
  });
});
