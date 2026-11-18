/** The stored-bytes read is one tenant's built sum on the reader identity (ADR-202 Decided 20). */
import { scenarioStoredPastRetentionInputSchema } from "@langwatch/scenario-contract";
import { describe, expect, it } from "vitest";

import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";

describe("SimulationClickHouseRepository.storedBytesRead()", () => {
  const statement = SimulationClickHouseRepository.storedBytesRead({ projectId: "project_1" });

  it("scopes the read to its one tenant with the tenant setting", () => {
    expect(statement.identity).toBe("reader");
    expect(statement.kind).toBe("tenant");
    expect(statement.tenantId).toBe("project_1");
    expect(statement.settings.SQL_langwatch_tenant_ids).toBe("project_1");
  });

  it("sums `_size_bytes` over simulation_runs under the meter's thread and time caps", () => {
    expect(statement.sql).toContain("FROM simulation_runs");
    expect(statement.sql).toContain("sum(_size_bytes)");
    expect(statement.sql).toContain("SETTINGS max_threads = 2, max_execution_time = 45");
  });
});

describe("SimulationClickHouseRepository.storedPastRetentionCountRead()", () => {
  const beforeMs = Date.UTC(2026, 7, 1);
  const statement = SimulationClickHouseRepository.storedPastRetentionCountRead({
    projectId: "project_1",
    beforeMs,
    retentionDays: 91,
  });

  /** @scenario "Scenario counts the items a shorter period would remove" */
  it("counts distinct `ScenarioRunId` before the cutoff, kept forever or longer than the period", () => {
    expect(statement.identity).toBe("reader");
    expect(statement.tenantId).toBe("project_1");
    expect(statement.sql).toContain("FROM simulation_runs");
    expect(statement.sql).toContain("uniqExact(ScenarioRunId)");
    expect(statement.sql).toMatch(/StartedAt\)? < /);
    expect(statement.sql).toMatch(/_retention_days = /);
    expect(statement.sql).toMatch(/_retention_days > /);
    expect(Object.values(statement.params)).toEqual(expect.arrayContaining([beforeMs, 91]));
  });

  /** @scenario "Scenario refuses a past-retention count without a period" */
  it("refuses a period of 0 days and a count without a cutoff", () => {
    const refusedPaths = (input: object) =>
      scenarioStoredPastRetentionInputSchema
        .safeParse(input)
        .error?.issues.map((issue) => issue.path.join("."));

    expect(refusedPaths({ projectId: "project_1", beforeMs, retentionDays: 0 })).toEqual([
      "retentionDays",
    ]);
    expect(refusedPaths({ projectId: "project_1", retentionDays: 91 })).toEqual(["beforeMs"]);
  });
});

describe("SimulationClickHouseRepository.storedBytesRead before a cutoff", () => {
  const beforeMs = Date.UTC(2026, 7, 1);

  /** @scenario "Scenario's stored bytes before a cutoff count only rows whose partition time is earlier" */
  it("keeps only rows whose `StartedAt` is before the cutoff", () => {
    const statement = SimulationClickHouseRepository.storedBytesRead({
      projectId: "project_1",
      beforeMs: beforeMs,
    });

    expect(statement.sql).toMatch(/StartedAt\)? < /);
    expect(Object.values(statement.params)).toContain(beforeMs);
  });

  it("filters on no time without a cutoff", () => {
    expect(
      SimulationClickHouseRepository.storedBytesRead({ projectId: "project_1" }).sql,
    ).not.toMatch(/StartedAt\)? < /);
  });
});
