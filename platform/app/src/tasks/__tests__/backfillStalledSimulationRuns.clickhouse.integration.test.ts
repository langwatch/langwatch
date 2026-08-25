import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  startTestContainers,
  stopTestContainers,
} from "../../server/event-sourcing/__tests__/integration/testContainers";
import {
  BACKFILL_STALE_THRESHOLD_MS,
  ClickHouseStalledRunFinder,
} from "../../server/event-sourcing/pipelines/simulation-processing/repositories/stalledSimulationRuns.clickhouse.repository";

const tenantId = `test-stalled-backfill-${nanoid()}`;
const otherTenantId = `test-stalled-backfill-other-${nanoid()}`;
const NOW = Date.now();
const hoursAgo = (h: number) => new Date(NOW - h * 60 * 60_000);

// Default row: a STALE, non-terminal run — the historical population the
// one-shot backfill exists to close. Override timestamps / Status /
// FinishedAt / ArchivedAt to build the other cases.
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
    StartedAt: hoursAgo(48),
    QueuedAt: null,
    CreatedAt: hoursAgo(48),
    UpdatedAt: hoursAgo(48),
    FinishedAt: null,
    ArchivedAt: null,
    CancellationRequestedAt: null,
    LastSnapshotOccurredAt: new Date(0),
    LastEventOccurredAt: new Date(0),
    ...overrides,
  };
}

async function insertRows(ch: ClickHouseClient, rows: ReturnType<typeof makeRow>[]) {
  await ch.insert({
    table: "simulation_runs",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

let ch: ClickHouseClient;
let finder: ClickHouseStalledRunFinder;

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  finder = new ClickHouseStalledRunFinder(ch);
}, 60_000);

afterAll(async () => {
  if (ch) {
    for (const t of [tenantId, otherTenantId]) {
      await ch.exec({
        query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: t },
      });
    }
  }
  await stopTestContainers();
});

describe("ClickHouseStalledRunFinder.findStalledRuns (integration)", () => {
  describe("given a mix of abandoned, active, terminal and archived runs", () => {
    /** @scenario "The backfill only selects abandoned non-terminal runs" */
    it("surfaces only the abandoned non-terminal runs, with the ids needed to finish them", async () => {
      const abandonedStarted = makeRow({
        ScenarioRunId: "abandoned-started",
        ScenarioId: "scenario-abandoned",
        BatchRunId: "batch-abandoned",
        ScenarioSetId: "set-abandoned",
        Status: "IN_PROGRESS",
      });
      // Unlike the deleted boot sweep, abandoned QUEUED runs are in scope:
      // after the process-manager deploy every new queued run has its own
      // watchdog, so a day-quiet QUEUED row can only be historical.
      const abandonedQueued = makeRow({
        ScenarioRunId: "abandoned-queued",
        Status: "QUEUED",
      });
      const recentlyActive = makeRow({
        ScenarioRunId: "recently-active",
        Status: "IN_PROGRESS",
        StartedAt: hoursAgo(1),
        CreatedAt: hoursAgo(1),
        UpdatedAt: hoursAgo(1),
      });
      const finished = makeRow({
        ScenarioRunId: "already-finished",
        Status: "SUCCESS",
        Verdict: "success",
        FinishedAt: hoursAgo(48),
      });
      const archived = makeRow({
        ScenarioRunId: "archived-run",
        Status: "IN_PROGRESS",
        ArchivedAt: hoursAgo(48),
      });

      await insertRows(ch, [
        abandonedStarted,
        abandonedQueued,
        recentlyActive,
        finished,
        archived,
      ]);

      const result = await finder.findStalledRuns({
        now: NOW,
        thresholdMs: BACKFILL_STALE_THRESHOLD_MS,
      });
      const mine = result.filter((r) => r.tenantId === tenantId);
      const ids = mine.map((r) => r.scenarioRunId);

      expect(ids).toContain("abandoned-started");
      expect(ids).toContain("abandoned-queued");
      expect(ids).not.toContain("recently-active");
      expect(ids).not.toContain("already-finished");
      expect(ids).not.toContain("archived-run");

      const abandonedRow = mine.find((r) => r.scenarioRunId === "abandoned-started");
      expect(abandonedRow).toEqual({
        tenantId,
        scenarioRunId: "abandoned-started",
        scenarioId: "scenario-abandoned",
        batchRunId: "batch-abandoned",
        scenarioSetId: "set-abandoned",
        status: "IN_PROGRESS",
      });
    });
  });

  // The dedup correctness that protects finished runs: the ReplacingMergeTree
  // holds every version of a row, and only the LATEST version decides. A run
  // whose stale IN_PROGRESS version was later superseded by a terminal one
  // must not be re-errored.
  describe("given a run whose latest version is terminal", () => {
    it("does not surface it even though a stale non-terminal version exists", async () => {
      const runId = "superseded-by-terminal";
      const staleVersion = makeRow({
        ScenarioRunId: runId,
        Status: "IN_PROGRESS",
        UpdatedAt: hoursAgo(72),
      });
      const terminalVersion = makeRow({
        ScenarioRunId: runId,
        BatchRunId: staleVersion.BatchRunId,
        ScenarioSetId: staleVersion.ScenarioSetId,
        Status: "ERROR",
        FinishedAt: hoursAgo(70),
        UpdatedAt: hoursAgo(70),
      });

      await insertRows(ch, [staleVersion, terminalVersion]);

      const result = await finder.findStalledRuns({
        now: NOW,
        thresholdMs: BACKFILL_STALE_THRESHOLD_MS,
      });

      expect(result.map((r) => r.scenarioRunId)).not.toContain(runId);
    });
  });

  // The sweep runs with no tenant context, so it deliberately omits the
  // `WHERE TenantId = ...` filter every other simulation_runs query carries.
  // Nothing else pins that: a well-meaning "you forgot the tenant filter" fix
  // would silently reduce the sweep to one arbitrary tenant, and every other
  // test here uses a single tenant and would stay green.
  describe("given abandoned runs belonging to different tenants", () => {
    it("surfaces every tenant's runs, each attributed to its own tenant", async () => {
      await insertRows(ch, [
        makeRow({ ScenarioRunId: "abandoned-tenant-a" }),
        makeRow({
          ScenarioRunId: "abandoned-tenant-b",
          TenantId: otherTenantId,
        }),
      ]);

      const result = await finder.findStalledRuns({
        now: NOW,
        thresholdMs: BACKFILL_STALE_THRESHOLD_MS,
      });

      const a = result.find((r) => r.scenarioRunId === "abandoned-tenant-a");
      const b = result.find((r) => r.scenarioRunId === "abandoned-tenant-b");
      expect(a?.tenantId).toBe(tenantId);
      expect(b?.tenantId).toBe(otherTenantId);
    });
  });
});
