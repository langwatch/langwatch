/**
 * A stored projection must be readable by the very next fold, without waiting for the write to
 * become eventually visible.
 * @see specs/scenarios/event-driven-execution-prep.feature
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { createTenantId } from "@langwatch/eventing";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { SimulationRunState } from "../../../eventing/simulation-run-state.projection.ts";
import { ClickHouseSimulationRunStateRepository } from "../clickhouse.simulation-run-state.repository.ts";

const configuredClickHouseUrl = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
const databaseUrl = configuredClickHouseUrl ? new URL(configuredClickHouseUrl) : null;
if (databaseUrl && !process.env.TEST_CLICKHOUSE_URL) {
  databaseUrl.pathname = "/test_langwatch";
}

const tenantId = `test-sim-proj-${nanoid()}`;
const now = Date.now();

let ch: ClickHouseClient | undefined;
let repo: ClickHouseSimulationRunStateRepository<SimulationRunState>;

beforeAll(() => {
  if (!databaseUrl) return;
  ch = createClient({
    url: databaseUrl,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  repo = ClickHouseSimulationRunStateRepository.create<SimulationRunState>({
    resolveClient: async () => ch!,
    defaultRetentionDays: 30,
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

/** The state a started event folds to, with the run's identity on it. */
function makeStartedState(scenarioRunId: string): SimulationRunState["data"] {
  return {
    ScenarioRunId: scenarioRunId,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: `batch-${nanoid()}`,
    ScenarioSetId: `set-${nanoid()}`,
    Status: "IN_PROGRESS",
    Name: "Started run",
    Description: null,
    Metadata: null,
    Messages: [],
    TraceIds: [],
    Verdict: null,
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    InconclusiveCriteria: [],
    Error: null,
    Evaluations: [],
    DurationMs: null,
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    TraceMetrics: {},
    StartedAt: now,
    QueuedAt: null,
    CreatedAt: now,
    UpdatedAt: now,
    FinishedAt: null,
    ArchivedAt: null,
    CancellationRequestedAt: null,
    LastSnapshotOccurredAt: 0,
    LastEventOccurredAt: 0,
  };
}

describe.skipIf(databaseUrl === null)(
  "ClickHouseSimulationRunStateRepository.storeProjection",
  () => {
    const context = { tenantId: createTenantId(tenantId) };

    describe("when the next event folds right after a projection is stored", () => {
      /** @scenario "A stored projection is readable by the next event's fold" */
      it("reads the stored projection back without waiting", async () => {
        const scenarioRunId = `run-readback-${nanoid()}`;
        const data = makeStartedState(scenarioRunId);

        await repo.storeProjection(
          {
            id: `proj-${nanoid()}`,
            aggregateId: scenarioRunId,
            tenantId: createTenantId(tenantId),
            version: new Date(now).toISOString().slice(0, 10),
            data,
          },
          context,
        );

        const projection = await repo.findProjection(scenarioRunId, context);

        expect(projection).not.toBeNull();
        expect(projection!.data.ScenarioId).toBe(data.ScenarioId);
        expect(projection!.data.BatchRunId).toBe(data.BatchRunId);
        expect(projection!.data.ScenarioSetId).toBe(data.ScenarioSetId);
      });
    });

    describe("when a finished run names a criterion the judge could not decide", () => {
      /** @scenario "Inconclusive criteria survive the run row" */
      it("reads it back apart from the failed ones, and a run without any reads none", async () => {
        const store = async (data: SimulationRunState["data"]) =>
          repo.storeProjection(
            {
              id: `proj-${nanoid()}`,
              aggregateId: data.ScenarioRunId,
              tenantId: createTenantId(tenantId),
              version: new Date(now).toISOString().slice(0, 10),
              data,
            },
            context,
          );
        const scenarioRunId = `run-inconclusive-${nanoid()}`;
        const plainRunId = `run-plain-criteria-${nanoid()}`;
        await store({
          ...makeStartedState(scenarioRunId),
          Status: "FAILURE",
          Verdict: "failure",
          FinishedAt: now,
          MetCriteria: ["stays polite"],
          UnmetCriteria: ["names the refund window", "opens a ticket"],
          InconclusiveCriteria: ["opens a ticket"],
        });
        await store(makeStartedState(plainRunId));

        const projection = await repo.findProjection(scenarioRunId, context);
        const plain = await repo.findProjection(plainRunId, context);

        expect(projection!.data.UnmetCriteria).toEqual([
          "names the refund window",
          "opens a ticket",
        ]);
        expect(projection!.data.InconclusiveCriteria).toEqual(["opens a ticket"]);
        expect(plain!.data.InconclusiveCriteria).toEqual([]);
      });
    });
  },
);
