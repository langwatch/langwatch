/** The batch summary, batch change and batch count reads are one tenant's built reads (ADR-202). */
import { describe, expect, it } from "vitest";

import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";

const scoped = (statement: {
  identity: string;
  kind: string;
  tenantId?: string;
  settings: Record<string, unknown>;
}) => {
  expect(statement.identity).toBe("reader");
  expect(statement.kind).toBe("tenant");
  expect(statement.tenantId).toBe("project_1");
  expect(statement.settings.SQL_langwatch_tenant_ids).toBe("project_1");
};

describe("SimulationClickHouseRepository.batchSummaryRead()", () => {
  const statement = SimulationClickHouseRepository.batchSummaryRead({
    projectId: "project_1",
    batchRunId: "batch_1",
  });

  it("scopes the read to its one tenant with the tenant setting", () => {
    scoped(statement);
    expect(statement.sql).toContain("FROM simulation_runs");
  });

  it("elects latest versions bounded by the batch id index, in the election too", () => {
    expect(statement.sql).toContain("IN (SELECT TenantId, ScenarioRunId, max(UpdatedAt)");
    expect(statement.sql.match(/\{\{idBound:simulation_runs\.BatchRunId:/g)).toHaveLength(2);
    expect(statement.sql).toContain("ArchivedAt IS NULL");
    expect(statement.sql).toContain("GROUP BY BatchRunId");
  });

  it("leaves unscored runs out of the failure count", () => {
    expect(statement.sql).toMatch(/countIf\(.*NOT \(?JSONExtractString\(ifNull\(Metadata/);
  });
});

describe("SimulationClickHouseRepository.batchLastUpdatedRead()", () => {
  const statement = SimulationClickHouseRepository.batchLastUpdatedRead({
    projectId: "project_1",
    batchRunId: "batch_1",
  });

  it("reads every version's latest change without an election", () => {
    scoped(statement);
    expect(statement.sql).toContain("max(UpdatedAt)");
    expect(statement.sql).not.toContain("GROUP BY");
  });
});

describe("SimulationClickHouseRepository.batchRunCountRead()", () => {
  const statement = SimulationClickHouseRepository.batchRunCountRead({
    projectId: "project_1",
    scenarioSetId: "default",
    startDate: 1_000,
    endDate: 2_000,
  });

  it("counts the default set's batches under both of its ids, within the date range", () => {
    scoped(statement);
    expect(statement.sql).toContain("countDistinct(BatchRunId)");
    expect(Object.values(statement.params)).toContainEqual(["default", ""]);
    expect(statement.sql.match(/StartedAt >= /g)).toHaveLength(2);
  });
});
