import { EvaluatorExecutionError } from "@langwatch/evaluation-contract";
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { ExecuteEvaluationCommand } from "../eventing/evaluation-execution.intent.ts";
import { EvaluationExecutionIntentService } from "../features/execution/services/evaluation-execution-intent.service.ts";
import {
  buildExecuteCommand,
  buildExecutionDeps,
  DEFAULT_RETRY_WINDOW_MS,
} from "./support/evaluation-execution.fixtures.ts";

/** What langevals-evaluator.service.ts throws while the evaluator service is not up. */
function notUpYet(): EvaluatorExecutionError {
  return new EvaluatorExecutionError("Evaluator cannot be reached", {
    meta: { evaluatorType: "custom/test", retryAfterMs: 5_000 },
    httpStatus: 503,
    retryable: true,
  });
}

function issuedAgo(ms: number, attempt?: number) {
  return buildExecuteCommand({
    occurredAt: nowInstant().epochMilliseconds - ms,
    ...(attempt === undefined ? {} : { attempt }),
  });
}

describe("an evaluation whose evaluator service is not up", () => {
  describe("when its first attempt fails inside the retry window", () => {
    /**
     * @scenario "An evaluator called before the evaluator service is up is retried, not recorded as a failure"
     * @scenario "Each failed attempt records an attempt event with its number, error and next try"
     */
    it("records attempt 1 and sends attempt 2 after five seconds, from the same first try", async () => {
      const deps = buildExecutionDeps({ executionError: notUpYet() });
      const command = issuedAgo(60_000);
      const before = nowInstant().epochMilliseconds;

      const events = await EvaluationExecutionIntentService.create(deps).handle(command);

      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        type: "lw.evaluation.attempt_failed",
        aggregateId: command.data.evaluationId,
        data: {
          evaluationId: command.data.evaluationId,
          attempt: 1,
          error: "Evaluator cannot be reached",
        },
      });
      const [event] = events;
      const nextAttemptAt =
        event?.type === "lw.evaluation.attempt_failed" ? event.data.nextAttemptAt : undefined;
      expect(nextAttemptAt).toBeGreaterThanOrEqual(before + 5_000);
      // The window is measured from the first try, so the next attempt keeps its occurredAt.
      expect(deps.retries.retryEvaluation).toHaveBeenCalledWith({
        data: { ...command.data, attempt: 2 },
        delayMs: 5_000,
      });
    });

    /** @scenario "Each failed attempt records an attempt event with its number, error and next try" */
    it("gives each attempt its own job id, apart from the first send", () => {
      const first = buildExecuteCommand().data;
      const second = { ...first, attempt: 2 };
      const third = { ...first, attempt: 3 };

      expect(ExecuteEvaluationCommand.makeRetryJobId(second)).not.toBe(
        ExecuteEvaluationCommand.makeJobId(first),
      );
      expect(ExecuteEvaluationCommand.makeRetryJobId(second)).not.toBe(
        ExecuteEvaluationCommand.makeRetryJobId(third),
      );
    });
  });

  describe("when a later attempt fails inside the retry window", () => {
    /** @scenario "Each failed attempt records an attempt event with its number, error and next try" */
    it("records that attempt's number and backs off further", async () => {
      const deps = buildExecutionDeps({ executionError: notUpYet() });

      const events = await EvaluationExecutionIntentService.create(deps).handle(
        issuedAgo(60_000, 3),
      );

      expect(events[0]).toMatchObject({
        type: "lw.evaluation.attempt_failed",
        data: { attempt: 3 },
      });
      expect(deps.retries.retryEvaluation).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ attempt: 4 }),
          delayMs: 20_000,
        }),
      );
    });
  });

  describe("when it still fails once the retry window has ended", () => {
    /** @scenario "An evaluator service that stays down is recorded as an error once the retry window ends" */
    it("is recorded as an error and sends no further attempt", async () => {
      const deps = buildExecutionDeps({ executionError: notUpYet() });

      const events = await EvaluationExecutionIntentService.create(deps).handle(
        issuedAgo(DEFAULT_RETRY_WINDOW_MS + 1, 9),
      );

      expect(events).toContainEqual(
        expect.objectContaining({
          type: "lw.evaluation.reported",
          data: expect.objectContaining({ status: "error" }),
        }),
      );
      expect(deps.retries.retryEvaluation).not.toHaveBeenCalled();
    });

    /** @scenario "An evaluator service that stays down is recorded as an error once the retry window ends" */
    it("is recorded as an error when its next attempt would start after the window", async () => {
      const deps = buildExecutionDeps({ executionError: notUpYet() });

      const events = await EvaluationExecutionIntentService.create(deps).handle(
        issuedAgo(DEFAULT_RETRY_WINDOW_MS - 1_000),
      );

      expect(events).toContainEqual(expect.objectContaining({ type: "lw.evaluation.reported" }));
      expect(deps.retries.retryEvaluation).not.toHaveBeenCalled();
    });

    /** @scenario "An evaluator service that stays down is recorded as an error once the retry window ends" */
    it("follows the deployment's window rather than a fixed one", async () => {
      const deps = buildExecutionDeps({ executionError: notUpYet(), retryWindowMs: 30 * 60_000 });

      const handled = EvaluationExecutionIntentService.create(deps).handle(issuedAgo(31 * 60_000));

      await expect(handled).resolves.toContainEqual(
        expect.objectContaining({ type: "lw.evaluation.reported" }),
      );
    });
  });
});
