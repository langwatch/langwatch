import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseOrphanedRunFinder } from "../orphaned-run-reconciliation.clickhouse";
import { STALL_THRESHOLD_MS } from "../stall-detection";

const tenantId = `test-orphan-${nanoid()}`;
const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000);

// Default row: a STALE, non-terminal (QUEUED) run — i.e. an orphan. Override
// timestamps / Status / FinishedAt / ArchivedAt to build the other cases.
function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    ScenarioRunId: `run-${nanoid()}`,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: `batch-${nanoid()}`,
    ScenarioSetId: `set-${nanoid()}`,
    Version: "v1",
    Status: "QUEUED",
    Name: "Test run",
    Description: null,
    Metadata: null,
    "Messages.Id": [],
    "Messages.Role": [],
    "Messages.Content": [],
    "Messages.TraceId": [],
    "Messages.Rest": [],
    TraceIds: [],
    Verdict: null,
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: null,
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    TraceMetricsJson: "",
    StartedAt: minutesAgo(60),
    QueuedAt: null,
    CreatedAt: minutesAgo(60),
    UpdatedAt: minutesAgo(60),
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
let finder: ClickHouseOrphanedRunFinder;

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  finder = new ClickHouseOrphanedRunFinder(ch);
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

describe("ClickHouseOrphanedRunFinder.findOrphanedRuns (integration)", () => {
  describe("given a mix of stale, healthy, terminal and archived runs", () => {
    it("surfaces only the stale non-terminal run, with the ids needed to finish it", async () => {
      const orphan = makeRow({
        ScenarioRunId: "orphan-stale",
        ScenarioId: "scenario-orphan",
        BatchRunId: "batch-orphan",
        ScenarioSetId: "set-orphan",
        Status: "QUEUED",
      });
      const healthy = makeRow({
        ScenarioRunId: "healthy-recent",
        Status: "IN_PROGRESS",
        StartedAt: minutesAgo(1),
        CreatedAt: minutesAgo(1),
        UpdatedAt: minutesAgo(1),
      });
      const finished = makeRow({
        ScenarioRunId: "already-finished",
        Status: "SUCCESS",
        Verdict: "success",
        FinishedAt: minutesAgo(60),
      });
      const archived = makeRow({
        ScenarioRunId: "archived-run",
        Status: "QUEUED",
        ArchivedAt: minutesAgo(60),
      });

      await insertRows(ch, [orphan, healthy, finished, archived]);

      const result = await finder.findOrphanedRuns({
        now: NOW,
        thresholdMs: STALL_THRESHOLD_MS,
      });
      const mine = result.filter((r) => r.tenantId === tenantId);
      const ids = mine.map((r) => r.scenarioRunId);

      expect(ids).toContain("orphan-stale");
      expect(ids).not.toContain("healthy-recent");
      expect(ids).not.toContain("already-finished");
      expect(ids).not.toContain("archived-run");

      const orphanRow = mine.find((r) => r.scenarioRunId === "orphan-stale");
      expect(orphanRow).toEqual({
        tenantId,
        scenarioRunId: "orphan-stale",
        scenarioId: "scenario-orphan",
        batchRunId: "batch-orphan",
        scenarioSetId: "set-orphan",
        status: "QUEUED",
      });
    });
  });

  describe("given a run that was queued long ago but later finished", () => {
    it("does not surface it — the latest version decides", async () => {
      const scenarioRunId = `multiversion-${nanoid()}`;
      await insertRows(ch, [
        makeRow({
          ScenarioRunId: scenarioRunId,
          Status: "QUEUED",
          UpdatedAt: minutesAgo(60),
        }),
        makeRow({
          ScenarioRunId: scenarioRunId,
          Status: "SUCCESS",
          Verdict: "success",
          FinishedAt: minutesAgo(50),
          UpdatedAt: minutesAgo(50),
        }),
      ]);

      const result = await finder.findOrphanedRuns({
        now: NOW,
        thresholdMs: STALL_THRESHOLD_MS,
      });

      expect(result.map((r) => r.scenarioRunId)).not.toContain(scenarioRunId);
    });
  });
});
