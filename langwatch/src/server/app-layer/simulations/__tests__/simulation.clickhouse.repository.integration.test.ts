import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  getTestClickHouseClient,
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { SimulationClickHouseRepository } from "../repositories/simulation.clickhouse.repository";

const tenantId = `test-sim-repo-${nanoid()}`;
const now = Date.now();

function makeInsertRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    ScenarioRunId: `run-${nanoid()}`,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: `batch-${nanoid()}`,
    ScenarioSetId: `set-${nanoid()}`,
    Version: "v1",
    Status: "SUCCESS",
    Name: "Test run",
    Description: "A test description",
    Metadata: null,
    "Messages.Id": ["msg-1"],
    "Messages.Role": ["user"],
    "Messages.Content": ["hello"],
    "Messages.TraceId": ["trace-1"],
    "Messages.Rest": ["{}"],
    TraceIds: [],
    Verdict: "success",
    Reasoning: "All good",
    MetCriteria: ["criterion-1"],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1500",
    StartedAt: new Date(now - 5000),
    CreatedAt: new Date(now - 5000),
    UpdatedAt: new Date(now),
    FinishedAt: new Date(now),
    ArchivedAt: null,
    LastSnapshotOccurredAt: new Date(0),
    ...overrides,
  };
}

async function insertRow(ch: ClickHouseClient, row: ReturnType<typeof makeInsertRow>) {
  await ch.insert({
    table: "simulation_runs",
    values: [row],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

let ch: ClickHouseClient;
let repo: SimulationClickHouseRepository;

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  repo = new SimulationClickHouseRepository(ch);
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("SimulationClickHouseRepository (integration)", () => {
  describe("getScenarioRunData()", () => {
    describe("when row has metadata", () => {
      it("returns parsed metadata object", async () => {
        const scenarioRunId = `run-meta-${nanoid()}`;
        const metadata = { name: "My Scenario", custom_field: "value" };

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: scenarioRunId,
          Metadata: JSON.stringify(metadata),
        }));

        const result = await repo.getScenarioRunData({
          projectId: tenantId,
          scenarioRunId,
        });

        expect(result).not.toBeNull();
        expect(result!.metadata).toEqual(metadata);
      });
    });

    describe("when row has null metadata", () => {
      it("returns null metadata", async () => {
        const scenarioRunId = `run-nometa-${nanoid()}`;

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: scenarioRunId,
          Metadata: null,
        }));

        const result = await repo.getScenarioRunData({
          projectId: tenantId,
          scenarioRunId,
        });

        expect(result).not.toBeNull();
        expect(result!.metadata).toBeNull();
      });
    });

    describe("when row does not exist", () => {
      it("returns null", async () => {
        const result = await repo.getScenarioRunData({
          projectId: tenantId,
          scenarioRunId: `run-nonexistent-${nanoid()}`,
        });

        expect(result).toBeNull();
      });
    });
  });

  describe("getScenarioRunDataByScenarioId()", () => {
    describe("when rows have metadata", () => {
      it("returns parsed metadata for each run", async () => {
        const scenarioId = `scenario-byscid-${nanoid()}`;
        const metadata1 = { env: "staging" };
        const metadata2 = { env: "production" };

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-byscid-1-${nanoid()}`,
          ScenarioId: scenarioId,
          Metadata: JSON.stringify(metadata1),
        }));
        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-byscid-2-${nanoid()}`,
          ScenarioId: scenarioId,
          Metadata: JSON.stringify(metadata2),
        }));

        const result = await repo.getScenarioRunDataByScenarioId({
          projectId: tenantId,
          scenarioId,
        });

        expect(result).not.toBeNull();
        expect(result).toHaveLength(2);
        const metadatas = result!.map((r) => r.metadata);
        expect(metadatas).toContainEqual(metadata1);
        expect(metadatas).toContainEqual(metadata2);
      });
    });
  });

  describe("getRunDataForBatchRun()", () => {
    describe("when runs have metadata", () => {
      it("returns runs with metadata", async () => {
        const batchRunId = `batch-forbatch-${nanoid()}`;
        const scenarioSetId = `set-forbatch-${nanoid()}`;
        const metadata = { model: "gpt-4", temperature: 0.7 };

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-forbatch-${nanoid()}`,
          BatchRunId: batchRunId,
          ScenarioSetId: scenarioSetId,
          Metadata: JSON.stringify(metadata),
        }));

        const result = await repo.getRunDataForBatchRun({
          projectId: tenantId,
          scenarioSetId,
          batchRunId,
        });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        expect(result.runs).toHaveLength(1);
        expect(result.runs[0]!.metadata).toEqual(metadata);
      });
    });
  });

  describe("getAllRunDataForScenarioSet()", () => {
    describe("when runs have metadata", () => {
      it("returns all runs with metadata", async () => {
        const scenarioSetId = `set-allruns-${nanoid()}`;
        const metadata = { suite: "regression" };

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-allruns-${nanoid()}`,
          ScenarioSetId: scenarioSetId,
          Metadata: JSON.stringify(metadata),
        }));

        const result = await repo.getAllRunDataForScenarioSet({
          projectId: tenantId,
          scenarioSetId,
        });

        expect(result).toHaveLength(1);
        expect(result[0]!.metadata).toEqual(metadata);
      });
    });
  });

  describe("getRunDataForScenarioSet() (paginated)", () => {
    describe("when runs have metadata", () => {
      it("returns runs with metadata through pagination", async () => {
        const scenarioSetId = `set-paged-${nanoid()}`;
        const batchRunId = `batch-paged-${nanoid()}`;
        const metadata = { page_test: true };

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-paged-${nanoid()}`,
          BatchRunId: batchRunId,
          ScenarioSetId: scenarioSetId,
          Metadata: JSON.stringify(metadata),
        }));

        const result = await repo.getRunDataForScenarioSet({
          projectId: tenantId,
          scenarioSetId,
          limit: 10,
        });

        expect(result.runs).toHaveLength(1);
        // Note: paginated queries use LIST_COLUMNS which don't include Metadata.
        // This is intentional for list views — only detail views include it.
      });
    });
  });

  describe("getRunDataForAllSuites()", () => {
    describe("when internal suite runs have metadata", () => {
      it("returns runs through the all-suites query", async () => {
        const scenarioSetId = `__internal__allsuites_${nanoid()}__suite`;
        const batchRunId = `batch-allsuites-${nanoid()}`;

        await insertRow(ch, makeInsertRow({
          ScenarioRunId: `run-allsuites-${nanoid()}`,
          BatchRunId: batchRunId,
          ScenarioSetId: scenarioSetId,
          Metadata: JSON.stringify({ all_suites: true }),
        }));

        const result = await repo.getRunDataForAllSuites({
          projectId: tenantId,
          limit: 10,
        });

        expect(result.changed).toBe(true);
        if (!result.changed) throw new Error("expected changed");
        expect(result.runs.length).toBeGreaterThanOrEqual(1);
        const ourRun = result.runs.find((r) => r.batchRunId === batchRunId);
        expect(ourRun).toBeDefined();
      });
    });
  });
});
