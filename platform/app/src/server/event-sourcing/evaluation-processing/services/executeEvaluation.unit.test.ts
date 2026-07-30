import { HandledError, type HandledErrorFault } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";
import type { EvaluationCostRecorder } from "~/server/app-layer/evaluations/evaluation-cost.recorder";
import type { EvaluationExecutionService } from "~/server/app-layer/evaluations/evaluation-execution.service";
import type { MonitorService } from "~/server/app-layer/monitors/monitor.service";
import {
  type ExecuteEvaluationDeps,
  type ExecuteEvaluationInput,
  executeEvaluation,
} from "./executeEvaluation";

/** A minimal concrete `HandledError` — the class is abstract, so every test
 * that needs one declares its own tiny subclass, mirroring the package's own
 * test suite (`packages/handled-error/src/handled-error.test.ts`). */
class TestHandledError extends HandledError {
  constructor(fault: HandledErrorFault, message: string) {
    super("test_error", message, { httpStatus: 400, fault });
  }
}

function baseInput(
  overrides: Partial<ExecuteEvaluationInput> = {},
): ExecuteEvaluationInput {
  return {
    tenantId: "tenant-1",
    traceId: "trace-1",
    evaluationId: "eval-1",
    evaluatorId: "monitor-1",
    evaluatorType: "langevals/answer_correctness",
    occurredAt: 1_000,
    ...overrides,
  };
}

function baseMonitor(overrides: Record<string, unknown> = {}) {
  return {
    checkType: "langevals/answer_correctness",
    sample: 1,
    preconditions: [],
    evaluator: null,
    parameters: {},
    mappings: null,
    level: "trace",
    ...overrides,
  };
}

function baseDeps(
  overrides: Partial<ExecuteEvaluationDeps> = {},
): ExecuteEvaluationDeps {
  return {
    monitors: {
      getMonitorById: vi.fn().mockResolvedValue(baseMonitor()),
    } as unknown as MonitorService,
    spanStorage: { getSpansByTraceId: vi.fn().mockResolvedValue([]) },
    traceEvents: { getEventsByTraceId: vi.fn().mockResolvedValue([]) },
    evaluationExecution: {
      executeForTrace: vi
        .fn()
        .mockResolvedValue({ status: "processed", score: 1, passed: true }),
    } as unknown as EvaluationExecutionService,
    costRecorder: {
      recordCost: vi.fn().mockResolvedValue("cost-1"),
    } as EvaluationCostRecorder,
    ...overrides,
  };
}

