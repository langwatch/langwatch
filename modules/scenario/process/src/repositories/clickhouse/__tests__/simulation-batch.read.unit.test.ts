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

  it("carries the set filter into the election", () => {
    const election = read(null).sql.split(" IN (SELECT TenantId, ScenarioRunId,")[1] ?? "";
    expect(election.slice(0, election.indexOf("GROUP BY"))).toContain("ScenarioSetId IN (");
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
    expect(sql.match(/ScenarioSetId IN \(/g)).toHaveLength(2);
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

describe("SimulationClickHouseRepository.scenarioRunRead()", () => {
  const statement = SimulationClickHouseRepository.scenarioRunRead({
    projectId: "project_1",
    scenarioRunId: "run_1",
    holds: () => true,
  });

  it("scopes the read to its one tenant with the tenant setting", () => {
    scoped(statement);
    expect(statement.sql).toContain("FROM simulation_runs");
  });

  it("elects the run's latest version by a scalar max(UpdatedAt), both id-bound", () => {
    expect(statement.sql).toMatch(/UpdatedAt = \(SELECT max\(UpdatedAt\)/);
    expect(statement.sql.match(/\{\{idBound:simulation_runs\.ScenarioRunId:/g)).toHaveLength(2);
    expect(statement.sql).toContain("ArchivedAt IS NULL");
    expect(statement.sql).toContain("LIMIT 1");
  });
});

describe("SimulationClickHouseRepository.setRunsRead()", () => {
  const statement = SimulationClickHouseRepository.setRunsRead({
    projectId: "project_1",
    scenarioSetId: "default",
    holds: () => true,
  });

  it("scopes the read to its one tenant with the tenant setting", () => {
    scoped(statement);
    expect(statement.sql).toContain("FROM simulation_runs");
  });

  it("elects the default set's latest runs under both ids, by batch then oldest, capped", () => {
    expect(statement.sql).toContain("IN (SELECT TenantId, ScenarioRunId, max(UpdatedAt)");
    expect(statement.sql.match(/\{\{idBound:simulation_runs\.ScenarioSetId:/g)).toHaveLength(2);
    expect(Object.values(statement.params)).toContainEqual(["default", ""]);
    expect(statement.sql).toContain("ORDER BY BatchRunId ASC, CreatedAt ASC LIMIT 10000");
  });
});

describe("SimulationClickHouseRepository.batchesRunsRead() and batchesListRunsRead()", () => {
  const input = {
    projectId: "project_1",
    batchRunIds: ["batch_1", "batch_2"],
    scenarioSetId: "set_1",
    holds: () => true,
  };
  const whole = SimulationClickHouseRepository.batchesRunsRead(input);
  const list = SimulationClickHouseRepository.batchesListRunsRead(input);

  it("scopes both reads to their one tenant with the tenant setting", () => {
    for (const statement of [whole, list]) {
      expect(statement.kind).toBe("tenant");
      scoped(statement);
    }
  });

  it("elects the page's batches' latest runs by the batch id index, in the set, oldest first", () => {
    for (const { sql, params } of [whole, list]) {
      expect(sql.match(/\{\{idBound:simulation_runs\.BatchRunId:/g)).toHaveLength(2);
      expect(sql).toContain("ScenarioSetId IN");
      expect(Object.values(params)).toContainEqual(["batch_1", "batch_2"]);
      expect(sql).toContain("ORDER BY CreatedAt ASC LIMIT 5000");
    }
  });

  it("carries the set filter into the election, and not the archive test", () => {
    for (const { sql } of [whole, list]) {
      const election = sql.split(" IN (SELECT TenantId, ScenarioRunId,")[1] ?? "";
      const electionBody = election.slice(0, election.indexOf("GROUP BY"));
      expect(electionBody).toContain("ScenarioSetId IN (");
      expect(electionBody).not.toContain("ArchivedAt");
    }
  });

  it("trims the list to six messages and counts every message", () => {
    expect(list.sql).toMatch(/arraySlice\([\w.]*`Messages\.Role`, \{\w+:Int64\}, \{\w+:Int64\}\)/);
    expect(list.sql).toMatch(/length\([\w.]*`Messages\.Role`\) AS TotalMessageCount/);
    expect(Object.values(list.params)).toEqual(expect.arrayContaining([1, 6]));
    expect(list.sql).not.toContain("Messages.Rest");
    expect(list.sql).not.toContain("Evaluations.InputsJson");
    expect(whole.sql).toContain("Messages.Rest");
  });

  it("reads every set's runs when the caller names no set", () => {
    const { sql } = SimulationClickHouseRepository.batchesListRunsRead({
      ...input,
      scenarioSetId: undefined,
    });
    expect(sql).not.toContain("ScenarioSetId IN");
  });
});

describe("SimulationClickHouseRepository.maxUpdatedAtRead()", () => {
  const statement = SimulationClickHouseRepository.maxUpdatedAtRead({ projectId: "project_1" });

  it("reads the newest live version without an election, agent test runs left out", () => {
    scoped(statement);
    expect(statement.sql).toContain("max(UpdatedAt)");
    expect(statement.sql).toContain("ArchivedAt IS NULL");
    expect(statement.sql).toContain("NOT (endsWith(ScenarioSetId");
    expect(statement.sql).not.toContain("GROUP BY");
  });
});

describe("SimulationClickHouseRepository.lastUpdatedAtRead()", () => {
  it("bounds the probe by its StartedAt window and narrows to the set when named", () => {
    const statement = SimulationClickHouseRepository.lastUpdatedAtRead({
      projectId: "project_1",
      scenarioSetId: "default",
      startDate: 1_000,
      endDate: 2_000,
    });
    scoped(statement);
    expect(statement.sql).toContain("StartedAt >= ");
    expect(statement.sql).toContain("StartedAt <= ");
    expect(statement.sql).toContain("ScenarioSetId IN");
    expect(Object.values(statement.params)).toContainEqual(["default", ""]);
    expect(statement.sql).not.toContain("GROUP BY");
  });

  it("reads every set when the caller names none", () => {
    const { sql } = SimulationClickHouseRepository.lastUpdatedAtRead({
      projectId: "project_1",
      scenarioSetId: undefined,
      startDate: 1_000,
      endDate: undefined,
    });
    expect(sql).not.toContain("ScenarioSetId IN");
    expect(sql).not.toContain("StartedAt <= ");
  });
});

describe("SimulationClickHouseRepository.setRunIdsRead()", () => {
  const statement = SimulationClickHouseRepository.setRunIdsRead({
    projectId: "project_1",
    scenarioSetId: "set_1",
  });

  it("elects the set's live run ids by the set id index, capped", () => {
    scoped(statement);
    expect(statement.sql).toContain("SELECT DISTINCT ScenarioRunId");
    expect(statement.sql).toContain("IN (SELECT TenantId, ScenarioRunId, max(UpdatedAt)");
    expect(statement.sql.match(/\{\{idBound:simulation_runs\.ScenarioSetId:/g)).toHaveLength(2);
    expect(statement.sql).toContain("LIMIT 10000");
  });
});

/** The latest-version election's subquery text, after its key list. */
const electionOf = (sql: string) =>
  (sql.split(" IN (SELECT TenantId, ScenarioRunId,")[1] ?? "").split(" GROUP BY TenantId,")[0] ??
  "";

describe("SimulationClickHouseRepository.setsListRead()", () => {
  const statement = SimulationClickHouseRepository.setsListRead({
    projectId: "project_1",
    startDate: 1_000,
    endDate: 2_000,
  });

  it("scopes the read to its one tenant with the tenant setting", () => {
    scoped(statement);
    expect(statement.sql).toContain("FROM simulation_runs");
  });

  it("counts each set's live runs under the default set's one id, agent test runs left out", () => {
    expect(statement.sql).toContain("if(notEmpty(ScenarioSetId), ScenarioSetId, {");
    expect(statement.sql).toContain("count() AS ScenarioCount");
    expect(statement.sql).toContain("NOT (endsWith(ScenarioSetId");
    expect(statement.sql).toContain("ArchivedAt IS NULL");
    expect(statement.sql).toMatch(
      /GROUP BY if\(notEmpty\(ScenarioSetId\).* ORDER BY LastRunAt DESC$/,
    );
  });

  it("elects latest versions within the window, and only the window", () => {
    const election = electionOf(statement.sql);
    expect(statement.sql.match(/StartedAt >= /g)).toHaveLength(2);
    expect(election).not.toContain("ScenarioSetId");
    expect(election).not.toContain("ArchivedAt");
  });
});

describe("SimulationClickHouseRepository.setBatchPageRead()", () => {
  const statement = SimulationClickHouseRepository.setBatchPageRead({
    projectId: "project_1",
    scenarioSetId: "default",
    limit: 9,
    after: { ts: "1500", batchRunId: "batch_7" },
    startDate: 1_000,
    endDate: 2_000,
  });
  const maxCreatedAt = "toUnixTimestamp64Milli(max(CreatedAt))";

  it("scopes the read to its one tenant with the tenant setting", () => {
    scoped(statement);
    expect(statement.sql).toContain("FROM simulation_runs");
  });

  it("elects the default set's latest versions under both ids by the set id index, in the election too", () => {
    expect(statement.sql.match(/\{\{idBound:simulation_runs\.ScenarioSetId:/g)).toHaveLength(2);
    expect(Object.values(statement.params)).toContainEqual(["default", ""]);
    expect(statement.sql.match(/StartedAt >= /g)).toHaveLength(2);
    expect(statement.sql).not.toContain("endsWith(ScenarioSetId");
    expect(statement.sql).toContain("GROUP BY BatchRunId");
  });

  it("pages on the newest run, then the batch id, and bounds that run by the range", () => {
    expect(statement.sql).toContain(`HAVING (${maxCreatedAt} < {`);
    expect(statement.sql).toContain("BatchRunId > {");
    expect(statement.sql).toContain(`${maxCreatedAt} >= {`);
    expect(statement.sql).toContain(`${maxCreatedAt} <= {`);
    expect(statement.sql).toContain(`ORDER BY ${maxCreatedAt} DESC, BatchRunId ASC LIMIT 9`);
    expect(Object.values(statement.params)).toEqual(
      expect.arrayContaining([1_500, "batch_7", 1_000, 2_000]),
    );
  });
});

describe("SimulationClickHouseRepository.suitesBatchPageRead()", () => {
  const statement = SimulationClickHouseRepository.suitesBatchPageRead({
    projectId: "project_1",
    limit: 5,
    after: null,
  });

  it("scopes the read to its one tenant with the tenant setting", () => {
    scoped(statement);
    expect(statement.sql).toContain("FROM simulation_runs");
  });

  it("pages every set's batches with their set id, agent test runs left out of the outer read only", () => {
    expect(statement.sql).toContain("any(if(notEmpty(ScenarioSetId), ScenarioSetId, {");
    expect(statement.sql).toContain("NOT (endsWith(ScenarioSetId");
    expect(statement.sql).not.toContain("{{idBound");
    expect(electionOf(statement.sql)).not.toContain("ScenarioSetId");
    expect(statement.sql).not.toContain("HAVING");
    expect(statement.sql).toContain("BatchRunId ASC LIMIT 5");
  });
});

describe("SimulationClickHouseRepository.setSummariesRead()", () => {
  const external = SimulationClickHouseRepository.setSummariesRead({
    projectId: "project_1",
    startDate: 1_000,
    filter: "external",
  });
  const internal = SimulationClickHouseRepository.setSummariesRead({
    projectId: "project_1",
    filter: "internal-suites",
  });

  it("scopes both reads to their one tenant with the tenant setting", () => {
    scoped(external);
    scoped(internal);
    expect(internal.sql).toContain("FROM simulation_runs WHERE TenantId = {tenantId:String}");
  });

  it("reads each set's newest batch by first start, over per-batch counts", () => {
    expect(external.sql).toContain("argMax(BatchSettled, BatchStartedAtMs) AS TotalCount");
    expect(external.sql).toContain("max(BatchStartedAtMs) AS LastRunAt");
    expect(external.sql).toContain("min(ifNull(StartedAt, CreatedAt))");
    expect(external.sql).toContain(") AS batches GROUP BY NormalizedSetId ORDER BY LastRunAt DESC");
    expect(external.sql).toContain("HAVING toUnixTimestamp64Milli(max(CreatedAt)) >= {");
  });

  it("leaves unscored runs out of the settled and failed counts, and counts a stalled run failed", () => {
    expect(external.sql).toMatch(/AS BatchSettled/);
    expect(external.sql.match(/NOT \(\(Status = \{/g)).toHaveLength(2);
    expect(Object.values(external.params)).toContainEqual([
      "FAILED",
      "FAILURE",
      "ERROR",
      "CANCELLED",
      "STALLED",
    ]);
  });

  it("carries the set filter into the election, and not the archive test", () => {
    const election = electionOf(external.sql);
    expect(election).toContain("NOT (startsWith(ScenarioSetId");
    expect(election).toContain("NOT (endsWith(ScenarioSetId");
    expect(election).not.toContain("ArchivedAt");
    expect(electionOf(internal.sql)).toContain("endsWith(ScenarioSetId");
  });

  it("lists external sets under the default set's one id, internal suites as stored", () => {
    expect(external.sql).toContain("if(notEmpty(ScenarioSetId), ScenarioSetId, {");
    expect(internal.sql).toContain("SELECT ScenarioSetId AS NormalizedSetId");
    expect(internal.sql).toContain("startsWith(ScenarioSetId, {");
    expect(internal.sql).not.toContain("HAVING");
  });
});

describe("SimulationClickHouseRepository.lastResultsRead()", () => {
  const statement = SimulationClickHouseRepository.lastResultsRead({
    projectId: "project_1",
    scenarioIds: ["scenario_1"],
    startDate: 1_000,
  });

  it("scopes the read to its one tenant with the tenant setting", () => {
    scoped(statement);
    expect(statement.sql).toContain("FROM simulation_runs");
  });

  it("reads each named scenario's newest live run, NULL duration and cost as ''", () => {
    expect(statement.sql).toContain("argMax(Status, UpdatedAt) AS LastStatus");
    expect(statement.sql).toContain("argMax(ifNull(toString(DurationMs), {");
    expect(statement.sql).toContain("ScenarioId IN ({");
    expect(statement.sql).toContain("ArchivedAt IS NULL");
    expect(statement.sql).toMatch(/GROUP BY ScenarioId$/);
    expect(Object.values(statement.params)).toContainEqual(["scenario_1"]);
  });

  it("carries the agent test exclusion and the window into the election, not the scenario filter", () => {
    const election = electionOf(statement.sql);
    expect(election).toContain("NOT (endsWith(ScenarioSetId");
    expect(election).toContain("StartedAt >= ");
    expect(election).not.toContain("ScenarioId");
    expect(election).not.toContain("ArchivedAt");
  });
});
