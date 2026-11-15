/** The stored-bytes read is one tenant's built sum on the reader identity (ADR-202 Decided 20). */
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
