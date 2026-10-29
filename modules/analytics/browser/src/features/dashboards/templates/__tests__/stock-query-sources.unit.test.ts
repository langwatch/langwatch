/**
 * A stock query reads a span view through the origin of its trace, looked up by tenant and trace
 * together, so a trace id shared with another project never decides.
 * @see modules/dashboard/specs/dashboards-v2.feature AC202
 */
import { describe, expect, it } from "vitest";

import { readSources } from "../model/stock-query-sources";

describe("given a stock query over a view that names only a row's trace", () => {
  /** @scenario "AC202 Stock widgets: every stock query reads the sources parameter, except those on the exemption list" */
  it("looks the trace's origin up by (TenantId, TraceId)", () => {
    const sql = readSources("SELECT count() AS n FROM spans WHERE OccurredAt >= now()");

    expect(sql).toContain("(TenantId, TraceId) IN (SELECT TenantId, TraceId FROM trace_metrics");
    expect(sql).not.toMatch(/[^,] TraceId IN \(SELECT TraceId/);
  });
});
