/**
 * Regression: workbench live-execute of an evaluator-as-target into a
 * downstream string-input scorer used to reject boolean/number/object outputs
 * with "Validation error: Expected string, received boolean at output".
 *
 * Covers the REST schema path (getEvaluatorDataForParams →
 * defaultEvaluatorInputSchema.parse) for the source types listed in
 * specs/experiments-v3/evaluator-as-target.feature.
 */
import { describe, expect, it } from "vitest";

import { getEvaluatorDataForParams } from "../evaluations-legacy";

const evaluate = (params: Record<string, unknown>) =>
  getEvaluatorDataForParams("langevals/exact_match", params);

describe("getEvaluatorDataForParams coercion", () => {
  describe("when an upstream target output is a boolean", () => {
    /** @scenario Downstream evaluator receives a boolean target output without rejection */
    /** @scenario Non-string target outputs are coerced to the evaluator's declared input type */
    /** @scenario Online evaluation request with a boolean trace metadata mapping runs without rejection */
    it("coerces true to the string 'true' on output", () => {
      const result = evaluate({ output: true, expected_output: "1" });
      expect(result.type).toBe("default");
      if (result.type !== "default") throw new Error("unreachable");
      expect(result.data.output).toBe("true");
      expect(result.data.expected_output).toBe("1");
    });

    it("coerces false to the string 'false' on output", () => {
      const result = evaluate({ output: false, expected_output: "0" });
      if (result.type !== "default") throw new Error("unreachable");
      expect(result.data.output).toBe("false");
    });
  });

  describe("when an upstream target output is a number", () => {
    it("coerces integers to their string form", () => {
      const result = evaluate({ output: 42, expected_output: "42" });
      if (result.type !== "default") throw new Error("unreachable");
      expect(result.data.output).toBe("42");
    });

    it("coerces floats to their string form", () => {
      const result = evaluate({ output: 0.5, expected_output: "0.5" });
      if (result.type !== "default") throw new Error("unreachable");
      expect(result.data.output).toBe("0.5");
    });
  });

  describe("when an upstream target output is an object or array", () => {
    it("JSON-stringifies objects on output", () => {
      const result = evaluate({ output: { a: 1 }, expected_output: '{"a":1}' });
      if (result.type !== "default") throw new Error("unreachable");
      expect(result.data.output).toBe('{"a":1}');
    });

    it("JSON-stringifies arrays on output", () => {
      const result = evaluate({
        output: [1, 2, 3],
        expected_output: "[1,2,3]",
      });
      if (result.type !== "default") throw new Error("unreachable");
      expect(result.data.output).toBe("[1,2,3]");
    });
  });

  describe("when the upstream target output is null", () => {
    /** @scenario Null target outputs are preserved, not coerced into a string */
    it("preserves null rather than coercing to the string 'null'", () => {
      const result = evaluate({ output: null, expected_output: "anything" });
      if (result.type !== "default") throw new Error("unreachable");
      expect(result.data.output).toBeUndefined();
    });
  });

  describe("when input + expected_output + conversation fields receive non-strings", () => {
    it("coerces every scalar field the same way", () => {
      const result = evaluate({
        input: { user: "ok" },
        output: true,
        expected_output: 1,
        conversation: [{ input: true, output: 0.5 }],
      });
      if (result.type !== "default") throw new Error("unreachable");
      expect(result.data.input).toBe('{"user":"ok"}');
      expect(result.data.output).toBe("true");
      expect(result.data.expected_output).toBe("1");
      expect(result.data.conversation).toBe(
        JSON.stringify([{ input: "true", output: "0.5" }]),
      );
    });
  });

  describe("when checkType is a custom evaluator", () => {
    it("passes params through without coercion (custom evaluators self-validate)", () => {
      const result = getEvaluatorDataForParams("custom/wf_123", {
        output: true,
        expected_output: 1,
      });
      expect(result.type).toBe("custom");
      if (result.type !== "custom") throw new Error("unreachable");
      expect(result.data.output).toBe(true);
      expect(result.data.expected_output).toBe(1);
    });
  });

  describe("when checkType is a code evaluator", () => {
    /** @scenario Code evaluator executes through the engine code component */
    it("passes params through without coercion (the code declares its own inputs)", () => {
      const result = getEvaluatorDataForParams("code/evaluator_abc", {
        output: true,
        expected_output: 1,
      });
      expect(result.type).toBe("custom");
      if (result.type !== "custom") throw new Error("unreachable");
      expect(result.data.output).toBe(true);
      expect(result.data.expected_output).toBe(1);
    });
  });
});
