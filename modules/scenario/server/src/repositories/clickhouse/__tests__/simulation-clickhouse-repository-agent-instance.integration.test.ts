/**
 * The instance that served a finished run, as the run detail reads it back:
 * the fold writes it into the reserved langwatch namespace, the state
 * repository stores that row, and the run read is what a drawer shows.
 *
 * @see specs/scenarios/served-agent-instance-on-runs.feature
 */

import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { createTenantId } from "@langwatch/eventing";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  SimulationRunStateFoldProjection,
  type SimulationRunState,
} from "../../../projections/simulation-run-state.projection.ts";
import { SimulationWindowedReadPort } from "../../../ports/simulation-windowed-read.port.ts";
import { ClickHouseSimulationRunStateRepository } from "../clickhouse.simulation-run-state.repository.ts";
import { SimulationClickHouseRepository } from "../simulation-clickhouse.repository.ts";

/** The repository's own hint window, derived the way production derives it. */
class HintWindowedRead extends SimulationWindowedReadPort {
  async query<Result>(input: {
    hintMs: number | null;
    windowMs?: number;
    run: (
      window: {
        fromMs: number;
        toMs: number;
        params: { fromMs: number; toMs: number };
        sqlFor: (column: string) => string;
      } | null,
    ) => Promise<Result>;
  }): Promise<Result> {
    if (input.hintMs === null || input.windowMs === undefined) return input.run(null);
    const fromMs = input.hintMs - input.windowMs;
    const toMs = input.hintMs + input.windowMs;
    return input.run({
      fromMs,
      toMs,
      params: { fromMs, toMs },
      sqlFor: (column) => `AND ${column} >= {fromMs:Int64} AND ${column} <= {toMs:Int64}`,
    });
  }
}

const configuredClickHouseUrl = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
const databaseUrl = configuredClickHouseUrl ? new URL(configuredClickHouseUrl) : null;
if (databaseUrl && !process.env.TEST_CLICKHOUSE_URL) {
  databaseUrl.pathname = "/test_langwatch";
}

const tenantId = `test-served-instance-${nanoid()}`;
const now = Date.now();
const AGENT_INSTANCE = { hostname: "worker-1", label: "blue" };

let ch: ClickHouseClient | undefined;
let stateRepository: ClickHouseSimulationRunStateRepository<SimulationRunState>;
let runs: SimulationClickHouseRepository;

/** A run that was queued, finished, and then had its instance recorded. */
function finishedRunWithInstance(scenarioRunId: string): SimulationRunState["data"] {
  return {
    ScenarioRunId: scenarioRunId,
    ScenarioId: `scenario-${nanoid()}`,
    BatchRunId: `batch-${nanoid()}`,
    ScenarioSetId: `set-${nanoid()}`,
    Status: "SUCCESS",
    Name: "Refund flow",
    Description: null,
    Metadata: SimulationRunStateFoldProjection.withAgentInstance({
      metadata: JSON.stringify({
        langwatch: { targetReferenceId: "prod-agent", targetType: "connected" },
      }),
      agentInstance: AGENT_INSTANCE,
    }),
    Messages: [],
    TraceIds: [],
    Verdict: "success",
    Reasoning: "All criteria met",
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: 1500,
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    TraceMetrics: {},
    StartedAt: now - 5_000,
    QueuedAt: now - 6_000,
    CreatedAt: now - 6_000,
    UpdatedAt: now,
    FinishedAt: now,
    ArchivedAt: null,
    CancellationRequestedAt: null,
    LastSnapshotOccurredAt: 0,
    LastEventOccurredAt: 0,
  } as SimulationRunState["data"];
}

const integration = describe.skipIf(databaseUrl === null);

beforeAll(() => {
  if (!databaseUrl) return;
  ch = createClient({
    url: databaseUrl,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  stateRepository = ClickHouseSimulationRunStateRepository.create<SimulationRunState>({
    resolveClient: async () => ch!,
    defaultRetentionDays: 30,
  });
  runs = SimulationClickHouseRepository.create(async () => ch!, new HintWindowedRead());
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

integration("given a run that was queued, finished and had its instance recorded", () => {
  describe("when the run is stored and read back", () => {
    /** @scenario A finished run stores the instance that served it */
    it("carries the instance under the reserved langwatch namespace, beside what was already there", async () => {
      const scenarioRunId = `run-served-${nanoid()}`;
      await stateRepository.storeProjection(
        {
          id: `proj-${nanoid()}`,
          aggregateId: scenarioRunId,
          tenantId: createTenantId(tenantId),
          version: new Date(now).toISOString().slice(0, 10),
          data: finishedRunWithInstance(scenarioRunId),
        } as unknown as SimulationRunState,
        { tenantId: createTenantId(tenantId) },
      );

      const run = await runs.findScenarioRunData({
        projectId: tenantId,
        scenarioRunId,
      });

      expect(run?.status).toBe("SUCCESS");
      expect(run?.metadata).toMatchObject({
        langwatch: {
          targetReferenceId: "prod-agent",
          targetType: "connected",
          agentInstance: AGENT_INSTANCE,
        },
      });
    });
  });
});
