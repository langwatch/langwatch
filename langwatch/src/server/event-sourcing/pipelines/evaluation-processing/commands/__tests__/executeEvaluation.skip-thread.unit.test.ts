/**
 * @vitest-environment node
 *
 * Unit test for ExecuteEvaluationCommand's thread_id skip behaviour.
 * All deps injected via constructor — zero vi.mock calls.
 */

import { describe, expect, it, vi } from "vitest";
import { createTenantId } from "../../../../";
import type { Command } from "../../../../";
import {
  ExecuteEvaluationCommand,
  type ExecuteEvaluationCommandDeps,
} from "../executeEvaluation.command";
import type { ExecuteEvaluationCommandData } from "../../schemas/commands";

function buildDeps(
  overrides: Partial<ExecuteEvaluationCommandDeps> = {},
): ExecuteEvaluationCommandDeps {
  return {
    monitors: {
      getMonitorById: vi.fn().mockResolvedValue({
        id: "monitor_1",
        checkType: "custom/thread-eval",
        level: "thread",
        sample: 1,
        preconditions: [],
        mappings: {
          mapping: {
            conversation: { source: "formatted_traces", type: "thread" },
          },
        },
        parameters: {},
        evaluator: null,
      }),
    } as unknown as ExecuteEvaluationCommandDeps["monitors"],
    spanStorage: {
      getSpansByTraceId: vi.fn().mockResolvedValue([]),
    },
    traceEvents: {
      getEventsByTraceId: vi.fn().mockResolvedValue([]),
    },
    evaluationExecution: {
      executeForTrace: vi.fn().mockResolvedValue({
        status: "skipped",
        details: "Trace has no thread_id for thread-based evaluation",
      }),
    } as unknown as ExecuteEvaluationCommandDeps["evaluationExecution"],
    costRecorder: {
      recordCost: vi.fn(),
    } as unknown as ExecuteEvaluationCommandDeps["costRecorder"],
    ...overrides,
  };
}

function buildCommand(): Command<ExecuteEvaluationCommandData> {
  return {
    tenantId: createTenantId("project_phwl"),
    data: {
      tenantId: "project_phwl",
      traceId: "trace_no_thread",
      evaluationId: "eval_1",
      evaluatorId: "monitor_1",
      evaluatorType: "custom/thread-eval",
      occurredAt: Date.now(),
    },
  } as unknown as Command<ExecuteEvaluationCommandData>;
}

describe("ExecuteEvaluationCommand", () => {
  describe("given a thread-based monitor", () => {
    describe("when it runs on a trace with no thread_id", () => {
      /** @scenario a skipped thread evaluation emits no result event */
      it("emits no result event", async () => {
        const deps = buildDeps();
        const command = new ExecuteEvaluationCommand(deps);

        const events = await command.handle(buildCommand());

        // Pin the skip to the missing-thread-id branch: the command must reach
        // executeForTrace (which returns the skip) rather than bailing out at an
        // earlier guard, otherwise an empty event list would be a false positive.
        expect(deps.evaluationExecution.executeForTrace).toHaveBeenCalledTimes(1);
        expect(events).toEqual([]);
        expect(deps.costRecorder.recordCost).not.toHaveBeenCalled();
      });
    });
  });
});
