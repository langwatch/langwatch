import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../_constants";
import { VercelExtractor } from "../vercel";
import { createExtractorContext } from "./_testHelpers";

describe("VercelExtractor", () => {
  const extractor = new VercelExtractor();

  describe("when instrumentationScope.name is 'ai'", () => {
    it("processes the span and sets span type from span name", () => {
      const ctx = createExtractorContext(
        {},
        {
          name: "ai.generateText",
          instrumentationScope: { name: "ai", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
      expect(ctx.setAttr).toHaveBeenCalled();
    });

    it("records a rule for span type mapping", () => {
      const ctx = createExtractorContext(
        {},
        {
          name: "ai.generateText",
          instrumentationScope: { name: "ai", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.recordRule).toHaveBeenCalledWith(
        "vercel:span.name->langwatch.span.type",
      );
    });

    it("sets model attributes when ai.model is provided", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_MODEL]: JSON.stringify({
            id: "gpt-4",
            provider: "openai.chat",
          }),
        },
        {
          name: "ai.generateText",
          instrumentationScope: { name: "ai", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MODEL]).toBe("openai/gpt-4");
      expect(ctx.out[ATTR_KEYS.GEN_AI_RESPONSE_MODEL]).toBe("openai/gpt-4");
    });
  });

  describe("when ai.response contains .object (generateObject / streamObject)", () => {
    const aiSpan = {
      name: "ai.generateObject" as const,
      instrumentationScope: { name: "ai" as const, version: null },
    };

    it("extracts ai.response.object as output messages", () => {
      const objectPayload = { name: "Alice", age: 30 };
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_RESPONSE]: JSON.stringify({
            object: JSON.stringify(objectPayload),
          }),
        },
        aiSpan,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual([
        { role: "assistant", content: JSON.stringify(objectPayload) },
      ]);
    });

    it("extracts ai.response.object as flat attribute fallback", () => {
      const objectPayload = { name: "Bob", score: 42 };
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_RESPONSE_OBJECT]: JSON.stringify(objectPayload),
        },
        aiSpan,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual([
        { role: "assistant", content: JSON.stringify(objectPayload) },
      ]);
    });

    it("prefers .text over .object when both are present", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_RESPONSE]: JSON.stringify({
            text: "hello",
            object: JSON.stringify({ key: "val" }),
          }),
        },
        aiSpan,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_OUTPUT_MESSAGES]).toEqual([
        { role: "assistant", content: "hello" },
      ]);
    });
  });

  describe("when instrumentationScope.name is not 'ai' but ai.* attrs are present", () => {
    it("still lifts (covers opencode/embedded-Vercel-SDK case)", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_MODEL]: JSON.stringify({
            id: "gpt-4",
            provider: "openai.chat",
          }),
        },
        {
          name: "ai.generateText",
          instrumentationScope: { name: "opencode", version: null },
        },
      );

      extractor.apply(ctx);

      // Span type + model lift fire because ai.model attr triggers the gate
      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("llm");
      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MODEL]).toBe("openai/gpt-4");
    });
  });

  describe("when scope is unrelated AND no ai.* attrs are present", () => {
    it("returns early with nothing in out", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.GEN_AI_REQUEST_MODEL]: "claude-haiku-4-5",
        },
        {
          name: "spanWithoutAiAttrs",
          instrumentationScope: { name: "opentelemetry", version: null },
        },
      );

      extractor.apply(ctx);

      expect(Object.keys(ctx.out)).toHaveLength(0);
      expect(ctx.setAttr).not.toHaveBeenCalled();
      expect(ctx.recordRule).not.toHaveBeenCalled();
    });
  });

  describe("when instrumentationScope.name is undefined but ai.* attrs are present", () => {
    it("still lifts via attrs-presence fallback", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_MODEL]: JSON.stringify({
            id: "gpt-4",
            provider: "openai.chat",
          }),
        },
        {
          name: "ai.generateText",
          instrumentationScope: {
            name: undefined as unknown as string,
            version: null,
          },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_REQUEST_MODEL]).toBe("openai/gpt-4");
    });
  });

  describe("when the AI SDK reports cache token details", () => {
    it("maps inputTokenDetails.cacheWriteTokens to gen_ai cache_creation (opencode Path B)", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_MODEL]: JSON.stringify({
            id: "claude-haiku-4-5",
            provider: "anthropic",
          }),
          [ATTR_KEYS.AI_USAGE_CACHE_WRITE_TOKENS]: 12629,
          [ATTR_KEYS.AI_USAGE_CACHE_READ_TOKENS]: 0,
        },
        {
          name: "ai.streamText.doStream",
          instrumentationScope: { name: "opencode", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_CREATION_INPUT_TOKENS]).toBe(
        12629,
      );
      // a zero read count is not surfaced as a redundant gen_ai attr
      expect(
        ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS],
      ).toBeUndefined();
    });

    it("maps inputTokenDetails.cacheReadTokens to gen_ai cache_read on a cached turn", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_MODEL]: JSON.stringify({
            id: "claude-haiku-4-5",
            provider: "anthropic",
          }),
          [ATTR_KEYS.AI_USAGE_CACHE_READ_TOKENS]: 12629,
        },
        {
          name: "ai.streamText.doStream",
          instrumentationScope: { name: "opencode", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]).toBe(
        12629,
      );
    });

    it("falls back to the cachedInputTokens alias for the read count", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_MODEL]: JSON.stringify({
            id: "claude-haiku-4-5",
            provider: "anthropic",
          }),
          [ATTR_KEYS.AI_USAGE_CACHED_INPUT_TOKENS]: 8745,
        },
        {
          name: "ai.streamText.doStream",
          instrumentationScope: { name: "opencode", version: null },
        },
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]).toBe(
        8745,
      );
    });
  });
});
