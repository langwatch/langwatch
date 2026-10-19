/**
 * @vitest-environment node
 */

import { getEvaluatorIncludingCustom } from "@langwatch/evaluation-contract";
import type { EvaluatorTypes } from "@langwatch/evaluator-contract";
import { describe, expect, it } from "vitest";

describe("getEvaluatorIncludingCustom", () => {
  describe("when the type names a custom workflow the caller passed", () => {
    it("answers its name and the required fields as passed", () => {
      const evaluator = getEvaluatorIncludingCustom({
        checkType: "custom/wf_1" as EvaluatorTypes,
        customEvaluators: [{ id: "wf_1", name: "Judge", requiredFields: ["input", "expected"] }],
      });

      expect(evaluator).toEqual({ name: "Judge", requiredFields: ["input", "expected"] });
    });
  });

  describe("when neither a built-in nor a passed custom workflow has the type", () => {
    it("throws evaluator_not_found", () => {
      expect(() =>
        getEvaluatorIncludingCustom({
          checkType: "custom/missing" as EvaluatorTypes,
          customEvaluators: [],
        }),
      ).toThrow(expect.objectContaining({ code: "evaluator_not_found" }));
    });
  });
});
