/** `EvaluatorApi.findTraceIdsPassingPreconditions`: main's getSampleTraces precondition match. */
import { AVAILABLE_EVALUATORS } from "@langwatch/evaluator-contract";
import type { Trace } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { createEvaluatorTestApp } from "./evaluator.fixture.ts";

function trace(input: { traceId: string; input?: string; expectedOutput?: string }): Trace {
  return {
    trace_id: input.traceId,
    project_id: "project-1",
    metadata: {},
    timestamps: { started_at: 1, inserted_at: 1, updated_at: 1 },
    input: input.input === undefined ? undefined : { value: input.input },
    expected_output:
      input.expectedOutput === undefined ? undefined : { value: input.expectedOutput },
    spans: [],
  };
}

const [expectedOutputEvaluatorType] =
  Object.entries(AVAILABLE_EVALUATORS).find(([, definition]) =>
    definition.requiredFields.includes("expected_output"),
  ) ?? [];

describe("EvaluatorApp.findTraceIdsPassingPreconditions", () => {
  describe("given traces and a custom check", () => {
    /** @scenario "Only traces passing every precondition match" */
    it("returns only the traces passing every precondition", async () => {
      const { app } = createEvaluatorTestApp();

      const ids = await app.findTraceIdsPassingPreconditions({
        evaluatorType: "custom/refunds",
        preconditions: [{ field: "input", rule: "contains", value: "refund" }],
        traces: [
          trace({ traceId: "t-refund", input: "I want a Refund please" }),
          trace({ traceId: "t-other", input: "hello" }),
        ],
      });

      expect(ids).toEqual(["t-refund"]);
    });
  });

  describe("given a check whose evaluator requires an expected output", () => {
    /** @scenario "A trace missing the evaluator's required field fails the match" */
    it("drops the trace without an expected output", async () => {
      const { app } = createEvaluatorTestApp();
      expect(expectedOutputEvaluatorType).toBeDefined();

      const ids = await app.findTraceIdsPassingPreconditions({
        evaluatorType: expectedOutputEvaluatorType ?? "",
        preconditions: [],
        traces: [
          trace({ traceId: "t-missing", input: "a" }),
          trace({ traceId: "t-present", input: "a", expectedOutput: "b" }),
        ],
      });

      expect(ids).toEqual(["t-present"]);
    });
  });

  describe("when the input names what no check knows", () => {
    /** @scenario "An unknown evaluator type is refused as invalid input" */
    it("refuses an unknown evaluator type with validation_error", async () => {
      const { app } = createEvaluatorTestApp();

      await expect(
        app.findTraceIdsPassingPreconditions({
          evaluatorType: "nobody/knows",
          preconditions: [],
          traces: [],
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
    });

    /** @scenario "A malformed precondition is refused as invalid input" */
    it("refuses a precondition with an unknown rule", async () => {
      const { app } = createEvaluatorTestApp();

      await expect(
        app.findTraceIdsPassingPreconditions({
          evaluatorType: "custom/refunds",
          preconditions: [{ field: "input", rule: "sounds_like", value: "refund" }],
          traces: [],
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
    });
  });
});
