/**
 * Simulation pipeline wiring: validates command instances from composition
 * root are correctly registered (mismatch only shows on boot).
 */

import { createApiFixture } from "@langwatch/api-fixture";
import {
  SCENARIO_EVALUATIONS_JOB,
  type RunScenarioEvaluationsDeps,
} from "@langwatch/scenario-contract";
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

function build() {
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
  });
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
});
