/** The stalled-run sweep is built as an all-tenants read on the system identity (ADR-202). */
import { describe, expect, it } from "vitest";

import { ClickHouseStalledSimulationRunRepository } from "../clickhouse.stalled-simulation-run.repository.ts";

describe("ClickHouseStalledSimulationRunRepository.stalledRunsRead()", () => {
  const statement = ClickHouseStalledSimulationRunRepository.stalledRunsRead({
    staleBeforeMs: 1_000,
  });

  it("names the system identity with a reason and carries no tenant setting", () => {
    expect(statement.identity).toBe("system");
    expect(statement.kind).toBe("allTenants");
    expect(statement.reason).toBe("stalled simulation run sweep, every tenant");
    expect(Object.keys(statement.settings)).not.toContain("SQL_langwatch_tenant_ids");
  });

  it("elects each run's latest version before filtering by idle time and status", () => {
    expect(statement.sql).toContain("FROM simulation_runs");
    expect(statement.sql).toMatch(/IN \(SELECT TenantId, ScenarioRunId, max\(UpdatedAt\)/);
    expect(statement.sql).not.toMatch(/TenantId = \{/);
    expect(Object.values(statement.params)).toEqual(
      expect.arrayContaining([1_000, ["QUEUED", "PENDING", "IN_PROGRESS"]]),
    );
  });
});
