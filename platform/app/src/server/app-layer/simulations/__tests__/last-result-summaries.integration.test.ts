/**
 * The latest result per scenario, read from real ClickHouse.
 *
 * @see specs/suites/folder-run-plan-reuse.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createResilientClickHouseClient } from "~/server/clickhouse/managedClient";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { getSuiteSetId } from "~/server/suites/suite-set-id";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { SimulationClickHouseRepository } from "../repositories/simulation.clickhouse.repository";

const tenantId = `test-last-result-${nanoid()}`;
const otherTenantId = `${tenantId}-other`;
const now = Date.now();

function makeRunRow({
  scenarioId,
  batchRunId,
  scenarioSetId = `set-${nanoid(6)}`,
  status = "SUCCESS",
  metCriteria = ["c1"],
  unmetCriteria = [],
  startedAt = new Date(now - 60_000),
  updatedAt,
  tenant = tenantId,
  durationMs = "1500",
  totalCost = null,
}: {
  scenarioId: string;
  batchRunId: string;
  scenarioSetId?: string;
  status?: string;
  metCriteria?: string[];
  unmetCriteria?: string[];
  startedAt?: Date;
  updatedAt?: Date;
  tenant?: string;
  durationMs?: string | null;
  totalCost?: number | null;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenant,
    ScenarioRunId: `run-${nanoid()}`,
    ScenarioId: scenarioId,
    BatchRunId: batchRunId,
    ScenarioSetId: scenarioSetId,
    Version: "v1",
    Status: status,
    Name: "Refund Flow",
    Description: null,
    Metadata: null,
    "Messages.Id": ["msg-1"],
    "Messages.Role": ["user"],
    "Messages.Content": ["hello"],
    "Messages.TraceId": ["trace-1"],
    "Messages.Rest": ["{}"],
    TraceIds: [],
    Verdict: status === "SUCCESS" ? "success" : "failure",
    Reasoning: "reasoning",
    MetCriteria: metCriteria,
    UnmetCriteria: unmetCriteria,
    Error: null,
    DurationMs: durationMs,
    TotalCost: totalCost,
    StartedAt: startedAt,
    CreatedAt: startedAt,
    UpdatedAt: updatedAt ?? new Date(startedAt.getTime() + 1000),
    FinishedAt: new Date(startedAt.getTime() + 1000),
    ArchivedAt: null,
    LastSnapshotOccurredAt: new Date(0),
  };
}

let ch: ClickHouseClient;
let repo: SimulationClickHouseRepository;

async function insertRows(rows: ReturnType<typeof makeRunRow>[]) {
  await ch.insert({
    table: "simulation_runs",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  const resilient = createResilientClickHouseClient({ client: ch });
  repo = new SimulationClickHouseRepository(async () => resilient);
}, 60_000);

afterAll(async () => {
  if (ch) {
    for (const tenant of [tenantId, otherTenantId]) {
      await ch.exec({
        query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: tenant },
      });
    }
  }
  await stopTestContainers();
});

describe("getLastResultSummaries", () => {
  describe("when a scenario ran more than once inside the window", () => {
    it("reports the latest run's status, criteria counts and run address", async () => {
      const scenarioId = `scen-${nanoid(6)}`;
      const olderBatch = `batch-older-${nanoid(6)}`;
      const latestBatch = `batch-latest-${nanoid(6)}`;
      const latestSet = `set-latest-${nanoid(6)}`;
      await insertRows([
        makeRunRow({
          scenarioId,
          batchRunId: olderBatch,
          status: "SUCCESS",
          startedAt: new Date(now - 120_000),
          durationMs: "900",
          totalCost: 0.01,
        }),
        makeRunRow({
          scenarioId,
          batchRunId: latestBatch,
          scenarioSetId: latestSet,
          status: "FAILED",
          metCriteria: ["c1"],
          unmetCriteria: ["c2", "c3"],
          startedAt: new Date(now - 30_000),
          durationMs: "2500",
          totalCost: 0.042,
        }),
      ]);

      const summaries = await repo.getLastResultSummaries({
        projectId: tenantId,
        scenarioIds: [scenarioId],
      });

      expect(summaries).toHaveLength(1);
      const summary = summaries[0]!;
      expect(summary.scenarioId).toBe(scenarioId);
      expect(summary.status).toBe(ScenarioRunStatus.FAILED);
      expect(summary.metCriteriaCount).toBe(1);
      expect(summary.unmetCriteriaCount).toBe(2);
      expect(summary.batchRunId).toBe(latestBatch);
      expect(summary.scenarioSetId).toBe(latestSet);
      expect(summary.lastRunAt).toBe(now - 30_000);
      expect(summary.durationInMs).toBe(2500);
      expect(summary.totalCost).toBeCloseTo(0.042);
    });
  });

  describe("when the latest run carries no duration or cost yet", () => {
    it("reports null rather than an older run's values", async () => {
      const scenarioId = `scen-metrics-${nanoid(6)}`;
      await insertRows([
        makeRunRow({
          scenarioId,
          batchRunId: `batch-finished-${nanoid(6)}`,
          startedAt: new Date(now - 120_000),
          durationMs: "900",
          totalCost: 0.01,
        }),
        makeRunRow({
          scenarioId,
          batchRunId: `batch-fresh-${nanoid(6)}`,
          status: "IN_PROGRESS",
          startedAt: new Date(now - 30_000),
          durationMs: null,
          totalCost: null,
        }),
      ]);

      const summaries = await repo.getLastResultSummaries({
        projectId: tenantId,
        scenarioIds: [scenarioId],
      });

      expect(summaries).toHaveLength(1);
      expect(summaries[0]!.durationInMs).toBeNull();
      expect(summaries[0]!.totalCost).toBeNull();
    });
  });

  describe("when the latest run lies outside the window", () => {
    it("reports the latest run inside the window only", async () => {
      const scenarioId = `scen-window-${nanoid(6)}`;
      const insideBatch = `batch-inside-${nanoid(6)}`;
      await insertRows([
        makeRunRow({
          scenarioId,
          batchRunId: `batch-outside-${nanoid(6)}`,
          status: "FAILED",
          startedAt: new Date(now - 10_000),
        }),
        makeRunRow({
          scenarioId,
          batchRunId: insideBatch,
          status: "SUCCESS",
          startedAt: new Date(now - 300_000),
        }),
      ]);

      const summaries = await repo.getLastResultSummaries({
        projectId: tenantId,
        scenarioIds: [scenarioId],
        startDate: now - 600_000,
        endDate: now - 60_000,
      });

      expect(summaries).toHaveLength(1);
      expect(summaries[0]!.batchRunId).toBe(insideBatch);
      expect(summaries[0]!.status).toBe(ScenarioRunStatus.SUCCESS);
    });
  });

  describe("when a scenario has no run at all", () => {
    it("is simply absent from the result", async () => {
      const summaries = await repo.getLastResultSummaries({
        projectId: tenantId,
        scenarioIds: [`scen-never-ran-${nanoid(6)}`],
      });

      expect(summaries).toEqual([]);
    });
  });

  describe("when another tenant ran the same scenario id", () => {
    it("never reads across the tenant boundary", async () => {
      const scenarioId = `scen-tenant-${nanoid(6)}`;
      await insertRows([
        makeRunRow({
          scenarioId,
          batchRunId: `batch-foreign-${nanoid(6)}`,
          tenant: otherTenantId,
        }),
      ]);

      const summaries = await repo.getLastResultSummaries({
        projectId: tenantId,
        scenarioIds: [scenarioId],
      });

      expect(summaries).toEqual([]);
    });
  });

  describe("when no scenario filter is given", () => {
    it("returns one summary per scenario that ran in the window", async () => {
      const localTenant = `${tenantId}-all`;
      const localRepo = repo;
      const first = `scen-a-${nanoid(6)}`;
      const second = `scen-b-${nanoid(6)}`;
      await insertRows([
        makeRunRow({
          scenarioId: first,
          batchRunId: `batch-a-${nanoid(6)}`,
          tenant: localTenant,
        }),
        makeRunRow({
          scenarioId: second,
          batchRunId: `batch-b-${nanoid(6)}`,
          tenant: localTenant,
        }),
      ]);

      const summaries = await localRepo.getLastResultSummaries({
        projectId: localTenant,
      });

      expect(summaries.map((s) => s.scenarioId).sort()).toEqual(
        [first, second].sort(),
      );

      await ch.exec({
        query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: localTenant },
      });
    });
  });
});

describe("a folder's runs in the results view", () => {
  describe("when a folder's internal run set holds a finished batch", () => {
    /** @scenario "A folder run appears in the results view under the folder's name" */
    it("reports the folder's set in the internal suite summaries", async () => {
      const folderId = `folder-${nanoid(6)}`;
      const setId = getSuiteSetId(folderId);
      await insertRows([
        makeRunRow({
          scenarioId: `scen-${nanoid(6)}`,
          batchRunId: `batch-${nanoid(6)}`,
          scenarioSetId: setId,
        }),
      ]);

      const summaries = await repo.getInternalSuiteSummaries({
        projectId: tenantId,
      });

      const folderSummary = summaries.find(
        (summary) => summary.scenarioSetId === setId,
      );
      expect(folderSummary).toBeDefined();
      expect(folderSummary?.totalCount).toBe(1);
    });
  });
});
