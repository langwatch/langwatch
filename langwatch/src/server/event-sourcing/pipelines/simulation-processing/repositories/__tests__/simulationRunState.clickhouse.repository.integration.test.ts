import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import { startTestContainers, stopTestContainers } from "../../../../__tests__/integration/testContainers";
import { createResilientClickHouseClient } from "../../../../../app-layer/clients/clickhouse";
import { createTenantId } from "../../../../";
import type { SimulationRunState } from "../../projections/simulationRunState.foldProjection";
import { SimulationRunStateRepositoryClickHouse } from "../simulationRunState.clickhouse.repository";

const tenantId = `test-sim-proj-${nanoid()}`;
const now = Date.now();

/**
 * Builds one simulation_runs row. Each call defaults to a fresh ScenarioRunId;
 * override ScenarioRunId + UpdatedAt to write multiple versions of one run.
 */
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    ScenarioRunId: `run-${nanoid()}`,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: `batch-${nanoid()}`,
    ScenarioSetId: `set-${nanoid()}`,
    Version: "v1",
    Status: "IN_PROGRESS",
    Name: "Test run",
    Description: "A test description",
    Metadata: null,
    "Messages.Id": ["msg-1"],
    "Messages.Role": ["user"],
    "Messages.Content": ["hello"],
    "Messages.TraceId": ["trace-1"],
    "Messages.Rest": ["{}"],
    TraceIds: [],
    Verdict: null,
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1500",
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    TraceMetricsJson: "",
    StartedAt: new Date(now - 5000),
    QueuedAt: null,
    CreatedAt: new Date(now - 5000),
    UpdatedAt: new Date(now),
    FinishedAt: null,
    ArchivedAt: null,
    CancellationRequestedAt: null,
    LastSnapshotOccurredAt: new Date(0),
    LastEventOccurredAt: new Date(0),
    ...overrides,
  };
}

async function insertRows(
  ch: ClickHouseClient,
  rows: ReturnType<typeof makeRow>[],
) {
  await ch.insert({
    table: "simulation_runs",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

let ch: ClickHouseClient;
let repo: SimulationRunStateRepositoryClickHouse<SimulationRunState>;

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  const resilient = createResilientClickHouseClient({ client: ch });
  repo = new SimulationRunStateRepositoryClickHouse<SimulationRunState>(
    async () => resilient,
  );
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

describe("SimulationRunStateRepositoryClickHouse.getProjection (integration)", () => {
  const context = { tenantId: createTenantId(tenantId) };

  describe("when a run has several versions", () => {
    it("returns the version with the greatest UpdatedAt", async () => {
      const scenarioRunId = `run-latest-${nanoid()}`;
      await insertRows(ch, [
        makeRow({
          ScenarioRunId: scenarioRunId,
          Status: "IN_PROGRESS",
          "Messages.Content": ["stale-1"],
          UpdatedAt: new Date(now - 3000),
        }),
        makeRow({
          ScenarioRunId: scenarioRunId,
          Status: "PENDING",
          "Messages.Content": ["stale-2"],
          UpdatedAt: new Date(now - 1000),
        }),
        makeRow({
          ScenarioRunId: scenarioRunId,
          Status: "SUCCESS",
          Verdict: "success",
          "Messages.Content": ["final-answer"],
          UpdatedAt: new Date(now),
        }),
      ]);

      const projection = await repo.getProjection(scenarioRunId, context);

      expect(projection).not.toBeNull();
      expect(projection!.data.Status).toBe("SUCCESS");
      expect(projection!.data.Verdict).toBe("success");
      expect(projection!.data.Messages.map((m) => m.Content)).toEqual([
        "final-answer",
      ]);
    });
  });

  describe("when a run has many heavy-payload versions", () => {
    it("returns the latest without reading every version's heavy columns", async () => {
      const scenarioRunId = `run-heavy-${nanoid()}`;
      // A sizeable Messages.Content per version: the old IN-tuple dedup
      // materialized this across every version before discarding stale ones.
      // The scalar-UpdatedAt form must still return only the latest version.
      const heavy = "x".repeat(20_000);
      const versions = Array.from({ length: 25 }, (_, i) =>
        makeRow({
          ScenarioRunId: scenarioRunId,
          Status: i === 24 ? "SUCCESS" : "IN_PROGRESS",
          "Messages.Content": [`${heavy}-v${i}`],
          UpdatedAt: new Date(now - (24 - i) * 1000),
        }),
      );
      await insertRows(ch, versions);

      const projection = await repo.getProjection(scenarioRunId, context);

      expect(projection).not.toBeNull();
      expect(projection!.data.Status).toBe("SUCCESS");
      expect(projection!.data.Messages[0]!.Content).toBe(`${heavy}-v24`);
    });
  });

  describe("when the run does not exist", () => {
    it("returns null", async () => {
      const projection = await repo.getProjection(
        `run-missing-${nanoid()}`,
        context,
      );
      expect(projection).toBeNull();
    });
  });

  describe("when the same ScenarioRunId exists under another tenant", () => {
    it("does not return the other tenant's row", async () => {
      const scenarioRunId = `run-shared-${nanoid()}`;
      const otherTenant = `test-sim-proj-other-${nanoid()}`;
      await insertRows(ch, [
        makeRow({
          TenantId: otherTenant,
          ScenarioRunId: scenarioRunId,
          Status: "SUCCESS",
        }),
      ]);

      const projection = await repo.getProjection(scenarioRunId, context);
      expect(projection).toBeNull();

      await ch.exec({
        query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: otherTenant },
      });
    });
  });
});
