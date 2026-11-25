import type {
  CompleteEvaluationCommandData,
  ExecuteEvaluationCommandData,
  ReportEvaluationCommandData,
  StartEvaluationCommandData,
} from "@langwatch/evaluation-contract";
import type { QueueSendOptions } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

import { ExecuteEvaluationCommand } from "../../eventing/evaluation-execution.intent.ts";
import { EvaluationCommandDispatcherService } from "../evaluation-command-dispatcher.service.ts";

/** One command's sender, recording what it was asked to queue. */
function sender<Payload extends Record<string, unknown>>() {
  return {
    send: vi.fn(
      async (_payload: Payload, _options?: QueueSendOptions<Payload>): Promise<void> => undefined,
    ),
    sendBatch: vi.fn(
      async (_payloads: Payload[], _options?: QueueSendOptions<Payload>): Promise<void> =>
        undefined,
    ),
    close: async (): Promise<void> => undefined,
    waitUntilReady: async (): Promise<void> => undefined,
  };
}

const ATTEMPT_TWO: ExecuteEvaluationCommandData = {
  tenantId: "project_1",
  traceId: "trace_1",
  evaluationId: "evaluation_1",
  evaluatorId: "monitor_1",
  evaluatorType: "custom/test",
  occurredAt: 1_700_000_000_000,
  attempt: 2,
};

describe("EvaluationCommandDispatcherService.retryEvaluation", () => {
  describe("when an attempt is sent again", () => {
    /** @scenario "Each failed attempt records an attempt event with its number, error and next try" */
    it("delays it and keys its dedup on the attempt, never on the first send's id", async () => {
      const executeEvaluation = sender<ExecuteEvaluationCommandData & Record<string, unknown>>();
      const dispatcher = EvaluationCommandDispatcherService.create();
      dispatcher.connect({
        executeEvaluation,
        startEvaluation: sender<StartEvaluationCommandData & Record<string, unknown>>(),
        completeEvaluation: sender<CompleteEvaluationCommandData & Record<string, unknown>>(),
        reportEvaluation: sender<ReportEvaluationCommandData & Record<string, unknown>>(),
      });

      await dispatcher.retryEvaluation({ data: ATTEMPT_TWO, delayMs: 5_000 });

      expect(executeEvaluation.send).toHaveBeenCalledWith(ATTEMPT_TWO, {
        delay: 5_000,
        deduplication: {
          makeId: expect.any(Function),
          ttlMs: 65_000,
          shouldSurviveDispatch: true,
        },
      });
      expect(ExecuteEvaluationCommand.makeRetryJobId(ATTEMPT_TWO)).toBe(
        "exec:project_1:evaluation_1:attempt:2",
      );
    });
  });

  describe("when the process hosts no evaluation pipeline", () => {
    it("refuses by name", async () => {
      const dispatcher = EvaluationCommandDispatcherService.create();

      await expect(
        dispatcher.retryEvaluation({ data: ATTEMPT_TWO, delayMs: 5_000 }),
      ).rejects.toThrow(/executeEvaluation sender/);
    });
  });
});
