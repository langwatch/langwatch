/**
 * The simulation pipeline builds with the command instances the composition
 * root gives it.
 *
 * Three of its commands carry dependencies and are registered as instances
 * rather than classes. A mismatch between what the builder expects and what
 * the registry passes only shows when the pipeline is built, which happens on
 * boot and in no other test.
 *
 * @see specs/scenarios/scenario-evaluation-pending.feature
 */

import { describe, expect, it, vi } from "vitest";
import { ComputeRunMetricsCommand } from "../compute-run-metrics.commands.ts";
import { FinishRunCommand } from "../finish-run.commands.ts";
import { QueueRunCommand } from "../queueRun.command.ts";
import { RecordEvaluationsCommand } from "../recordEvaluations.command.ts";
// DANGLING: `createSimulationProcessingPipeline` is not exported anywhere in
// this tree. Main's `../pipeline.ts` had it; the new
// `simulation-processing.pipeline.ts` replaces it with the
// `SimulationProcessingPipelineAdapter` class, whose deps shape (no
// `recordEvaluationsCommand`, `simulationRunExecution` -> `scenarioRunExecution`,
// `simulations` in place of `scenarioEvaluations`) does not match what this
// test builds. This whole test looks half-ported - see handoff
// merge-scenario-dangling-imports.
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
