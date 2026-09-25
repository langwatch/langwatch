/**
 * @vitest-environment node
 *
 * The trace filter as a predicate on a facet table.
 *
 * The reads around this one drop the upper bound on a live window, because a
 * rolling `to` is the instant the request was built and new traces keep
 * arriving behind it. The membership subquery has to agree, or a filtered
 * `stored_spans` facet counts fewer traces than the table beside it shows.
 *
 * Spec: specs/traces-v2/search.feature ("Facet counts").
 */
import { describe, expect, it } from "vitest";
import { scopeTraceFilterToTable } from "../trace-filter-scope";

const FILTER = {
  sql: "Status = {p0:String}",
  params: { tenantId: "project-1", timeFrom: 1, timeTo: 2, p0: "error" },
};

describe("scopeTraceFilterToTable", () => {
  describe("given the trace table itself", () => {
    it("is the filter, parenthesised", () => {
      expect(
        scopeTraceFilterToTable({
          table: "trace_summaries",
          filterWhere: FILTER,
        }).sql,
      ).toBe("(Status = {p0:String})");
    });
  });

  describe("given another table and an absolute window", () => {
    it("bounds membership on both ends of the window", () => {
      const { sql } = scopeTraceFilterToTable({
        table: "stored_spans",
        filterWhere: FILTER,
      });
      expect(sql).toContain("OccurredAt >= fromUnixTimestamp64Milli");
      expect(sql).toContain("OccurredAt <= fromUnixTimestamp64Milli");
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
