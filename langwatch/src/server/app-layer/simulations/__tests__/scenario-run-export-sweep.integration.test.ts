/**
 * The half of the export contract that only exists as SQL.
 *
 * Every scope the dialog offers — date range, scenario, set, project — is a
 * WHERE clause, and archived exclusion and STALLED derivation happen on the way
 * out of the row mapper. None of that can be observed against a stubbed
 * repository, so this runs against a real ClickHouse: a filter that silently
 * matches nothing looks identical to one that correctly matched nothing, and
 * only real rows tell the two apart.
 *
 * @see specs/scenarios/scenario-run-export.feature
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { STALL_THRESHOLD_MS } from "~/server/scenarios/stall-detection";
import {
  startTestContainers,
  stopTestContainers,
} from "../../../event-sourcing/__tests__/integration/testContainers";
import { createResilientClickHouseClient } from "../../clients/clickhouse";
import { SimulationClickHouseRepository } from "../repositories/simulation.clickhouse.repository";

const tenantId = `test-export-sweep-${nanoid()}`;
const otherTenantId = `test-export-sweep-other-${nanoid()}`;
const now = Date.now();
const DAY_MS = 24 * 60 * 60 * 1000;

function makeInsertRow(overrides: Record<string, unknown> = {}) {
  const startedAt = new Date(now - 5000);
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
    Description: null,
    Metadata: null,
    "Messages.Id": [],
    "Messages.Role": [],
    "Messages.Content": [],
    "Messages.TraceId": [],
    "Messages.Rest": [],
    TraceIds: [],
    Verdict: "success",
    Reasoning: "All good",
    MetCriteria: ["criterion-1"],
    UnmetCriteria: [],
    Error: null,
    DurationMs: "1500",
    StartedAt: startedAt,
    CreatedAt: startedAt,
    UpdatedAt: new Date(now),
    FinishedAt: new Date(now),
    ArchivedAt: null,
    LastSnapshotOccurredAt: new Date(0),
    ...overrides,
  };
}

async function insertRows(
  client: ClickHouseClient,
  rows: ReturnType<typeof makeInsertRow>[],
) {
  await client.insert({
    table: "simulation_runs",
    values: rows,
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

let ch: ClickHouseClient;
let repo: SimulationClickHouseRepository;

/** Sweeps to exhaustion the way the service does, so cursor handling is exercised too. */
async function sweep(
  params: Parameters<SimulationClickHouseRepository["findRunsForExport"]>[0],
) {
  const collected = [];
  let cursor: string | undefined;
  do {
    const page = await repo.findRunsForExport({
      ...params,
      ...(cursor ? { cursor } : {}),
    });
    collected.push(...page.runs);
    cursor = page.hasMore ? page.nextCursor : undefined;
  } while (cursor);
  return collected;
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  // The resilient wrapper strips the `langwatch_*` settings the repository
  // emits, matching the production factory — a bare client is rejected.
  repo = new SimulationClickHouseRepository(async () => {
    return createResilientClickHouseClient({ client: ch });
  });
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE simulation_runs DELETE WHERE TenantId IN ({tenantId:String}, {otherTenantId:String})`,
      query_params: { tenantId, otherTenantId },
    });
  }
  await stopTestContainers();
});

describe("scenario run export sweep (integration)", () => {
  describe("given runs spread across projects, sets, scenarios and dates", () => {
    const recentScenarioId = `scenario-recent-${nanoid()}`;
    const oldScenarioId = `scenario-old-${nanoid()}`;
    const targetSetId = `set-target-${nanoid()}`;
    const otherSetId = `set-other-${nanoid()}`;
    const archivedRunId = `run-archived-${nanoid()}`;
    const recentRunId = `run-recent-${nanoid()}`;
    const oldRunId = `run-old-${nanoid()}`;
    const otherSetRunId = `run-other-set-${nanoid()}`;
    const otherProjectRunId = `run-other-project-${nanoid()}`;

    beforeAll(async () => {
      const recent = new Date(now - DAY_MS);
      const old = new Date(now - 45 * DAY_MS);

      await insertRows(ch, [
        makeInsertRow({
          ScenarioRunId: recentRunId,
          ScenarioId: recentScenarioId,
          ScenarioSetId: targetSetId,
          StartedAt: recent,
          CreatedAt: recent,
          UpdatedAt: recent,
          FinishedAt: recent,
        }),
        makeInsertRow({
          ScenarioRunId: oldRunId,
          ScenarioId: oldScenarioId,
          ScenarioSetId: targetSetId,
          StartedAt: old,
          CreatedAt: old,
          UpdatedAt: old,
          FinishedAt: old,
        }),
        makeInsertRow({
          ScenarioRunId: otherSetRunId,
          ScenarioId: recentScenarioId,
          ScenarioSetId: otherSetId,
          StartedAt: recent,
          CreatedAt: recent,
          UpdatedAt: recent,
          FinishedAt: recent,
        }),
        makeInsertRow({
          ScenarioRunId: archivedRunId,
          ScenarioId: recentScenarioId,
          ScenarioSetId: targetSetId,
          StartedAt: recent,
          CreatedAt: recent,
          UpdatedAt: recent,
          FinishedAt: recent,
          ArchivedAt: recent,
        }),
        makeInsertRow({
          TenantId: otherTenantId,
          ScenarioRunId: otherProjectRunId,
          ScenarioId: recentScenarioId,
          ScenarioSetId: targetSetId,
          StartedAt: recent,
          CreatedAt: recent,
          UpdatedAt: recent,
          FinishedAt: recent,
        }),
      ]);
    }, 30_000);

    /** @scenario Export honours the selected date range */
    it("includes only runs started inside the range", async () => {
      const runs = await sweep({
        projectId: tenantId,
        startDate: now - 30 * DAY_MS,
        endDate: now,
        limit: 100,
      });

      const ids = runs.map((run) => run.scenarioRunId);
      expect(ids).toContain(recentRunId);
      expect(ids).not.toContain(oldRunId);
    });

    /** @scenario Export honours the scenario filter */
    it("includes only runs of the chosen scenario", async () => {
      const runs = await sweep({
        projectId: tenantId,
        scenarioId: oldScenarioId,
        limit: 100,
      });

      expect(runs.map((run) => run.scenarioRunId)).toEqual([oldRunId]);
    });

    /** @scenario Export from a scenario set is scoped to that set */
    it("includes only runs belonging to the chosen set", async () => {
      const runs = await sweep({
        projectId: tenantId,
        scenarioSetId: otherSetId,
        limit: 100,
      });

      expect(runs.map((run) => run.scenarioRunId)).toEqual([otherSetRunId]);
    });

    /** @scenario Archived runs are excluded */
    it("leaves archived runs out of both the sweep and its count", async () => {
      const runs = await sweep({ projectId: tenantId, limit: 100 });
      expect(runs.map((run) => run.scenarioRunId)).not.toContain(archivedRunId);

      // The count feeds X-Total-Runs and therefore the progress denominator, so
      // it has to agree with the sweep or the bar never reaches its total.
      const total = await repo.countRunsForExport({ projectId: tenantId });
      expect(total).toBe(runs.length);
    });

    /**
     * TenantId is the only id unique across projects — ScenarioRunId is not —
     * so this is the predicate that stops one customer's export containing
     * another's transcripts.
     *
     * @scenario Export is scoped to my own project
     */
    it("never returns another project's runs", async () => {
      const runs = await sweep({ projectId: tenantId, limit: 100 });
      expect(runs.map((run) => run.scenarioRunId)).not.toContain(
        otherProjectRunId,
      );

      const otherRuns = await sweep({ projectId: otherTenantId, limit: 100 });
      expect(otherRuns.map((run) => run.scenarioRunId)).toEqual([
        otherProjectRunId,
      ]);
    });
  });

  describe("given a run that stopped emitting events without finishing", () => {
    /**
     * STALLED is derived at read time from the gap since the last event, not
     * stored — so the export only agrees with the run history if it reads
     * through the same mapper. If it ever read the raw Status column instead,
     * this run would export as IN_PROGRESS while the screen said stalled.
     *
     * @scenario A run that stalled exports as stalled
     */
    it("exports it as stalled, the same as the run history shows it", async () => {
      const stalledRunId = `run-stalled-${nanoid()}`;
      const lastEvent = new Date(now - STALL_THRESHOLD_MS - 60_000);

      await insertRows(ch, [
        makeInsertRow({
          ScenarioRunId: stalledRunId,
          ScenarioSetId: `set-stalled-${nanoid()}`,
          Status: "IN_PROGRESS",
          Verdict: null,
          MetCriteria: [],
          UnmetCriteria: [],
          Reasoning: null,
          StartedAt: lastEvent,
          CreatedAt: lastEvent,
          UpdatedAt: lastEvent,
          FinishedAt: null,
        }),
      ]);

      const runs = await sweep({ projectId: tenantId, limit: 100 });
      const stalled = runs.find((run) => run.scenarioRunId === stalledRunId);

      expect(stalled).toBeDefined();
      expect(stalled!.status).toBe(ScenarioRunStatus.STALLED);
    });
  });
});
