/**
 * The refusal's code survives into the reported evaluation as its error text; wave 1 adds no
 * error-code column (ADR-174 decision 7).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import type { EvaluationProcessingEvent } from "@langwatch/evaluation-contract";
import type { SingleEvaluationResult } from "@langwatch/evaluator-contract";
import { describe, expect, it } from "vitest";

import { executionResultOf } from "../rules/evaluation-execution-result.rules.ts";
import { EvaluationExecutionIntentService } from "../services/evaluation-execution-intent.service.ts";
import {
  buildExecuteCommand,
  buildExecutionDeps,
} from "./support/evaluation-execution.fixtures.ts";

function reportedError(events: EvaluationProcessingEvent[]) {
  const event = events.find((candidate) => candidate.type === "lw.evaluation.reported");
  if (!event || event.type !== "lw.evaluation.reported") {
    throw new Error("expected a reported evaluation event");
  }
  return event.data;
}

describe("Instant Evals refusal error code", () => {
  describe("given a judge result that is an error with a refusal code", () => {
    /** @scenario "The refusal's error code is kept in the reported result" */
    it.each([
      { refusal: "free budget exhausted", code: "instant_eval_free_budget_exhausted" },
      { refusal: "project unknown", code: "instant_eval_project_unknown" },
    ])("reports error text naming $code ($refusal)", async ({ code }) => {
      const judged: SingleEvaluationResult = {
        status: "error",
        error_type: code,
        details: `Instant Evals could not judge this trace: ${code}`,
        traceback: [],
      };
      const deps = buildExecutionDeps({
        executionResult: executionResultOf({
          result: judged,
          evaluationThreadId: undefined,
          inputs: {},
        }),
      });

      const events = await EvaluationExecutionIntentService.create(deps).handle(
        buildExecuteCommand({ evaluatorType: "langevals/llm_boolean" }),
      );

      const reported = reportedError(events);
      expect(reported.status).toBe("error");
      expect(reported.error).toContain(code);
    });
  });
});
