import { describe, expect, it } from "vitest";

import { buildTimeseriesQuery } from "../clickhouse.aggregation-builder.mapper.ts";
import { buildRollupTimeseriesQuery } from "../clickhouse.rollup-timeseries-query.mapper.ts";

const input = {
  projectId: "tenant-1",
  startDate: new Date("2026-01-01T00:00:00.000Z"),
  endDate: new Date("2026-01-02T00:00:00.000Z"),
  previousPeriodStartDate: new Date("2025-12-31T00:00:00.000Z"),
  series: [{ metric: "performance.total_cost", aggregation: "sum" as const }],
  filters: {},
  timeScale: 60,
  timeZone: "Europe/Amsterdam",
};

describe("Analytics timeseries query compatibility", () => {
  /** @scenario "A trace summaries series leaves its tenants to the proof" */
  it("leaves the legacy statement's tenants to the proof and keeps its date parameter names", () => {
    const query = buildTimeseriesQuery(input);

    expect(query.sql).toContain("{{tenantScope:OccurredAt}}");
    expect(query.sql).not.toContain("{tenantId:String}");
    expect(query.sql).toContain("{currentStart:DateTime64(3)}");
    expect(query.sql).toContain("{previousStart:DateTime64(3)}");
    expect(query.params).not.toHaveProperty("tenantId");
  });

  it("keeps the routed timezone in the ClickHouse bucket expression", () => {
    const query = buildRollupTimeseriesQuery(input);

    expect(query.sql).toContain("Europe/Amsterdam");
    expect(query.sql).toContain("{{tenantScope:BucketStart}}");
    expect(query.params).not.toHaveProperty("tenantId");
  });
});