describe("executeEvaluation", () => {
  describe("given the monitor no longer exists", () => {
    /** @scenario "A monitor that no longer exists is reported as skipped, not retried" */
    it("reports a skipped evaluation instead of throwing", async () => {
      const deps = baseDeps({
        monitors: {
          getMonitorById: vi.fn().mockResolvedValue(null),
        } as unknown as MonitorService,
      });

      const events = await executeEvaluation(deps, baseInput());

      expect(events).toHaveLength(1);
      expect(events[0]!.data).toMatchObject({ status: "skipped" });
    });
  });

  describe("given sampling excludes the trace", () => {
    /** @scenario "Sampling excludes a trace without emitting any event" */
    it("produces no event at all", async () => {
      const deps = baseDeps({
        monitors: {
          getMonitorById: vi.fn().mockResolvedValue(baseMonitor({ sample: 0 })),
        } as unknown as MonitorService,
      });

      const events = await executeEvaluation(deps, baseInput());

      expect(events).toEqual([]);
    });
  });

  describe("given the monitor's preconditions do not match the trace", () => {
    /** @scenario "Unmet preconditions produce no evaluation event" */
    it("produces no event", async () => {
      const deps = baseDeps({
        monitors: {
          getMonitorById: vi.fn().mockResolvedValue(
            baseMonitor({
              preconditions: [{ field: "input", rule: "is", value: "goodbye" }],
            }),
          ),
        } as unknown as MonitorService,
      });

      const events = await executeEvaluation(
        deps,
        baseInput({ computedInput: "hello" }),
      );

      expect(events).toEqual([]);
    });
  });

  describe("given the evaluator throws a customer-fixable failure", () => {
    /** @scenario "A customer-fixable evaluator failure is reported as skipped" */
    it("reports a skipped evaluation and does not throw", async () => {
      const deps = baseDeps({
        evaluationExecution: {
          executeForTrace: vi
            .fn()
            .mockRejectedValue(
              new TestHandledError("customer", "provider disabled"),
            ),
        } as unknown as EvaluationExecutionService,
      });

      const events = await executeEvaluation(deps, baseInput());

      expect(events).toHaveLength(1);
      expect(events[0]!.data).toMatchObject({
        status: "skipped",
        details: "provider disabled",
      });
    });
  });

  describe("given the evaluator throws a failure that is not customer-fixable", () => {
    /**
     * Defect #1's service-layer half (see `executeEvaluation.ts`'s module
     * docblock): the old pipeline's outer catch converted every exception,
     * customer-fixable or not, into a permanent `reported` event with
     * `status: "error"` — manufacturing false finality for a failure a retry
     * might have fixed. This function must re-throw instead, so the caller's
     * at-least-once redelivery (ADR-075's leased-outbox process manager, one
     * layer up) gets the chance the old code silently denied it.
     * @scenario "A genuine evaluator failure surfaces for the caller to retry, never recorded as done"
     */
    it("propagates the error instead of emitting a reported event", async () => {
      const deps = baseDeps({
        evaluationExecution: {
          executeForTrace: vi.fn().mockRejectedValue(new Error("ECONNRESET")),
        } as unknown as EvaluationExecutionService,
      });

      await expect(executeEvaluation(deps, baseInput())).rejects.toThrow(
        "ECONNRESET",
      );
    });

    it("also propagates a platform-fault HandledError, not just a plain Error", async () => {
      const deps = baseDeps({
        evaluationExecution: {
          executeForTrace: vi
            .fn()
            .mockRejectedValue(
              new TestHandledError("platform", "langevals unreachable"),
            ),
        } as unknown as EvaluationExecutionService,
      });

      await expect(executeEvaluation(deps, baseInput())).rejects.toThrow(
        "langevals unreachable",
      );
    });
  });

  describe("given the evaluator returns its own error verdict rather than throwing", () => {
    /** @scenario "The evaluator's own error verdict is reported, not treated as a failure to retry" */
    it("reports a processed-but-errored evaluation instead of throwing", async () => {
      const deps = baseDeps({
        evaluationExecution: {
          executeForTrace: vi.fn().mockResolvedValue({
            status: "error",
            error: "malformed trace",
          }),
        } as unknown as EvaluationExecutionService,
      });

      const events = await executeEvaluation(deps, baseInput());

      expect(events).toHaveLength(1);
      expect(events[0]!.data).toMatchObject({
        status: "error",
        error: "malformed trace",
      });
    });
  });

  describe("given a processed evaluation with oversized inputs", () => {
    it("routes the result through offloadInputs before building the event", async () => {
      const offloadInputs = vi
        .fn()
        .mockResolvedValue({ __lw_stored_object: { id: "obj-1" } });
      const deps = baseDeps({
        evaluationExecution: {
          executeForTrace: vi.fn().mockResolvedValue({
            status: "processed",
            score: 1,
            inputs: { conversation: "very large" },
          }),
        } as unknown as EvaluationExecutionService,
        offloadInputs,
      });

      const events = await executeEvaluation(deps, baseInput());

      expect(offloadInputs).toHaveBeenCalledWith({
        projectId: "tenant-1",
        evaluationId: "eval-1",
        inputs: { conversation: "very large" },
      });
      expect(events[0]!.data).toMatchObject({
        inputs: { __lw_stored_object: { id: "obj-1" } },
      });
    });
  });
});
