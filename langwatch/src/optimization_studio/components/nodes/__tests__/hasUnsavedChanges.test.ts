/**
 * @vitest-environment node
 */
import { describe, it, expect } from "vitest";
import { hasUnsavedChanges } from "../../../utils/unsavedChanges";
import type { Component, Evaluator, Signature } from "../../../types/dsl";

describe("hasUnsavedChanges", () => {
  describe("when node data has no local changes", () => {
    it("returns false for a base component", () => {
      const data: Component = { cls: "SomeComponent" };
      expect(hasUnsavedChanges(data)).toBe(false);
    });

    it("returns false for an evaluator without localConfig", () => {
      const data: Evaluator = { cls: "SomeEvaluator" };
      expect(hasUnsavedChanges(data)).toBe(false);
    });

    it("returns false for a signature without localPromptConfig", () => {
      const data: Signature = {};
      expect(hasUnsavedChanges(data)).toBe(false);
    });
  });

  describe("when evaluator node has localConfig", () => {
    it("returns true", () => {
      const data: Evaluator = {
        cls: "SomeEvaluator",
        localConfig: { name: "modified", settings: {} },
      };
      expect(hasUnsavedChanges(data)).toBe(true);
    });

    it("returns true even with empty localConfig object", () => {
      const data: Evaluator = {
        cls: "SomeEvaluator",
        localConfig: {},
      };
      expect(hasUnsavedChanges(data)).toBe(true);
    });
  });

  describe("when signature node has localPromptConfig", () => {
    it("returns true", () => {
      const data: Signature = {
        localPromptConfig: {
          llm: { model: "gpt-4" },
          messages: [{ role: "system", content: "test prompt" }],
          inputs: [],
          outputs: [],
        },
      };
      expect(hasUnsavedChanges(data)).toBe(true);
    });
  });

  describe("when localConfig is cleared (undefined)", () => {
    it("returns false for evaluator with undefined localConfig", () => {
      const data: Evaluator = {
        cls: "SomeEvaluator",
        localConfig: undefined,
      };
      expect(hasUnsavedChanges(data)).toBe(false);
    });

    it("returns false for signature with undefined localPromptConfig", () => {
      const data: Signature = {
        localPromptConfig: undefined,
      };
      expect(hasUnsavedChanges(data)).toBe(false);
    });
  });
});
