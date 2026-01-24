/**
 * Unit tests for model ID translation at the LiteLLM boundary.
 *
 * LiteLLM expects model IDs with dashes but llmModels.json uses dots.
 * This module tests the runtime dot-to-dash conversion.
 */

import { describe, expect, it } from "vitest";
import { translateModelIdForLitellm } from "../modelIdBoundary";

describe("translateModelIdForLitellm", () => {
  describe("Anthropic Claude models with dots", () => {
    it("translates anthropic/claude-opus-4.5 to anthropic/claude-opus-4-5", () => {
      const result = translateModelIdForLitellm("anthropic/claude-opus-4.5");
      expect(result).toBe("anthropic/claude-opus-4-5");
    });

    it("translates anthropic/claude-sonnet-4.5 to anthropic/claude-sonnet-4-5", () => {
      const result = translateModelIdForLitellm("anthropic/claude-sonnet-4.5");
      expect(result).toBe("anthropic/claude-sonnet-4-5");
    });

    it("translates anthropic/claude-3.5-haiku to anthropic/claude-3-5-haiku", () => {
      const result = translateModelIdForLitellm("anthropic/claude-3.5-haiku");
      expect(result).toBe("anthropic/claude-3-5-haiku");
    });

    it("translates anthropic/claude-3.7-sonnet to anthropic/claude-3-7-sonnet", () => {
      const result = translateModelIdForLitellm("anthropic/claude-3.7-sonnet");
      expect(result).toBe("anthropic/claude-3-7-sonnet");
    });

    it("translates anthropic/claude-3.5-sonnet to anthropic/claude-3-5-sonnet", () => {
      const result = translateModelIdForLitellm("anthropic/claude-3.5-sonnet");
      expect(result).toBe("anthropic/claude-3-5-sonnet");
    });
  });

  describe("OpenAI models unchanged", () => {
    it("preserves openai/gpt-5 unchanged", () => {
      const result = translateModelIdForLitellm("openai/gpt-5");
      expect(result).toBe("openai/gpt-5");
    });

    it("preserves openai/gpt-4o unchanged", () => {
      const result = translateModelIdForLitellm("openai/gpt-4o");
      expect(result).toBe("openai/gpt-4o");
    });
  });

  describe("Gemini models unchanged", () => {
    it("preserves gemini/gemini-2.5-pro unchanged", () => {
      // Gemini uses dots intentionally in their model names
      const result = translateModelIdForLitellm("gemini/gemini-2.5-pro");
      expect(result).toBe("gemini/gemini-2.5-pro");
    });

    it("preserves gemini/gemini-2.0-flash unchanged", () => {
      const result = translateModelIdForLitellm("gemini/gemini-2.0-flash");
      expect(result).toBe("gemini/gemini-2.0-flash");
    });
  });

  describe("Anthropic models without dots unchanged", () => {
    it("preserves anthropic/claude-3-opus unchanged", () => {
      const result = translateModelIdForLitellm("anthropic/claude-3-opus");
      expect(result).toBe("anthropic/claude-3-opus");
    });
  });

  describe("Multiple dots in version", () => {
    it("converts all dots in anthropic/claude-opus-4.5.1 to dashes", () => {
      const result = translateModelIdForLitellm("anthropic/claude-opus-4.5.1");
      expect(result).toBe("anthropic/claude-opus-4-5-1");
    });
  });

  describe("Custom provider prefix", () => {
    it("translates custom/claude-opus-4.5 to custom/claude-opus-4-5", () => {
      const result = translateModelIdForLitellm("custom/claude-opus-4.5");
      expect(result).toBe("custom/claude-opus-4-5");
    });
  });

  describe("Model alias expansion", () => {
    it("translates anthropic/claude-sonnet-4 to anthropic/claude-sonnet-4-20250514", () => {
      const result = translateModelIdForLitellm("anthropic/claude-sonnet-4");
      expect(result).toBe("anthropic/claude-sonnet-4-20250514");
    });

    it("translates anthropic/claude-opus-4 to anthropic/claude-opus-4-20250514", () => {
      const result = translateModelIdForLitellm("anthropic/claude-opus-4");
      expect(result).toBe("anthropic/claude-opus-4-20250514");
    });
  });

  describe("Edge cases", () => {
    it("handles empty string", () => {
      const result = translateModelIdForLitellm("");
      expect(result).toBe("");
    });

    it("handles model without provider prefix", () => {
      const result = translateModelIdForLitellm("claude-3.5-sonnet");
      expect(result).toBe("claude-3-5-sonnet");
    });
  });
});
