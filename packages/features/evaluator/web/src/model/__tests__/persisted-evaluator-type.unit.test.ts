import { describe, expect, it } from "vitest";
import { isPersistedEvaluatorType } from "../persisted-evaluator-type";

describe("isPersistedEvaluatorType", () => {
  describe("when the evaluator already exists with its own editor", () => {
    /** @scenario "Selecting a code evaluator for an online evaluation hands it on by id" */
    it("treats code evaluators like workflow evaluators", () => {
      expect(isPersistedEvaluatorType("code")).toBe(true);
      expect(isPersistedEvaluatorType("workflow")).toBe(true);
    });
  });

  describe("when the evaluator is a built-in configured from settings", () => {
    it("leaves built-in and unknown types to the settings form", () => {
      expect(isPersistedEvaluatorType("langevals/basic")).toBe(false);
      expect(isPersistedEvaluatorType(undefined)).toBe(false);
    });
  });
});
