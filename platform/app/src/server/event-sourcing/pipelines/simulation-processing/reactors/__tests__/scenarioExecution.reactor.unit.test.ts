/**
 * @vitest-environment node
 *
 * The queued event is the only place a run's resolved parameter values cross
 * into execution: the pool job is otherwise built from fold state, which does
 * not carry them. Miss this hop and the whole feature is a silent no-op: the
 * values are recorded, the run looks right, and the target under test never
 * sees one.
 */

import { describe, expect, it, vi } from "vitest";
import type {
  ExecutionJobData,
  ScenarioExecutionPool,
} from "../../../../../scenarios/execution/execution-pool";
import { createTenantId } from "../../../../domain/tenantId";
import type { SimulationRunStateData } from "../../projections/simulationRunState.foldProjection";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
} from "../../schemas/constants";
import type { SimulationRunQueuedEvent } from "../../schemas/events";
import { createScenarioExecutionReactor } from "../scenarioExecution.reactor";

const TEST_TENANT_ID = createTenantId("proj_1");

function createFoldState(
  overrides: Partial<SimulationRunStateData> = {},
): SimulationRunStateData {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: "QUEUED",
    Name: "Refund flow",
    Description: null,
    Metadata: null,
    Messages: [],
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
    TraceMetrics: {},
    StartedAt: null,
    QueuedAt: 1000,
    CreatedAt: 1000,
    UpdatedAt: 1000,
    FinishedAt: null,
    ArchivedAt: null,
    CancellationRequestedAt: null,
    LastSnapshotOccurredAt: 0,
    LastEventOccurredAt: 0,
    ...overrides,
  } as SimulationRunStateData;
}

function createQueuedEvent(
  metadata?: Record<string, unknown>,
): SimulationRunQueuedEvent {
  return {
    id: "event-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TEST_TENANT_ID,
    createdAt: 1000,
    occurredAt: 1000,
    type: SIMULATION_RUN_EVENT_TYPES.QUEUED,
    version: SIMULATION_EVENT_VERSIONS.QUEUED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      batchRunId: "batch-1",
      scenarioSetId: "set-1",
      ...(metadata ? { metadata } : {}),
      target: { type: "http", referenceId: "agent_1" },
    },
  } as SimulationRunQueuedEvent;
}

function createPool() {
  const submit = vi.fn();
  return {
    pool: { submit } as unknown as ScenarioExecutionPool,
    submit,
    submitted: (): ExecutionJobData => submit.mock.calls[0]?.[0],
  };
}

async function handleQueued(metadata?: Record<string, unknown>) {
  const { pool, submit, submitted } = createPool();
  const handle = createScenarioExecutionReactor();
  handle.setPool(pool);

  await handle.reactor.handle(createQueuedEvent(metadata), {
    tenantId: TEST_TENANT_ID,
    aggregateId: "run-1",
    foldState: createFoldState(),
  });

  return { submit, submitted };
}

describe("scenarioExecution reactor", () => {
  describe("when the queued event records the run's parameters", () => {
    /** @scenario "Resolved parameter values are recorded on the run and shown in the run detail drawer" */
    it("forwards them onto the pool job", async () => {
      const { submit, submitted } = await handleQueued({
        langwatch: { targetReferenceId: "agent_1" },
        parameters: { account_tier: "platinum", seats: 12, trial: false },
      });

      expect(submit).toHaveBeenCalledTimes(1);
      expect(submitted().parameters).toEqual({
        account_tier: "platinum",
        seats: 12,
        trial: false,
      });
    });
  });

  describe("when the queued event records no parameters", () => {
    it("submits the job without any", async () => {
      const { submitted } = await handleQueued({
        langwatch: { targetReferenceId: "agent_1" },
      });

      expect(submitted().parameters).toBeUndefined();
    });

    it("submits the job without any when there is no metadata at all", async () => {
      const { submitted } = await handleQueued();

      expect(submitted().parameters).toBeUndefined();
    });
  });

  describe("when the recorded parameters are a shape this version cannot read", () => {
    it("runs the scenario without them rather than dropping the run", async () => {
      const { submit, submitted } = await handleQueued({
        parameters: { "not a name": "value" },
      });

      expect(submit).toHaveBeenCalledTimes(1);
      expect(submitted().parameters).toBeUndefined();
    });

    it("drops the whole record when only one name is unreadable", async () => {
      // All or nothing on purpose. Half a record is the worse failure: the run
      // would go ahead against a value the caller never chose, and read as an
      // agent that answered the wrong question. Nothing at all surfaces as the
      // missing-value error the scenario's own text raises.
      const { submit, submitted } = await handleQueued({
        parameters: { region: "eu-central", "not a name": "value" },
      });

      expect(submit).toHaveBeenCalledTimes(1);
      expect(submitted().parameters).toBeUndefined();
    });
  });
});
