import { describe, expect, it } from "vitest";
import {
  buildStripScoreEvaluatorIds,
  shouldStripScore,
} from "../evaluatorScoreFilter";

describe("evaluatorScoreFilter", () => {
  describe("shouldStripScore", () => {
    it("returns true for langevals/exact_match", () => {
      expect(shouldStripScore("langevals/exact_match")).toBe(true);
    });

    it("returns true for langevals/llm_answer_match", () => {
      expect(shouldStripScore("langevals/llm_answer_match")).toBe(true);
    });

    it("returns true for guardrail evaluators", () => {
      // azure/content_safety is marked as isGuardrail: true
      expect(shouldStripScore("azure/content_safety")).toBe(true);
      // azure/jailbreak is marked as isGuardrail: true
      expect(shouldStripScore("azure/jailbreak")).toBe(true);
      // openai/moderation is marked as isGuardrail: true
      expect(shouldStripScore("openai/moderation")).toBe(true);
    });

    it("returns false for non-guardrail evaluators", () => {
      // ragas evaluators are not guardrails
      expect(shouldStripScore("ragas/context_precision")).toBe(false);
      expect(shouldStripScore("ragas/faithfulness")).toBe(false);
    });

    it("returns false for custom evaluators", () => {
      expect(shouldStripScore("custom/my-custom-evaluator")).toBe(false);
      expect(shouldStripScore("custom/another-one")).toBe(false);
    });

    it("returns false for unknown evaluator types", () => {
      expect(shouldStripScore("unknown/evaluator")).toBe(false);
    });
  });

  describe("buildStripScoreEvaluatorIds", () => {
    it("returns empty set for no evaluators", () => {
      const result = buildStripScoreEvaluatorIds([]);
      expect(result.size).toBe(0);
    });

    it("includes evaluator IDs that should have scores stripped", () => {
      const evaluators = [
        { id: "eval-1", evaluatorType: "langevals/exact_match" },
        { id: "eval-2", evaluatorType: "ragas/faithfulness" },
        { id: "eval-3", evaluatorType: "langevals/llm_answer_match" },
      ];

      const result = buildStripScoreEvaluatorIds(evaluators);

      expect(result.has("eval-1")).toBe(true);
      expect(result.has("eval-2")).toBe(false);
      expect(result.has("eval-3")).toBe(true);
    });

    it("includes guardrail evaluators", () => {
      const evaluators = [
        { id: "eval-1", evaluatorType: "azure/content_safety" },
        { id: "eval-2", evaluatorType: "ragas/context_precision" },
      ];

      const result = buildStripScoreEvaluatorIds(evaluators);

      expect(result.has("eval-1")).toBe(true);
      expect(result.has("eval-2")).toBe(false);
    });

    it("does not include custom evaluators", () => {
      const evaluators = [
        { id: "eval-1", evaluatorType: "custom/my-evaluator" },
      ];

      const result = buildStripScoreEvaluatorIds(evaluators);

      expect(result.has("eval-1")).toBe(false);
    });
  });
});
