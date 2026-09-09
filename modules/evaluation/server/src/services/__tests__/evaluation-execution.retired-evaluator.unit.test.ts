/**
 * A saved evaluation can name an evaluator this install no longer has, and the
 * failure has to name it: a bare throw reaches the customer as a generic
 * "unknown error". @see specs/npx-installer/07-lean-install.feature
 */
import { HandledError } from "@langwatch/handled-error";
import { describe, expect, it, vi } from "vitest";
import {
  EvaluationExecutionService,
  type EvaluationExecutionDeps,
} from "../evaluation-execution.service.ts";

/** A slug removed from the catalog. */
const RETIRED_EVALUATOR_TYPE = "legacy/ragas_faithfulness";

const langevalsEvaluate = vi.fn(() => {
  throw new Error("the analysis service must never be reached for an unknown evaluator");
});

function run() {
  const deps = {
    traceService: {} as never,
    spanDigest: {} as never,
    modelEnvResolver: {} as never,
    langevalsClient: { evaluate: langevalsEvaluate },
    workflows: {} as never,
    evaluators: {} as never,
    workflowExecutor: {} as never,
    installEnvironment: {} as never,
  } as unknown as EvaluationExecutionDeps;

  return EvaluationExecutionService.create(deps).executeForData({
    projectId: "project-1",
    evaluatorType: RETIRED_EVALUATOR_TYPE,
    data: { type: "default", data: { output: "an answer", contexts: "some context" } },
    settings: {},
  });
}

describe("EvaluationExecutionService", () => {
  describe("given an evaluator type that is not in the catalog", () => {
    describe("when the evaluation runs", () => {
      /** @scenario Running one fails naming the evaluator, not with an unknown error */
      it("names the evaluator that could not be found, as a known failure", async () => {
        const error = await run().catch((thrown: unknown) => thrown);

        // A plain Error would degrade to the generic "unknown" treatment at the
        // boundary, which is the outcome this guard exists to avoid.
        expect(HandledError.isHandled(error)).toBe(true);
        expect(error).toMatchObject({ code: "evaluator_not_found" });
        expect(JSON.stringify((error as HandledError).meta)).toContain(RETIRED_EVALUATOR_TYPE);
        expect(langevalsEvaluate).not.toHaveBeenCalled();
      });
    });
  });
});
