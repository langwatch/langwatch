/**
 * @vitest-environment node
 * A monitor whose judge is refused stores an error naming the refusal's code, never a skip,
 * so its alerts fire (ADR-174 decision 7).
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */
import { describe, expect, it } from "vitest";

import { buildExecuteCommand } from "./support/evaluation-execution.fixtures.ts";
import { buildInstantEvalMonitor, reportedOf } from "./support/instant-eval-monitor.fixtures.ts";

describe("Instant Evals judge refused on a monitor", () => {
  describe("given a monitor whose judge is on Instant Evals and a spent free budget", () => {
    describe("when the monitor evaluates a trace", () => {
      /** @scenario "A refused monitor evaluation is stored as an error naming its code" */
      it("stores an error whose text names the free budget exhausted code", async () => {
        const { handler, costRecorder } = buildInstantEvalMonitor({
          judge: async () => ({
            outcome: "refused",
            code: "instant_eval_free_budget_exhausted",
            message: "This organization has used its free Instant Evals budget.",
          }),
        });

        const events = await handler.handle(
          buildExecuteCommand({ evaluatorType: "langevals/llm_boolean" }),
        );

        const reported = reportedOf(events);
        expect(reported.status).toBe("error");
        expect(reported.error).toContain("instant_eval_free_budget_exhausted");
        expect(costRecorder.created).not.toHaveBeenCalled();
      });
    });
  });
});
