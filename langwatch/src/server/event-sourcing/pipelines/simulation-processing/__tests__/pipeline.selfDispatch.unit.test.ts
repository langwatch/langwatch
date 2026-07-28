import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { createTenantId } from "../../../domain/tenantId";
import type { Event } from "../../../domain/types";
import { EventSourcing } from "../../../eventSourcing";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import { createMockEventStore } from "../../../services/__tests__/testHelpers";
import { createSimulationProcessingPipeline } from "../pipeline";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../schemas/events";

const TENANT_ID = createTenantId("project-1");

/** A real, total store — nothing here is a stub with a green typecheck. */
function memoryFoldStore<State>(): FoldProjectionStore<State> {
  const rows = new Map<string, State>();
  return {
    async store(state, context) {
      rows.set(context.aggregateId, state);
    },
    async get(aggregateId) {
      return rows.get(aggregateId) ?? null;
    },
  };
}

function mockGlobalQueue() {
  return {
    send: vi.fn().mockResolvedValue(void 0),
    sendBatch: vi.fn().mockResolvedValue(void 0),
    close: vi.fn().mockResolvedValue(void 0),
    waitUntilReady: vi.fn().mockResolvedValue(void 0),
  };
}

function buildPipeline(commandBus: EventSourcing["commandBus"]) {
  return createSimulationProcessingPipeline({
    simulationRunStore: memoryFoldStore<SimulationRunStateData>(),
    traceSummaryStore: memoryFoldStore<TraceSummaryData>(),
    broadcast: new BroadcastService(null),
    hasRedis: false,
    cancellationPublisher: null,
    deriveScenarioRoleMetrics: async () => ({
      scenarioRoleCosts: {},
      scenarioRoleLatencies: {},
    }),
    scheduleComputeRunMetricsRetry: async () => void 0,
    commands: commandBus,
    scenarioExecutionDispatch: {
      executeRun: async () => void 0,
      readRunStatus: async () => null,
      emitFailure: async () => void 0,
      lookupScenario: async () => null,
    },
  });
}

function finishedEvent(): SimulationProcessingEvent {
  return {
    id: "evt-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: TENANT_ID,
    createdAt: 2000,
    occurredAt: 2000,
    type: "lw.simulation_run.finished",
    version: "2026-02-01",
    data: { scenarioRunId: "run-1", results: { verdict: "success" } },
  } as SimulationProcessingEvent;
}

function foldState(): SimulationRunStateData {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    BatchTotal: 0,
    Status: "SUCCESS",
    Name: "test",
    Description: null,
    Metadata: null,
    Messages: [],
    TraceIds: ["trace-1"],
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
    StartedAt: 1000,
    QueuedAt: null,
    CreatedAt: 1000,
    UpdatedAt: 2000,
    FinishedAt: 3000,
    ArchivedAt: null,
    CancellationRequestedAt: null,
    LastSnapshotOccurredAt: 1000,
    LastEventOccurredAt: 0,
  };
}

describe("simulation_processing self-dispatch", () => {
  beforeEach(() => {
    vi.stubEnv("BUILD_TIME", "");
    vi.stubEnv("NODE_ENV", "test");
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  describe("when a pipeline binds a port for a command it registers itself", () => {
    /** @scenario A pipeline dispatching into its own command needs no late binding */
    it("dispatches computeRunMetrics through the bus onto its own queue", async () => {
      const queue = mockGlobalQueue();
      const es = EventSourcing.createForTesting({
        eventStore: createMockEventStore<Event>(),
        globalQueue: queue,
      });

      // The port is bound INSIDE the factory, before the pipeline exists.
      const definition = buildPipeline(es.commandBus);
      es.register(definition);

      // The whole registration completed with the port already bound, which is
      // the case a Deferred needed a resolve() step for.
      expect(() => es.commandBus.assertPortsResolvable()).not.toThrow();

      const traceMetricsSync = definition.foldReactors.get("traceMetricsSync");
      expect(traceMetricsSync).toBeDefined();

      await traceMetricsSync?.definition.handle(finishedEvent(), {
        tenantId: TENANT_ID,
        aggregateId: "run-1",
        foldState: foldState(),
      });

      expect(queue.send).toHaveBeenCalledTimes(1);
      expect(queue.send.mock.calls[0]?.[0]).toMatchObject({
        __pipelineName: "simulation_processing",
        __jobName: "computeRunMetrics",
        scenarioRunId: "run-1",
        traceId: "trace-1",
      });
    });
  });
});
