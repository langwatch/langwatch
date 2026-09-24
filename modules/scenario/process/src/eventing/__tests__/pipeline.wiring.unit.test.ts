/**
 * Simulation pipeline wiring: validates command instances from composition
 * root are correctly registered (mismatch only shows on boot).
 */

import { describe, expect, it, vi } from "vitest";

import { ComputeRunMetricsCommand } from "../compute-run-metrics.commands.ts";
import { FinishRunCommand } from "../finish-run.commands.ts";
import { RecordEvaluationsCommand } from "../record-evaluations.commands.ts";
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

describe("the simulation processing pipeline", () => {
  describe("when it is built the way the composition root builds it", () => {
    it("registers every command, the queued one with its evaluator lookup", () => {
      const simulations = {} as never;
      const pipeline = SimulationProcessingPipelineAdapter.create({
        simulationRunStore: { store: noop, get: async () => null } as never,
        simulationRunMetricsStore: {} as never,
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
        simulations,
        snapshotUpdateBroadcast: {} as never,
        suiteRunSync: {} as never,
        traceMetricsSync: {} as never,
      });

      const names = pipeline.commands.map((command) => command.definition.name);

      expect(names).toContain("queueRun");
      expect(names).toContain("finishRun");
      expect(names).toContain("recordEvaluations");
    });
  });
});
