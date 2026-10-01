/**
 * @vitest-environment node
 * The trace filter as a predicate on a facet table: a live window's membership
 * test has to drop its upper bound, as the reads around it do.
 * @see specs/traces-v2/search.feature
 */

import { describe, expect, it } from "vitest";

import { scopeTraceFilterToTable } from "../trace-facet-scope.rules.ts";

const FILTER = {
  sql: "Status = {p0:String}",
  params: { tenantId: "project-1", timeFrom: 1, timeTo: 2, p0: "error" },
};

describe("scopeTraceFilterToTable", () => {
  describe("given the trace table itself", () => {
    it("is the filter, parenthesised", () => {
      expect(scopeTraceFilterToTable({ table: "trace_summaries", filterWhere: FILTER }).sql).toBe(
        "(Status = {p0:String})",
      );
    });

    it("carries the filter's own parameters", () => {
      expect(
        scopeTraceFilterToTable({ table: "trace_summaries", filterWhere: FILTER }).params,
      ).toEqual(FILTER.params);
    });
  });

  describe("given another table and an absolute window", () => {
    it("bounds membership on both ends of the window", () => {
      const { sql } = scopeTraceFilterToTable({ table: "stored_spans", filterWhere: FILTER });

      expect(sql).toContain("OccurredAt >= fromUnixTimestamp64Milli");
      expect(sql).toContain("OccurredAt <= fromUnixTimestamp64Milli");
    });

    it("reads the traces at their latest version", () => {
      const { sql } = scopeTraceFilterToTable({ table: "evaluation_runs", filterWhere: FILTER });

      expect(sql).toContain("max(UpdatedAt)");
      expect(sql).toContain("GROUP BY TenantId, TraceId");
    });
  });

  describe("given another table and a live window", () => {
    /** @scenario "A live window leaves the facet membership uncapped" */
    it("leaves the upper bound off, as the reads around it do", () => {
      const { sql } = scopeTraceFilterToTable({
        table: "stored_spans",
        filterWhere: FILTER,
        isLiveWindow: true,
      });

      expect(sql).toContain("OccurredAt >= fromUnixTimestamp64Milli");
      expect(sql).not.toContain("OccurredAt <= fromUnixTimestamp64Milli");
      expect(sql).toContain("TenantId = {tenantId:String}");
    });
  });
});
