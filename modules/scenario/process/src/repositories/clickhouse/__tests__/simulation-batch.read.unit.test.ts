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

describe("SimulationClickHouseRepository.batchHistoryPageRead()", () => {
  const statement = SimulationClickHouseRepository.batchHistoryPageRead({
    projectId: "project_1",
    scenarioSetId: "default",
    limit: 9,
    after: { ts: "1500", batchRunId: "batch_7" },
    startDate: 1_000,
    endDate: 2_000,
  });
  const lastRunAt = "toUnixTimestamp64Milli(max(CreatedAt))";

  it("scopes the read to its one tenant with the tenant setting", () => {
    scoped(statement);
    expect(statement.sql).toContain("FROM simulation_runs");
  });

  it("elects latest versions bounded by the set id index and the window, in the election too", () => {
    expect(statement.sql.match(/\{\{idBound:simulation_runs\.ScenarioSetId:/g)).toHaveLength(2);
    expect(statement.sql.match(/StartedAt >= /g)).toHaveLength(2);
    expect(statement.sql).toContain("GROUP BY BatchRunId");
  });

  it("pages on the newest run, then the batch id, and bounds that run by the range", () => {
    expect(statement.sql).toContain(`HAVING (${lastRunAt} < {`);
    expect(statement.sql).toContain("BatchRunId > {");
    expect(statement.sql).toContain(`${lastRunAt} >= {`);
    expect(statement.sql).toContain(`${lastRunAt} <= {`);
    expect(statement.sql).toContain(`ORDER BY ${lastRunAt} DESC, BatchRunId ASC LIMIT 9`);
    expect(Object.values(statement.params)).toEqual(
      expect.arrayContaining([1_500, "batch_7", 1_000, 2_000]),
    );
  });
});

describe("SimulationClickHouseRepository.batchPreviewItemsRead()", () => {
  const read = (window: { fromMs: number; toMs: number } | null) =>
    SimulationClickHouseRepository.batchPreviewItemsRead({
      projectId: "project_1",
      scenarioSetId: "default",
      batchRunIds: ["batch_1", "batch_2"],
      window,
    });

  it("scopes the read to its one tenant with the tenant setting", () => {
    const statement = read(null);
    scoped(statement);
    expect(statement.sql).toContain("FROM simulation_runs");
  });

  it("reads the page's batches' latest slim runs, oldest first, with note and actor", () => {
    const { sql, params } = read(null);
    expect(sql).toMatch(/BatchRunId IN \(\{\w+:Array\(String\)\}\)/);
    expect(sql).toContain("AS Note");
    expect(sql).toContain("AS ActorId");
    expect(sql).toMatch(/arraySlice\(`Messages\.Role`, \{\w+:Int64\}, \{\w+:Int64\}\)/);
    expect(Object.values(params)).toEqual(expect.arrayContaining([1, 4]));
    expect(sql).toContain("IN (SELECT TenantId, ScenarioRunId, max(UpdatedAt)");
    expect(sql.match(/\{\{idBound:simulation_runs\.BatchRunId:/g)).toHaveLength(2);
    expect(sql).toContain("ORDER BY CreatedAt ASC");
    expect(sql).not.toContain("StartedAt >=");
    expect(Object.values(params)).toContainEqual(["batch_1", "batch_2"]);
  });

  it("bounds the read and its election by the page's StartedAt window when it has one", () => {
    const { sql, params } = read({ fromMs: 1_000, toMs: 2_000 });
    expect(sql.match(/StartedAt >= /g)).toHaveLength(2);
    expect(sql.match(/StartedAt <= /g)).toHaveLength(2);
    expect(Object.values(params)).toEqual(expect.arrayContaining([1_000, 2_000]));
  });
});

describe("SimulationClickHouseRepository.batchRunsRead()", () => {
  const read = ({
    scenarioSetId,
    holds = () => true,
  }: {
    scenarioSetId: string | undefined;
    holds?: (name: string) => boolean;
  }) =>
    SimulationClickHouseRepository.batchRunsRead({
      projectId: "project_1",
      scenarioSetId,
      batchRunId: "batch_1",
      holds,
    });

  it("scopes the read to its one tenant with the tenant setting", () => {
    const statement = read({ scenarioSetId: undefined });
    scoped(statement);
    expect(statement.sql).toContain("FROM simulation_runs");
  });

  it("elects the batch's latest unarchived runs by the batch id index, oldest first", () => {
    const { sql } = read({ scenarioSetId: undefined });
    expect(sql).toContain("IN (SELECT TenantId, ScenarioRunId, max(UpdatedAt)");
    expect(sql.match(/\{\{idBound:simulation_runs\.BatchRunId:/g)).toHaveLength(2);
    expect(sql).toContain("ArchivedAt IS NULL");
    expect(sql).toContain("ORDER BY CreatedAt ASC");
    expect(sql).not.toContain("ScenarioSetId IN");
  });

  it("narrows to the default set under both of its ids when the caller names it", () => {
    const { sql, params } = read({ scenarioSetId: "" });
    expect(sql).toContain("ScenarioSetId IN");
    expect(Object.values(params)).toContainEqual(["default", ""]);
  });

  it("reads typed empty criteria on a target without the criteria columns", () => {
    const { sql } = read({
      scenarioSetId: undefined,
      holds: (name) => !name.startsWith("Criteria."),
    });
    expect(sql).not.toContain("`Criteria.Criterion`");
    expect(sql).toContain("Array(LowCardinality(String))");
  });
});
