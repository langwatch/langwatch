import { describe, it, expect } from "vitest";
import { formatEvaluatorSchema } from "../tools/discover-evaluator-schema.js";

describe("formatEvaluatorSchema()", () => {
  describe("when called without evaluatorType (overview)", () => {
    it("includes the overview header", () => {
      const result = formatEvaluatorSchema();
      expect(result).toContain("# Available Evaluator Types");
    });

    it("includes category sections", () => {
      const result = formatEvaluatorSchema();
      expect(result).toContain("## safety");
    });

    it("includes evaluator type identifiers", () => {
      const result = formatEvaluatorSchema();
      expect(result).toContain("openai/moderation");
      expect(result).toContain("langevals/exact_match");
    });

    it("includes evaluator display names", () => {
      const result = formatEvaluatorSchema();
      expect(result).toContain("OpenAI Moderation");
    });

    it("instructs the agent to use evaluatorType parameter for full details", () => {
      const result = formatEvaluatorSchema();
      expect(result).toContain(
        "discover_schema({ category: 'evaluators', evaluatorType: '<type>' })",
      );
    });
  });

  describe("when called with a valid evaluatorType (detail)", () => {
    it("includes the evaluator name in the heading", () => {
      const result = formatEvaluatorSchema("openai/moderation");
      expect(result).toContain("# OpenAI Moderation");
    });

    it("includes the evaluator type in backticks", () => {
      const result = formatEvaluatorSchema("openai/moderation");
      expect(result).toContain("`openai/moderation`");
    });

    it("includes the category", () => {
      const result = formatEvaluatorSchema("openai/moderation");
      expect(result).toContain("**Category**: safety");
    });

    it("includes settings with descriptions and defaults", () => {
      const result = formatEvaluatorSchema("openai/moderation");
      expect(result).toContain("## Settings");
      expect(result).toContain("**model**");
      expect(result).toContain("Default:");
    });

    it("includes required/optional fields section", () => {
      const result = formatEvaluatorSchema("openai/moderation");
      expect(result).toContain("## Fields");
    });

    it("includes result fields", () => {
      const result = formatEvaluatorSchema("openai/moderation");
      expect(result).toContain("## Result Fields");
    });

    it("includes a usage example with evaluatorType", () => {
      const result = formatEvaluatorSchema("openai/moderation");
      expect(result).toContain("## Usage Example");
      expect(result).toContain('"evaluatorType"');
    });

    it("includes env vars when the evaluator requires them", () => {
      const result = formatEvaluatorSchema("azure/content_safety");
      expect(result).toContain("## Required Environment Variables");
      expect(result).toContain("AZURE_CONTENT_SAFETY_ENDPOINT");
    });
  });

  describe("when called with an unknown evaluatorType", () => {
    it("returns an error message with guidance", () => {
      const result = formatEvaluatorSchema("nonexistent/type");
      expect(result).toContain("Unknown evaluator type");
      expect(result).toContain("nonexistent/type");
      expect(result).toContain("discover_schema");
    });
  });
});
