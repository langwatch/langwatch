/**
 * @vitest-environment node
 *
 * Unit test for ExecuteEvaluationCommand's thread_id skip behaviour.
 * All deps injected via constructor — zero vi.mock calls.
 */

import { describe, expect, it } from "vitest";
import { EvaluationExecutionIntentService as ExecuteEvaluationCommand } from "@langwatch/evaluation-server";
import {
  buildExecuteCommand,
  buildExecutionDeps,
  buildMonitor,
  type EvaluationExecutionFixtureOptions,
} from "../ports/__tests__/support/evaluation-execution.fixtures";

function buildDeps(overrides: EvaluationExecutionFixtureOptions = {}) {
  return buildExecutionDeps({
    monitor: buildMonitor({
      id: "monitor_1",
      projectId: "project_phwl",
      checkType: "custom/thread-eval",
      name: "Thread evaluator",
      level: "thread",
      sample: 1,
      preconditions: [],
      mappings: {
        mapping: {
          conversation: { source: "formatted_traces", type: "thread" },
        },
        expansions: [],
      },
      parameters: {},
      evaluator: null,
    }),
    executionResult: {
      status: "skipped",
      details: "Trace has no thread_id for thread-based evaluation",
    },
    ...overrides,
  });
}

function buildCommand() {
  return buildExecuteCommand({
    tenantId: "project_phwl",
    traceId: "trace_no_thread",
    evaluationId: "eval_1",
    evaluatorId: "monitor_1",
    evaluatorType: "custom/thread-eval",
  });
}

describe("ExecuteEvaluationCommand", () => {
  describe("given a thread-based monitor", () => {
    describe("when it runs on a trace with no thread_id", () => {
      /** @scenario a skipped thread evaluation emits no result event */
      it("emits no result event", async () => {
        const deps = buildDeps();
        const command = ExecuteEvaluationCommand.create(deps);

        const events = await command.handle(buildCommand());

        // Pin the skip to the missing-thread-id branch: the command must reach
        // executeForTrace (which returns the skip) rather than bailing out at an
        // earlier guard, otherwise an empty event list would be a false positive.
        expect(deps.evaluations.executeForTrace).toHaveBeenCalledTimes(1);
        expect(events).toEqual([]);
        expect(deps.costRecorder.recordCost).not.toHaveBeenCalled();
      });
    });
  });

  describe("when it reads spans for the trace", () => {
    it("passes the event occurredAt as the partition hint", async () => {
      const deps = buildDeps();
      const command = ExecuteEvaluationCommand.create(deps);
      const cmd = buildCommand();

      await command.handle(cmd);

      expect(deps.traces.getEvaluationSpans).toHaveBeenCalledWith(
        expect.objectContaining({
          traceId: cmd.data.traceId,
          occurredAtMs: cmd.data.occurredAt,
        }),
      );
    });
  });
});
