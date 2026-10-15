/**
 * The scenario-run fold's read-back is bounded by start time and still finds
 * a run the window misses.
 *
 * @see modules/scenario/specs/simulation-run-state-read-window.feature
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { createTenantId, FoldProjectionExecutor, readWindowAround } from "@langwatch/eventing";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationRunFinishedEvent,
} from "@langwatch/scenario-contract";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SimulationRunStateStore } from "../../../eventing/simulation-eventing.store.ts";
import {
  SIMULATION_RUN_STATE_READ_WINDOW_MS,
  type SimulationRunState,
  SimulationRunStateFoldProjection,
} from "../../../eventing/simulation-run-state.projection.ts";
import { ClickHouseSimulationRunStateRepository } from "../clickhouse.simulation-run-state.repository.ts";
import type { SimulationEventingClickHouseResolver } from "../clickhouse.simulation-session.store.ts";
import { scenarioClickHouseOver } from "./simulation-clickhouse-rows.fixture.ts";

const configuredClickHouseUrl = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
const databaseUrl = configuredClickHouseUrl ? new URL(configuredClickHouseUrl) : null;
if (databaseUrl && !process.env.TEST_CLICKHOUSE_URL) {
  databaseUrl.pathname = "/test_langwatch";
}

const DAY_MS = 24 * 60 * 60 * 1000;
const tenantId = `test-sim-read-window-${nanoid()}`;
const context = { tenantId: createTenantId(tenantId) };
const now = Date.now();
const windowAroundNow = readWindowAround({
  anchorMs: now,
  widthMs: SIMULATION_RUN_STATE_READ_WINDOW_MS,
});

let ch: ClickHouseClient | undefined;
/** The query id the next read runs under, so system.query_log can be asked about it. */
let nextQueryId: string | undefined;
let resolveClient: SimulationEventingClickHouseResolver;
let repo: ClickHouseSimulationRunStateRepository<SimulationRunState>;

