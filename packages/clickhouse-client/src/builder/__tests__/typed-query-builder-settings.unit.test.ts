/**
 * ADR-202, "The typed builder": a read's own query-level SETTINGS clause. The tenant setting and
 * the pinned settings stay the scope's; a read can neither set nor override them in its text.
 */
import { describe, expect, it } from "vitest";

import { TENANT_IDS_SETTING } from "../../identity/tenantSetting.ts";
import { column } from "../expression.ts";
import { QueryBuilderError } from "../query-builder-error.ts";
import { clickhouseRead } from "../read.ts";
import { tenantScope } from "../scope.ts";
import { defineClickHouseTable } from "../table.ts";

const summaries = defineClickHouseTable({
  name: "trace_summaries",
  tenantColumn: "TenantId",
  timeColumn: "OccurredAt",
  versionColumn: "UpdatedAt",
  sortKey: ["TenantId", "TraceId"],
  columns: {
    TenantId: column.string(),
    TraceId: column.string(),
    OccurredAt: column.dateTime64({ precision: 3 }),
    UpdatedAt: column.dateTime64({ precision: 3 }),
  },
});

const read = () =>
  clickhouseRead({ scope: tenantScope.single({ tenantId: "project_a" }) }).from(summaries);

const violationOf = (build: () => unknown) => {
  try {
    build();
  } catch (error) {
    if (error instanceof QueryBuilderError) return error.violation;
    throw error;
  }
  throw new Error("expected the builder to refuse");
};

describe("a read's query-level settings", () => {
  describe("when a read sets plain execution settings", () => {
    /** @scenario "A read sets its own query-level settings but never the scope's" */
    it("renders them after LIMIT and leaves the statement's settings to the scope", () => {
      const statement = read()
        .select({ TraceId: summaries.TraceId })
        .limit(10)
        .settings({ max_execution_time: 3, timeout_overflow_mode: "break", max_threads: 8 })
        .build();

      expect(statement.sql).toMatch(
        /LIMIT 10 SETTINGS max_execution_time = 3, timeout_overflow_mode = 'break', max_threads = 8$/,
      );
      expect(statement.kind).toBe("tenant");
      expect(statement.settings[TENANT_IDS_SETTING]).toBe("project_a");
      expect(Object.keys(statement.settings)).not.toContain("max_threads");
    });
  });

  describe("when a derived read carries the settings", () => {
    /** @scenario "A read sets its own query-level settings but never the scope's" */
    it("renders them inside its own parentheses", () => {
      const scope = tenantScope.single({ tenantId: "project_a" });
      const inner = clickhouseRead({ scope })
        .from(summaries)
        .select({ TraceId: summaries.TraceId })
        .limit(100)
        .settings({ max_threads: 8 })
        .as("sampled");
      const statement = clickhouseRead({ scope })
        .from(inner)
        .select({ TraceId: inner.TraceId })
        .limit(5)
        .build();

      expect(statement.sql).toMatch(/LIMIT 100 SETTINGS max_threads = 8\) AS sampled LIMIT 5$/);
    });
  });

  describe("when a read names a setting the scope owns", () => {
    it.each([
      [TENANT_IDS_SETTING],
      ["sql_langwatch_tenant_ids"],
      ["SQL_anything"],
      ["prefer_column_name_to_alias"],
      ["enable_global_with_statement"],
      ["max threads"],
    ])("refuses %s by name", (key) => {
      expect(violationOf(() => read().settings({ [key]: 1 }))).toEqual({
        kind: "refused-setting",
        setting: key,
      });
    });
  });

  describe("when a value is not a plain number or word", () => {
    it.each([[Number.NaN], [Number.POSITIVE_INFINITY], ["break'; DROP"], [""]])(
      "refuses %s",
      (value) => {
        expect(violationOf(() => read().settings({ max_threads: value }))).toEqual({
          kind: "refused-setting",
          setting: "max_threads",
        });
      },
    );
  });

  describe("when a union or one of its arms carries settings", () => {
    /** @scenario "A read sets its own query-level settings but never the scope's" */
    it("refuses the read, since a SETTINGS clause binds one SELECT", () => {
      const union = read()
        .select({ TraceId: summaries.TraceId })
        .settings({ max_threads: 8 })
        .unionAll((arm) => arm.from(summaries).select({ TraceId: summaries.TraceId }));

      expect(violationOf(() => union.build())).toEqual({ kind: "settings-in-union" });
    });
  });
});
