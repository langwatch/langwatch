/**
 * An all-tenants read over a derived system read or a system CTE names a system table, while one
 * over bound rows alone still names none; and `cond.never()`, a constant false binding nothing.
 * @see specs/clickhouse/typed-query-builder.feature
 */
import { describe, expect, it } from "vitest";

import { partsMissingColumnsRead } from "../../__tests__/fixtures/system-identity-reads.ts";
import { TENANT_IDS_SETTING } from "../../identity/tenantSetting.ts";
import { boundRows } from "../bound-rows.ts";
import { column, cond, param } from "../expression.ts";
import { fn } from "../functions.ts";
import { QueryBuilderError } from "../query-builder-error.ts";
import { clickhouseRead } from "../read.ts";
import { tenantScope } from "../scope.ts";
import { systemPartsColumns } from "../system-tables.ts";
import { defineClickHouseTable } from "../table.ts";

const spans = defineClickHouseTable({
  name: "stored_spans",
  tenantColumn: "TenantId",
  sortKey: ["TenantId", "SpanId"],
  columns: { TenantId: column.string(), SpanId: column.string() },
});

function violationOf(build: () => unknown): QueryBuilderError["violation"] | undefined {
  try {
    build();
  } catch (error) {
    if (error instanceof QueryBuilderError) return error.violation;
    throw error;
  }
  return undefined;
}

const sweep = () => clickhouseRead({ scope: tenantScope.allTenants({ reason: "a sweep" }) });
const names = () => boundRows({ name: "names", arrays: { Name: param.strings(["a", "b"]) } });

describe("given an all-tenants scope", () => {
  describe("when it counts the rows of a derived system.parts_columns read", () => {
    /** @scenario "An all-tenants read over a derived system read or a system CTE names a system table" */
    it("builds a system statement with no tenant setting, every compared value bound", () => {
      const statement = partsMissingColumnsRead({
        table: "trace_analytics",
        columns: ["MetadataA", "MetadataB"],
      });

      expect(statement.identity).toBe("system");
      expect(statement.kind).toBe("allTenants");
      expect(statement.settings).not.toHaveProperty(TENANT_IDS_SETTING);
      expect(statement.sql).toBe(
        "SELECT toUInt32(count()) AS parts FROM (SELECT name AS PartName FROM system.parts_columns " +
          "WHERE (database = currentDatabase() AND table = {v0:String} AND active = {v1:UInt8}) " +
          "GROUP BY name HAVING countIf(has({v2:Array(String)}, column)) < length({v2:Array(String)})) AS lacking",
      );
      expect(statement.params).toEqual({
        v0: "trace_analytics",
        v1: 1,
        v2: ["MetadataA", "MetadataB"],
      });
    });
  });

  describe("when it reads bound rows beside a CTE over system.parts_columns", () => {
    /** @scenario "An all-tenants read over a derived system read or a system CTE names a system table" */
    it("builds a system statement", () => {
      const rows = names();
      const statement = sweep()
        .from(rows)
        .with("held", (sub) =>
          sub.from(systemPartsColumns).select({ held: systemPartsColumns.column }),
        )
        .select({ Name: rows.Name })
        .where(({ oneOf }) => oneOf(rows.Name, { cte: "held" }))
        .build();

      expect(statement.identity).toBe("system");
      expect(statement.sql).toContain(
        "WITH held AS (SELECT column AS held FROM system.parts_columns)",
      );
    });
  });

  describe("when its derived source reads bound rows alone", () => {
    /** @scenario "An all-tenants read over a derived system read or a system CTE names a system table" */
    it("is refused as naming no tenant table, and so is a CTE over bound rows", () => {
      const read = sweep();
      const inner = names();
      const derived = read.from(inner).select({ Name: inner.Name }).as("picked");
      const outer = names();

      expect(violationOf(() => read.from(derived).select({ n: fn.count() }).build())).toEqual({
        kind: "no-tenant-table",
      });
      expect(
        violationOf(() =>
          sweep()
            .from(outer)
            .with("again", (sub) => {
              const rows = names();
              return sub.from(rows).select({ again: rows.Name });
            })
            .select({ Name: outer.Name })
            .build(),
        ),
      ).toEqual({ kind: "no-tenant-table" });
    });
  });
});

describe("given a single-tenant scope", () => {
  describe("when it derives a read of system.parts_columns", () => {
    /** @scenario "An all-tenants read over a derived system read or a system CTE names a system table" */
    it("is refused at the inner source, so the widening reaches no reader scope", () => {
      const read = clickhouseRead({ scope: tenantScope.single({ tenantId: "project_a" }) });

      expect(
        violationOf(() =>
          // @ts-expect-error a tenant scope reads tenant tables and bound rows only
          read.from(systemPartsColumns),
        ),
      ).toMatchObject({ kind: "table-outside-scope", table: "system.parts_columns" });
    });
  });
});

describe("given cond.never()", () => {
  describe("when it is a read's where, or one branch of an OR", () => {
    /** @scenario "A constant false condition matches no row and binds nothing" */
    it("renders 0 = 1 and binds no parameter", () => {
      const alone = clickhouseRead({ scope: tenantScope.single({ tenantId: "project_a" }) })
        .from(spans)
        .select({ SpanId: spans.SpanId })
        .where(() => cond.never())
        .build();
      const branch = clickhouseRead({ scope: tenantScope.single({ tenantId: "project_a" }) })
        .from(spans)
        .select({ SpanId: spans.SpanId })
        .where(({ or, eq }) => or(eq(spans.SpanId, "s1"), cond.never()))
        .build();

      expect(alone.sql).toBe(
        "SELECT SpanId FROM stored_spans WHERE TenantId = {tenantId:String} AND 0 = 1",
      );
      expect(alone.params).toEqual({ tenantId: "project_a" });
      expect(branch.sql).toContain("(SpanId = {v0:String} OR 0 = 1)");
    });
  });
});
