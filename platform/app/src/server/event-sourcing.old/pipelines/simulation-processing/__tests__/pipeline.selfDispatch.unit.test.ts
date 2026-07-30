import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { BroadcastService } from "~/server/app-layer/broadcast/broadcast.service";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { Event } from "../../../domain/types";
import { EventSourcing } from "../../../eventSourcing";
import type { FoldProjectionStore } from "../../../projections/foldProjection.types";
import { createMockEventStore } from "../../../services/__tests__/testHelpers";
import { createBillingReportingPipeline } from "../../billing-reporting/pipeline";
import { createSimulationProcessingPipeline } from "../pipeline";
import {
  RUN_METRICS_INTENT_TYPES,
  RUN_METRICS_PROCESS_NAME,
} from "../process-manager/runMetricsProcess.types";
import type { SimulationRunStateData } from "../projections/simulationRunState.foldProjection";

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
    cancellationPublisher: null,
    deriveScenarioRoleMetrics: async () => ({
      scenarioRoleCosts: {},
      scenarioRoleLatencies: {},
    }),
    isSaas: false,
    commands: commandBus,
    scenarioExecutionDispatch: {
      executeRun: async () => void 0,
      readRunStatus: async () => null,
      emitFailure: async () => void 0,
      lookupScenario: async () => null,
    },
  });
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
      // The pipeline also mounts the billing poke, which binds a port into
      // billing-reporting. Register that pipeline too, exactly as the
      // composition root does — otherwise the assertion below would fail on a
      // cross-pipeline port rather than on this pipeline's self-dispatch.
      es.register(
        createBillingReportingPipeline({
          organizations: {} as never,
          billingCheckpoints: {} as never,
          getUsageReportingService: () => undefined,
          queryBillableEventsTotal: (async () => 0) as never,
          commands: es.commandBus,
          // Stubbed, not omitted: this test is about port binding, but `sweep`
          // is required so that forgetting it in the composition root is a
          // compile error rather than silently unbilled revenue.
          sweep: {
            listOrganizationsToReport: async () => [],
            deleteDispatchedBefore: async () => 0,
          },
        }),
      );

      // The whole registration completed with the port already bound, which is
      // the case a Deferred needed a resolve() step for.
      expect(() => es.commandBus.assertPortsResolvable()).not.toThrow();

      // The `runMetrics` process asks for a finished run's cost through the
      // same port. Run its intent executor directly: it is the seam the outbox
      // calls, and it is the only thing in the process that touches the bus.
      const runMetrics = definition.processManagers.get(
        RUN_METRICS_PROCESS_NAME,
      );
      expect(runMetrics).toBeDefined();

      await runMetrics?.config.intents[
        RUN_METRICS_INTENT_TYPES.COMPUTE_RUN_METRICS
      ]?.run(
        { tenantId: "project-1", scenarioRunId: "run-1" },
        {
          processName: RUN_METRICS_PROCESS_NAME,
          projectId: "project-1",
          processKey: "run-1",
          tenantId: "project-1",
          messageKey: "measure:run-1",
          attempt: 1,
        },
      );

      expect(queue.send).toHaveBeenCalledTimes(1);
      expect(queue.send.mock.calls[0]?.[0]).toMatchObject({
        __pipelineName: "simulation_processing",
        __jobName: "computeRunMetrics",
        scenarioRunId: "run-1",
      });
    });
  });
});
