/**
 * Simulation pipeline wiring: validates command instances from composition
 * root are correctly registered (mismatch only shows on boot).
 */

import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import {
  SCENARIO_EVALUATIONS_JOB,
  type RunScenarioEvaluationsDeps,
} from "@langwatch/scenario-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { SPAN_RECEIVED_EVENT_TYPE, type TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { ComputeRunMetricsCommand } from "../compute-run-metrics.commands.ts";
import { FinishRunCommand } from "../finish-run.commands.ts";
import { QueueRunCommand } from "../queue-run.commands.ts";
import { RecordEvaluationsCommand } from "../record-evaluations.commands.ts";
import {
  SCENARIO_EVALUATIONS_PROCESS_NAME,
  scenarioEvaluationsPM,
} from "../scenario-evaluations.process.ts";
import { SimulationProcessingPipelineAdapter } from "../simulation-processing.pipeline.ts";
import {
  SIMULATION_RUN_EXECUTION_PROCESS_NAME,
  simulationRunExecutionPM,
} from "../simulation-run-execution.process.ts";
import {
  TRACE_SPAN_METRICS_SETTLE_MS,
  type TraceSpanMetricsSyncDeps,
} from "../trace-metrics-sync.subscriber.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const noop = async () => {};
const noAttachments = async () => ({
  suiteId: null,
  planId: null,
  attachments: [],
});

function build(traceSpanMetricsSync: TraceSpanMetricsSyncDeps = {} as never) {
  const simulations = {} as never;
  return SimulationProcessingPipelineAdapter.create({
    simulationRunStore: { store: noop, get: async () => null } as never,
    simulationRunMetricsStore: {} as never,
    queueRunCommand: new QueueRunCommand({ loadRunAttachments: noAttachments }),
    finishRunCommand: new FinishRunCommand({
      loadPriorEvents: async () => [],
      loadRunAttachments: noAttachments,
    }),
    recordEvaluationsCommand: new RecordEvaluationsCommand({
      loadPriorEvents: async () => [],
    }),
    computeRunMetricsCommand: new ComputeRunMetricsCommand({
      traceSummaryStore: {} as never,
      scheduleRetry: noop as never,
      deriveScenarioRoleMetrics: (async () => ({})) as never,
    }),
    scenarioRunExecution: {
      name: SIMULATION_RUN_EXECUTION_PROCESS_NAME,
      process: simulationRunExecutionPM({} as never, simulations),
    },
    scenarioEvaluations: {
      name: SCENARIO_EVALUATIONS_PROCESS_NAME,
      process: scenarioEvaluationsPM({
        evaluations: createApiFixture<RunScenarioEvaluationsDeps>(),
        loadPriorEvents: async () => [],
      }),
    },
    simulations,
    snapshotUpdateBroadcast: {} as never,
    suiteRunSync: {} as never,
    traceMetricsSync: {} as never,
    traceSpanMetricsSync,
  });
}

const SPAN_EVENT: Event = {
  id: "event-1",
  aggregateId: "trace-1",
  aggregateType: "trace",
  tenantId: createTenantId("project-1"),
  createdAt: 7_000,
  occurredAt: 7_000,
  type: SPAN_RECEIVED_EVENT_TYPE,
  version: "2026-01-01",
  data: {},
};

function traceSpanMetricsSyncLane(deps?: TraceSpanMetricsSyncDeps) {
  const lanes = new Map<string, EventSubscriberDefinition>();
  for (const projection of build(deps).globalProjections ?? []) {
    projection.register(
      createApiFixture<Parameters<typeof projection.register>[0]>({
        registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
      }),
    );
  }
  return lanes.get("simulation_processing.traceSpanMetricsSync");
}

describe("the simulation processing pipeline", () => {
  describe("when it is built the way the composition root builds it", () => {
    it("registers every command, the queued one with its evaluator lookup", () => {
      const pipeline = build();

      const names = pipeline.commands.map((command) => command.definition.name);

      expect(names).toContain("queueRun");
      expect(names).toContain("finishRun");
      expect(names).toContain("recordEvaluations");
      expect([...pipeline.processManagers.keys()]).toContain(SCENARIO_EVALUATIONS_PROCESS_NAME);
    });

    /** @scenario "Trace data that has not arrived yet is retried with a growing delay" */
    it("retries a run's grading with main's growing delay, up to main's attempt cap", () => {
      const outbox = build().processManagers.get(SCENARIO_EVALUATIONS_PROCESS_NAME)?.config.outbox;

      expect(outbox?.maxAttempts).toBe(SCENARIO_EVALUATIONS_JOB.MAX_ATTEMPTS);
      expect([1, 2, 3].map((attempt) => outbox?.retryDelayMs?.({ attempt }))).toEqual([
        3_000, 6_000, 12_000,
      ]);
    });
  });

  describe("when it subscribes to trace's span event", () => {
    /** @scenario "Scenario's subscriber publishes metrics after the trace settles" */
    it("waits main's 60 seconds, once per trace", () => {
      const lane = traceSpanMetricsSyncLane();

      expect(lane?.eventTypes).toEqual([SPAN_RECEIVED_EVENT_TYPE]);
      expect(lane?.options?.delay).toBe(TRACE_SPAN_METRICS_SETTLE_MS);
      const dedup = lane?.options?.deduplication;
      expect(typeof dedup === "object" ? dedup.ttlMs : undefined).toBe(
        TRACE_SPAN_METRICS_SETTLE_MS,
      );
      expect(
        typeof dedup === "object" && typeof dedup.makeId === "function"
          ? dedup.makeId(SPAN_EVENT)
          : undefined,
      ).toBe("subscriber:traceSpanMetricsSync:project-1:trace-1");
    });

    it("reads trace's summary and sends computeRunMetrics at the span's instant", async () => {
      const computeRunMetrics = vi.fn().mockResolvedValue(undefined);
      const findSummary = vi.fn().mockResolvedValue(
        createApiFixture<TraceSummaryData>({
          spanCount: 2,
          totalCost: 0.1,
          attributes: { "scenario.run_id": "run-1" },
        }),
      );
      const lane = traceSpanMetricsSyncLane({ findSummary, computeRunMetrics });

      await lane?.handle(SPAN_EVENT, { tenantId: "project-1", aggregateId: "trace-1" });

      expect(findSummary).toHaveBeenCalledWith({ projectId: "project-1", traceId: "trace-1" });
      expect(computeRunMetrics).toHaveBeenCalledExactlyOnceWith({
        tenantId: "project-1",
        scenarioRunId: "run-1",
        traceId: "trace-1",
        retryCount: 0,
        occurredAt: 7_000,
      });
    });
  });
});
