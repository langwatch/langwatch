/**
 * A saved evaluation can name an evaluator this install no longer has, either
 * because it was retired from the product or because this install skipped it.
 * `runEvaluation` used to reach the registry unguarded, so such a slug threw a
 * bare `TypeError` and reached the customer as a generic "unknown error" with a
 * trace id, rather than as the named `evaluator_not_found` its sibling path in
 * `EvaluationExecutionService` already raised.
 *
 * @see specs/npx-installer/07-lean-install.feature
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("~/server/langevals/stagedFetch", () => ({
  stagedLangevalsFetch: vi.fn(() => {
    throw new Error("langevals must never be reached for an unknown evaluator");
  }),
}));

import { HandledError } from "@langwatch/handled-error";
import type { EvaluatorTypes } from "@langwatch/evaluator-contract";
import { runEvaluation } from "../runEvaluation";

// A slug removed from the catalog. Cast past the union, which by construction
// only knows the evaluators that still exist.
const retiredEvaluatorType = "legacy/ragas_faithfulness" as EvaluatorTypes;

const run = () =>
  runEvaluation({
    projectId: "project-1",
    evaluatorType: retiredEvaluatorType,
    data: {
      type: "default",
      data: { output: "an answer", contexts: "some context" },
    },
    settings: {},
  });

describe("runEvaluation", () => {
  describe("given an evaluator type that is not in the catalog", () => {
    describe("when the evaluation runs", () => {
      /** @scenario Running one fails naming the evaluator, not with an unknown error */
      it("names the evaluator that could not be found", async () => {
        await expect(run()).rejects.toMatchObject({
          code: "evaluator_not_found",
        });
      });

      /** @scenario Running one fails naming the evaluator, not with an unknown error */
      it("reports it as a known failure rather than an unknown one", async () => {
        const error = await run().catch((thrown: unknown) => thrown);

        // A plain Error would degrade to the generic "unknown" treatment at the
        // boundary, which is the outcome this guard exists to avoid.
        expect(HandledError.isHandled(error)).toBe(true);
        expect((error as HandledError).meta).toMatchObject({
          evaluatorType: retiredEvaluatorType,
        });
      });
    });
  });
});