beforeAll(() => {
  if (!databaseUrl) return;
  const client = createClient({
    url: databaseUrl,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  ch = client;
  resolveClient = scenarioClickHouseOver({
    query: (input) => client.query({ ...input, query_id: nextQueryId }),
    insert: (input) => client.insert(input),
    command: (input) => client.command(input),
  });
  repo = ClickHouseSimulationRunStateRepository.create<SimulationRunState>({
    resolveClient,
    defaultRetentionDays: () => 30,
  });
});

afterAll(async () => {
  if (!ch) return;
  await ch.exec({
    query: `ALTER TABLE simulation_runs DELETE WHERE TenantId = {tenantId:String}`,
    query_params: { tenantId },
  });
  await ch.close();
  ch = undefined;
});

/** A run's stored state, started at `startedAt` and last written at `updatedAt`. */
function runState({
  scenarioRunId,
  startedAt,
  updatedAt,
  name = "Read-window run",
}: {
  scenarioRunId: string;
  startedAt: number;
  updatedAt: number;
  name?: string;
}): SimulationRunState["data"] {
  return {
    ScenarioRunId: scenarioRunId,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: `batch-${nanoid()}`,
    ScenarioSetId: `set-${nanoid()}`,
    Status: "IN_PROGRESS",
    Name: name,
    Description: null,
    Metadata: null,
    Messages: [],
    TraceIds: [],
    Verdict: null,
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    InconclusiveCriteria: [],
    Criteria: [],
    Error: null,
    Evaluations: [],
    DurationMs: null,
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    TraceMetrics: {},
    StartedAt: startedAt,
    QueuedAt: null,
    CreatedAt: startedAt,
    UpdatedAt: updatedAt,
    FinishedAt: null,
    ArchivedAt: null,
    CancellationRequestedAt: null,
    LastSnapshotOccurredAt: 0,
    LastEventOccurredAt: startedAt,
  };
}

async function store(data: SimulationRunState["data"]): Promise<void> {
  await repo.storeProjection(
    {
      id: data.ScenarioRunId,
      aggregateId: data.ScenarioRunId,
      tenantId: createTenantId(tenantId),
      version: "2026-01-01",
      data,
    },
    context,
  );
}

/** Stores the runs in one insert, so they land in one part. */
async function storeTogether(runs: SimulationRunState["data"][]): Promise<void> {
  await repo.storeProjectionBatch(
    runs.map((data) => ({
      id: data.ScenarioRunId,
      aggregateId: data.ScenarioRunId,
      tenantId: createTenantId(tenantId),
      version: "2026-01-01",
      data,
    })),
    context,
  );
}

function finished(scenarioRunId: string): SimulationRunFinishedEvent {
  return {
    id: `event-finished-${nanoid()}`,
    aggregateId: scenarioRunId,
    aggregateType: "simulation_run",
    tenantId: createTenantId(tenantId),
    createdAt: now,
    occurredAt: now,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
    data: {
      scenarioRunId,
      status: "SUCCESS",
      results: {
        verdict: "success",
        reasoning: "All criteria met",
        metCriteria: ["Refunds the second charge"],
        unmetCriteria: [],
      },
    },
  };
}

/**
 * The parts a query had to search, from system.query_log: marks counted after
 * partition pruning, before the key and skip indexes. Each part here holds one
 * mark, and the row read and the latest-version lookup each count their own.
 */
async function partsSearched(queryId: string): Promise<number> {
  await ch!.command({ query: "SYSTEM FLUSH LOGS" });
  const result = await ch!.query({
    query: `
      SELECT ProfileEvents['SelectedMarksTotal'] AS parts
      FROM system.query_log
      WHERE query_id = {queryId:String} AND type = 'QueryFinish'
      ORDER BY event_time_microseconds DESC
      LIMIT 1
    `,
    query_params: { queryId },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ parts: string | number }>();
  return Number(rows[0]?.parts ?? Number.NaN);
}

describe.skipIf(databaseUrl === null)("the scenario-run state read window", () => {
  describe("when a run started inside the read window", () => {
    /** @scenario "A run that started inside the window is found by the bounded read" */
    it("returns the run's latest state from the bounded read", async () => {
      const scenarioRunId = `run-inside-${nanoid()}`;
      await store(runState({ scenarioRunId, startedAt: now - DAY_MS, updatedAt: now - DAY_MS }));
      await store({
        ...runState({ scenarioRunId, startedAt: now - DAY_MS, updatedAt: now }),
        Name: "Latest version",
      });

      const projection = await repo.findProjection(scenarioRunId, {
        ...context,
        readWindow: windowAroundNow,
      });

      expect(projection?.data.ScenarioRunId).toBe(scenarioRunId);
      expect(projection?.data.Name).toBe("Latest version");
    });
  });

  describe("when the run started weeks before the event being folded", () => {
    /** @scenario "A run that started outside the window is still found by the fold" */
    it("misses in the window, reads the run again unwindowed, and folds onto it", async () => {
      const scenarioRunId = `run-outside-${nanoid()}`;
      const startedAt = now - 42 * DAY_MS;
      const stored = runState({ scenarioRunId, startedAt, updatedAt: startedAt });
      await store(stored);

      const windowed = await repo.findProjection(scenarioRunId, {
        ...context,
        readWindow: windowAroundNow,
      });
      const projection = SimulationRunStateFoldProjection.create({
        store: SimulationRunStateStore.create({
          type: "clickhouse",
          resolveClient,
          defaultRetentionDays: () => 30,
        }).createFoldStore(),
      });
      const folded = await new FoldProjectionExecutor().execute(
        projection,
        finished(scenarioRunId),
        { aggregateId: scenarioRunId, tenantId: createTenantId(tenantId) },
      );
      const reread = await repo.findProjection(scenarioRunId, context);

      expect(windowed).toBeNull();
      expect(folded.ScenarioId).toBe(stored.ScenarioId);
      expect(folded.StartedAt).toBe(startedAt);
      expect(folded.Status).toBe("SUCCESS");
      expect(reread?.data.ScenarioId).toBe(stored.ScenarioId);
      expect(reread?.data.Status).toBe("SUCCESS");
    });
  });

  describe("when the run's latest version started just outside the window", () => {
    /** @scenario "A run whose start moved out of the window reads as a miss, never as an older version" */
    it("answers nothing from the bounded read, and the latest version unbounded", async () => {
      const scenarioRunId = `run-moved-${nanoid()}`;
      await store({
        ...runState({ scenarioRunId, startedAt: windowAroundNow.fromMs + DAY_MS, updatedAt: now }),
        Name: "Older version inside the window",
      });
      await store({
        ...runState({
          scenarioRunId,
          startedAt: windowAroundNow.fromMs - DAY_MS,
          updatedAt: now + 1_000,
        }),
        Name: "Latest version outside the window",
      });

      const windowed = await repo.findProjection(scenarioRunId, {
        ...context,
        readWindow: windowAroundNow,
      });
      const unbounded = await repo.findProjection(scenarioRunId, context);

      expect(windowed).toBeNull();
      expect(unbounded?.data.Name).toBe("Latest version outside the window");
    });
  });

  describe("when the tenant's runs started across many weeks", () => {
    /** @scenario "The bounded read searches fewer parts than an unbounded read" */
    it("searches the weeks around the event, not every week the tenant ran", async () => {
      const scenarioRunId = `run-m-parts-${nanoid()}`;
      // One part per week holding neighbours on both sides of the run's sort
      // key, so every part spans the run's key and only the time bound skips it.
      for (let week = 1; week <= 8; week++) {
        const startedAt = now - week * 7 * DAY_MS;
        await storeTogether([
          runState({ scenarioRunId: `run-a-${nanoid()}`, startedAt, updatedAt: startedAt }),
          runState({ scenarioRunId: `run-z-${nanoid()}`, startedAt, updatedAt: startedAt }),
        ]);
      }
      await store(runState({ scenarioRunId, startedAt: now - DAY_MS, updatedAt: now }));

      const windowedQueryId = `read-window-bounded-${nanoid()}`;
      nextQueryId = windowedQueryId;
      const windowed = await repo.findProjection(scenarioRunId, {
        ...context,
        readWindow: windowAroundNow,
      });
      const unboundedQueryId = `read-window-unbounded-${nanoid()}`;
      nextQueryId = unboundedQueryId;
      const unbounded = await repo.findProjection(scenarioRunId, context);
      nextQueryId = void 0;

      const windowedParts = await partsSearched(windowedQueryId);
      const unboundedParts = await partsSearched(unboundedQueryId);

      expect(windowed?.data.ScenarioRunId).toBe(scenarioRunId);
      expect(unbounded?.data.ScenarioRunId).toBe(scenarioRunId);
      // Weeks 3 to 8 back lie outside both bounds: six parts, counted by both scopes.
      expect(unboundedParts).toBeGreaterThanOrEqual(windowedParts + 12);
    });
  });
});
