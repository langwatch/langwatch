/** The run metrics rollup read is one tenant's built read on the reader identity (ADR-202). */
import { describe, expect, it } from "vitest";

import { ClickHouseSimulationRunMetricsRepository } from "../clickhouse.simulation-run-metrics.repository.ts";

describe("ClickHouseSimulationRunMetricsRepository.runMetricsRead()", () => {
  const statement = ClickHouseSimulationRunMetricsRepository.runMetricsRead({
    tenantId: "project_1",
    scenarioRunId: "run_1",
  });

  it("scopes the read to its one tenant with the tenant setting", () => {
    expect(statement.identity).toBe("reader");
    expect(statement.kind).toBe("tenant");
    expect(statement.tenantId).toBe("project_1");
    expect(statement.settings.SQL_langwatch_tenant_ids).toBe("project_1");
  });

  it("merges each trace's latest states before summing the role maps", () => {
    expect(statement.sql).toContain("FROM simulation_run_metrics_rollup");
    expect(statement.sql).toContain("argMaxMerge(");
    expect(statement.sql).toContain("sumMap(");
    expect(Object.values(statement.params)).toContain("run_1");
  });
});
