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
const otherTenantId = `test-orphan-other-${nanoid()}`;
const NOW = Date.now();
const minutesAgo = (m: number) => new Date(NOW - m * 60_000);

// Default row: a STALE, IN_PROGRESS run — i.e. an orphan a dead worker had
// already started. Override timestamps / Status / FinishedAt / ArchivedAt to
// build the other cases. A stale QUEUED run is deliberately NOT an orphan here:
// nothing caps queue wait, so a run behind a large backlog looks identical to
// an abandoned one. QUEUED is owned by scenario-orphan-reconciler.ts (#3365).
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
    for (const t of [tenantId, otherTenantId]) {
      await ch.exec({
        query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: t },
      });
    }
  }
  await stopTestContainers();
});

describe("ClickHouseOrphanedRunFinder.findOrphanedRuns (integration)", () => {
  describe("given a mix of stale, healthy, terminal and archived runs", () => {
    it("surfaces only the stale started run, with the ids needed to finish it", async () => {
      const orphan = makeRow({
        ScenarioRunId: "orphan-stale",
        ScenarioId: "scenario-orphan",
        BatchRunId: "batch-orphan",
        ScenarioSetId: "set-orphan",
        Status: "IN_PROGRESS",
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
        Status: "IN_PROGRESS",
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
        status: "IN_PROGRESS",
      });
    });
  });

  // The false-positive this sweep must never produce. A QUEUED run behind a
  // large batch/suite backlog goes stale while a healthy worker is still
  // working toward it -- nothing caps queue wait the way the child timeout caps
  // execution. QUEUED orphans belong to scenario-orphan-reconciler.ts (#3365).
  describe("given a stale QUEUED run waiting behind a backlog", () => {
    it("does not surface it — queue wait is not evidence the worker died", async () => {
      const queuedBehindBacklog = makeRow({
        ScenarioRunId: "queued-behind-backlog",
        Status: "QUEUED",
        StartedAt: minutesAgo(90),
        CreatedAt: minutesAgo(90),
        UpdatedAt: minutesAgo(90),
      });

      await insertRows(ch, [queuedBehindBacklog]);

      const result = await finder.findOrphanedRuns({
        now: NOW,
        thresholdMs: STALL_THRESHOLD_MS,
      });

      expect(result.map((r) => r.scenarioRunId)).not.toContain(
        "queued-behind-backlog",
      );
    });
  });

  // The sweep runs at boot with no tenant context, so it deliberately omits the
  // `WHERE TenantId = ...` filter every other simulation_runs query carries.
  // Nothing else pins that: a well-meaning "you forgot the tenant filter" fix
  // would silently reduce the sweep to one arbitrary tenant, and every other
  // test here uses a single tenant and would stay green.
  describe("given stale started runs belonging to different tenants", () => {
    it("surfaces every tenant's orphan, each attributed to its own tenant", async () => {
      await insertRows(ch, [
        makeRow({ ScenarioRunId: "orphan-tenant-a" }),
        makeRow({
          ScenarioRunId: "orphan-tenant-b",
          TenantId: otherTenantId,
        }),
      ]);

      const result = await finder.findOrphanedRuns({
        now: NOW,
        thresholdMs: STALL_THRESHOLD_MS,
      });

      const a = result.find((r) => r.scenarioRunId === "orphan-tenant-a");
      const b = result.find((r) => r.scenarioRunId === "orphan-tenant-b");

      expect(a?.tenantId).toBe(tenantId);
      expect(b?.tenantId).toBe(otherTenantId);
    });
  });

  describe("given a run that was started long ago but later finished", () => {
    it("does not surface it — the latest version decides", async () => {
      const scenarioRunId = `multiversion-${nanoid()}`;
      await insertRows(ch, [
        makeRow({
          ScenarioRunId: scenarioRunId,
          Status: "IN_PROGRESS",
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
