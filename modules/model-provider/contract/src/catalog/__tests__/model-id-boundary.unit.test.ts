/**
 * Unit tests for model ID translation at the LiteLLM boundary. LiteLLM
 * expects dashes but llmModels.json uses dots; this tests the runtime
 * dot-to-dash conversion.
 */

import { describe, expect, it } from "vitest";

import { translateModelIdForLitellm } from "../model-id-boundary.ts";

describe("translateModelIdForLitellm", () => {
  describe("given an Anthropic Claude model id with dots", () => {
    /** @scenario "prepareLitellmParams translates Anthropic model ID" */
    it("translates anthropic/claude-opus-4.5 to anthropic/claude-opus-4-5", () => {
      const result = translateModelIdForLitellm("anthropic/claude-opus-4.5");
      expect(result).toBe("anthropic/claude-opus-4-5");
    });

    it("translates anthropic/claude-sonnet-4.5 to anthropic/claude-sonnet-4-5", () => {
      const result = translateModelIdForLitellm("anthropic/claude-sonnet-4.5");
      expect(result).toBe("anthropic/claude-sonnet-4-5");
    });

    it("translates anthropic/claude-3.5-haiku to anthropic/claude-3-5-haiku-20241022", () => {
      const result = translateModelIdForLitellm("anthropic/claude-3.5-haiku");
      expect(result).toBe("anthropic/claude-3-5-haiku-20241022");
    });

    it("translates anthropic/claude-3.7-sonnet to anthropic/claude-3-7-sonnet", () => {
      const result = translateModelIdForLitellm("anthropic/claude-3.7-sonnet");
      expect(result).toBe("anthropic/claude-3-7-sonnet");
    });

    /** @scenario Translates Anthropic Claude 3.5 Sonnet model ID */
    it("translates anthropic/claude-3.5-sonnet to anthropic/claude-3-5-sonnet-20240620", () => {
      // The MODEL_ALIASES map expands 3.5-sonnet to its full dated version
      // (claude-3-5-sonnet-20240620), which LiteLLM requires. The dot-to-dash
      // conversion of "3.5" → "3-5" is implicit in that expanded form.
      const result = translateModelIdForLitellm("anthropic/claude-3.5-sonnet");
      expect(result).toBe("anthropic/claude-3-5-sonnet-20240620");
    });
  });

  describe("given an OpenAI model id", () => {
    /** @scenario "prepareLitellmParams preserves OpenAI model ID" */
    it("preserves openai/gpt-5 unchanged", () => {
      const result = translateModelIdForLitellm("openai/gpt-5");
      expect(result).toBe("openai/gpt-5");
    });

    it("preserves openai/gpt-4o unchanged", () => {
      const result = translateModelIdForLitellm("openai/gpt-4o");
      expect(result).toBe("openai/gpt-4o");
    });
  });

  describe("given a Gemini model id", () => {
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

  describe("given an Anthropic model id without dots", () => {
    it("preserves anthropic/claude-3-opus unchanged", () => {
      const result = translateModelIdForLitellm("anthropic/claude-3-opus");
      expect(result).toBe("anthropic/claude-3-opus");
    });
  });

  describe("given multiple dots in the version", () => {
    it("converts all dots in anthropic/claude-opus-4.5.1 to dashes", () => {
      const result = translateModelIdForLitellm("anthropic/claude-opus-4.5.1");
      expect(result).toBe("anthropic/claude-opus-4-5-1");
    });
  });

  describe("given a custom provider prefix", () => {
    it("keeps custom model ids verbatim (dots are part of the customer's model name)", () => {
      const result = translateModelIdForLitellm("custom/Qwen/Qwen2.5-32B-Instruct");
      expect(result).toBe("custom/Qwen/Qwen2.5-32B-Instruct");
    });
  });

  describe("given a model alias", () => {
    it("translates anthropic/claude-sonnet-4 to anthropic/claude-sonnet-4-20250514", () => {
      const result = translateModelIdForLitellm("anthropic/claude-sonnet-4");
      expect(result).toBe("anthropic/claude-sonnet-4-20250514");
    });

    it("translates anthropic/claude-opus-4 to anthropic/claude-opus-4-20250514", () => {
      const result = translateModelIdForLitellm("anthropic/claude-opus-4");
      expect(result).toBe("anthropic/claude-opus-4-20250514");
    });
  });

  describe("given an edge-case model id", () => {
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
