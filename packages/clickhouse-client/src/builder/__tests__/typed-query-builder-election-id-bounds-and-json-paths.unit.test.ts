/**
 * ADR-202, "The typed builder": the latest-version election repeats the read's id bounds on any
 * column of its table, as the raw reads do, and a JSON path element may be a lambda's parameter.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, it } from "vitest";

import { idBoundOf } from "../../idBound.ts";
import { defineIdIndex } from "../../idIndexFlags.ts";
import { column, param } from "../expression.ts";
import { fn } from "../functions.ts";
import { clickhouseRead } from "../read.ts";
import { tenantScope } from "../scope.ts";
import { defineClickHouseTable } from "../table.ts";

const evaluations = defineClickHouseTable({
  name: "evaluation_runs",
  tenantColumn: "TenantId",
  timeColumn: "ScheduledAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "EvaluationId"],
  columns: {
    TenantId: column.string(),
    EvaluationId: column.string(),
    TraceId: column.nullable(column.string()),
    Status: column.string(),
    ScheduledAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});

const runs = defineClickHouseTable({
  name: "simulation_runs",
  tenantColumn: "TenantId",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "ScenarioRunId"],
  columns: {
    TenantId: column.string(),
    ScenarioRunId: column.string(),
    TraceMetricsJson: column.string(),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});

const single = tenantScope.single({ tenantId: "proj_a" });

/** The election's own text: the subquery after the version tuple's `IN`. */
const electionOf = (sql: string) => sql.slice(sql.indexOf("IN (SELECT TenantId, EvaluationId"));

/** The client's own marker parser over the TraceId index, as `read()` runs it at send. */
function lookupOf(statement: { sql: string; params: Readonly<Record<string, unknown>> }) {
  const declaration = defineIdIndex({
    source: "evaluation_runs",
    key: ["TraceId"],
    time: "UpdatedAt",
  });
  const registry = { declarationOf: () => declaration, declarations: () => [declaration] };
  return idBoundOf({ sql: statement.sql, params: { ...statement.params }, registry })?.lookup;
}

describe("given a latest-version read bounded by an id on a column outside the sort key", () => {
  describe("when the id bound is the read's own condition", () => {
    /** @scenario "The latest-version election repeats the read's id bounds on any column of its table" */
    it("repeats the id bound inside the election, naming the outer bound's parameter", () => {
      const statement = clickhouseRead({ scope: single })
        .from(evaluations)
        .latestVersion()
        .select({ EvaluationId: evaluations.EvaluationId })
        .where(({ idBound }) => idBound(evaluations.TraceId, "trace_1"))
        .build();

      const election = electionOf(statement.sql);
      expect(election).toContain("WHERE TenantId = {tenantId:String} AND (TraceId = {v0:String}");
      expect(election).toContain("{{idBound:evaluation_runs.TraceId:v0}}");
      expect(statement.sql.split("{{idBound:").length - 1).toBe(2);
      expect(Object.values(statement.params).filter((value) => value === "trace_1")).toHaveLength(
        1,
      );
      expect(lookupOf(statement)).toBeDefined();
    });
  });

  describe("when the id bound is one term of an AND beside a filter on another column", () => {
    /** @scenario "The latest-version election repeats the read's id bounds on any column of its table" */
    it("repeats the id bound alone, not the other column's filter", () => {
      const statement = clickhouseRead({ scope: single })
        .from(evaluations)
        .latestVersion()
        .select({ EvaluationId: evaluations.EvaluationId })
        .where(({ and, eq, idBound }) =>
          and(idBound(evaluations.TraceId, "trace_1"), eq(evaluations.Status, "processed")),
        )
        .build();

      const election = electionOf(statement.sql);
      expect(election).toContain("{{idBound:evaluation_runs.TraceId:v0}}");
      expect(election).not.toContain("Status");
    });
  });

  describe("when the read filters a column outside the sort key without an id bound", () => {
    /** @scenario "The latest-version election repeats the read's id bounds on any column of its table" */
    it("keeps that filter out of the election, as before", () => {
      const statement = clickhouseRead({ scope: single })
        .from(evaluations)
        .latestVersion()
        .select({ EvaluationId: evaluations.EvaluationId })
        .where(({ eq }) => eq(evaluations.TraceId, "trace_1"))
        .build();

      expect(electionOf(statement.sql)).not.toContain("TraceId");
    });
  });
});

describe("given a JSON read whose path element is an expression", () => {
  describe("when the path element is a lambda's parameter", () => {
    /** @scenario "A JSON path element may be a lambda's parameter, never spliced as text" */
    it("renders the parameter itself and binds only the literal keys", () => {
      const statement = clickhouseRead({ scope: single })
        .from(runs)
        .select({
          Cost: fn.arraySum(
            fn.arrayMap(
              (traceKey) =>
                fn.JSONExtractFloat(
                  fn.JSONExtractRaw(runs.TraceMetricsJson, traceKey),
                  "totalCost",
                ),
              fn.JSONExtractKeys(runs.TraceMetricsJson),
            ),
          ),
        })
        .build();

      const lambda =
        /arrayMap\((\w+) -> JSONExtractFloat\(JSONExtractRaw\(TraceMetricsJson, (\w+)\)/.exec(
          statement.sql,
        );
      expect(lambda?.[2]).toBe(lambda?.[1]);
      expect(Object.values(statement.params)).toEqual(
        expect.arrayContaining(["proj_a", "totalCost"]),
      );
      expect(Object.keys(statement.params)).toHaveLength(2);
    });
  });

  describe("when the path mixes a bound parameter, a key and an index", () => {
    /** @scenario "A JSON path element may be a lambda's parameter, never spliced as text" */
    it("binds the key as a String and the index as an Int64, and the parameter as itself", () => {
      const statement = clickhouseRead({ scope: single })
        .from(runs)
        .select({
          Raw: fn.JSONExtractRaw(runs.TraceMetricsJson, param.string("trace'1"), "spans", 1),
        })
        .build();

      expect(statement.sql).toMatch(
        /JSONExtractRaw\(TraceMetricsJson, \{\w+:String\}, \{\w+:String\}, \{\w+:Int64\}\)/,
      );
      expect(statement.sql).not.toContain("trace'1");
      expect(Object.values(statement.params)).toEqual(
        expect.arrayContaining(["trace'1", "spans", 1]),
      );
    });
  });
});
