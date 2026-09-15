/**
 * Simulation pipeline wiring: validates command instances from composition
 * root are correctly registered (mismatch only shows on boot).
 */

import { describe, expect, it, vi } from "vitest";
import { ComputeRunMetricsCommand } from "../compute-run-metrics.commands.ts";
import { FinishRunCommand } from "../finish-run.commands.ts";
import { QueueRunCommand } from "../queueRun.command.ts";
import { RecordEvaluationsCommand } from "../recordEvaluations.command.ts";
// DANGLING: `createSimulationProcessingPipeline` is not exported anywhere in
// this tree. `SimulationProcessingPipelineAdapter` replaces it with a
// different deps shape this test doesn't build against — half-ported. See
// handoff merge-scenario-dangling-imports.
import { createSimulationProcessingPipeline } from "./pipeline.wiring.unit.test.ts";

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
      const pipeline = createSimulationProcessingPipeline({
        simulationRunStore: { store: noop, get: async () => null } as never,
        simulationRunMetricsStore: {} as never,
        queueRunCommand: new QueueRunCommand({
          loadRunAttachments: noAttachments,
        }),
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
        simulationRunExecution: {} as never,
        snapshotUpdateBroadcast: {} as never,
        suiteRunSync: {} as never,
        traceMetricsSync: {} as never,
        scenarioEvaluations: {
          loadRunAttachments: noAttachments,
          enqueue: noop,
        },
      });

      const names = pipeline.commands.map((command) => command.name);

      expect(names).toContain("queueRun");
      expect(names).toContain("finishRun");
      expect(names).toContain("recordEvaluations");
    });
  });
});
