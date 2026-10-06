/**
 * @vitest-environment node
 * @unit
 * A finished run's metrics pulled per trace: the real subscriber, the real compute
 * handler and the real run fold, with only the trace summary read scripted.
 */
import { createTenantId, type FoldProjectionStore } from "@langwatch/eventing";
import {
  type ComputeRunMetricsCommandData,
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_COMMAND_TYPES,
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationProcessingEvent,
  type SimulationRunFinishedEvent,
} from "@langwatch/scenario-contract";
import type { TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ComputeRunMetricsCommand } from "../compute-run-metrics.commands.ts";
import {
  type SimulationRunStateData,
  SimulationRunStateFoldProjection,
} from "../simulation-run-state.projection.ts";
import { createTraceMetricsSyncSubscriber } from "../trace-metrics-sync.subscriber.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const TENANT = "project-1";
const CONTEXT = { tenantId: TENANT, aggregateId: "run-1", state: undefined };
const COST_OF: Record<string, number> = { "trace-1": 0.003, "trace-2": 0.002 };

const noopStore: FoldProjectionStore<SimulationRunStateData> = {
  store: async () => {},
  get: async () => ({ kind: "empty" as const }),
};
const fold = SimulationRunStateFoldProjection.create({ store: noopStore });

function finishedEvent(traceIds: string[]): SimulationRunFinishedEvent {
  return {
    id: "evt-finished",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: createTenantId(TENANT),
    createdAt: 5_000,
    occurredAt: 5_000,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    data: { scenarioRunId: "run-1", traceIds },
  };
}

/** The run's metrics pipeline: the compute handler's events folded into the run's state. */
function metricsPipeline() {
  let state = fold.init();
  const dispatched: ComputeRunMetricsCommandData[] = [];
  const idempotencyKeys: string[] = [];
  const handler = ComputeRunMetricsCommand.create({
    traceSummaryStore: {
      get: async (traceId) => ({
        kind: "folded" as const,
        state: { spanCount: 1, totalCost: COST_OF[traceId] ?? null } as TraceSummaryData,
      }),
    },
    scheduleRetry: async () => {},
    deriveScenarioRoleMetrics: async () => ({
      scenarioRoleCosts: { Agent: 0.001 },
      scenarioRoleLatencies: { Agent: 1_000 },
    }),
  });
  const computeRunMetrics = async (data: ComputeRunMetricsCommandData): Promise<void> => {
    dispatched.push(data);
    const events: SimulationProcessingEvent[] = await handler.handle({
      tenantId: createTenantId(data.tenantId),
      aggregateId: data.scenarioRunId,
      type: SIMULATION_RUN_COMMAND_TYPES.COMPUTE_METRICS,
      data,
    });
    for (const event of events) {
      if (event.idempotencyKey) idempotencyKeys.push(event.idempotencyKey);
      state = fold.apply(state, event);
    }
  };
  return {
    dispatched,
    idempotencyKeys,
    computeRunMetrics,
    state: () => state,
    apply: (event: SimulationProcessingEvent) => {
      state = fold.apply(state, event);
    },
  };
}

describe("a run finishing with traces whose metrics are partly applied", () => {
  /** @scenario "Simulation-side subscriber dispatches pull-based computation on RunFinished" */
  it("dispatches a pull for both traces and folds the re-processed one onto its own entry", async () => {
    const pipeline = metricsPipeline();
    await pipeline.computeRunMetrics({
      tenantId: TENANT,
      scenarioRunId: "run-1",
      traceId: "trace-1",
      retryCount: 0,
      occurredAt: 4_000,
      metrics: { totalCost: 0.003, roleCosts: { Agent: 0.003 }, roleLatencies: { Agent: 1_000 } },
    });
    pipeline.dispatched.length = 0;
    const subscriber = createTraceMetricsSyncSubscriber({
      computeRunMetrics: pipeline.computeRunMetrics,
    });

    await subscriber.handler(finishedEvent(["trace-1", "trace-2"]), CONTEXT);

    expect(
      pipeline.dispatched.map(({ traceId, metrics }) => ({ traceId, pull: !metrics })),
    ).toEqual([
      { traceId: "trace-1", pull: true },
      { traceId: "trace-2", pull: true },
    ]);
    expect(new Set(pipeline.idempotencyKeys).size).toBe(2);
    expect(Object.keys(pipeline.state().TraceMetrics).toSorted()).toEqual(["trace-1", "trace-2"]);
    expect(pipeline.state().TotalCost).toBeCloseTo(0.005);
  });
});

describe("a run finishing with no trace ids", () => {
  /** @scenario "Run with no trace IDs leaves metrics empty" */
  it("triggers no metrics computation and leaves the run's cost null", async () => {
    const pipeline = metricsPipeline();
    const event = finishedEvent([]);
    const subscriber = createTraceMetricsSyncSubscriber({
      computeRunMetrics: pipeline.computeRunMetrics,
    });

    await subscriber.handler(event, CONTEXT);
    pipeline.apply(event);

    expect(pipeline.dispatched).toEqual([]);
    expect(pipeline.state().TotalCost).toBeNull();
    expect(pipeline.state().TraceMetrics).toEqual({});
  });
});
