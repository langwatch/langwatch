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

  describe("when instrumentationScope.name is not 'ai'", () => {
    it("returns early with nothing in out", () => {
      const ctx = createExtractorContext(
        {
          [ATTR_KEYS.AI_MODEL]: JSON.stringify({
            id: "gpt-4",
            provider: "openai.chat",
          }),
        },
        {
          name: "ai.generateText",
          instrumentationScope: { name: "opentelemetry", version: null },
        },
      );

      extractor.apply(ctx);

      expect(Object.keys(ctx.out)).toHaveLength(0);
      expect(ctx.setAttr).not.toHaveBeenCalled();
      expect(ctx.recordRule).not.toHaveBeenCalled();
    });
  });

  describe("when instrumentationScope.name is undefined", () => {
    it("returns early with nothing in out", () => {
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

      expect(Object.keys(ctx.out)).toHaveLength(0);
      expect(ctx.setAttr).not.toHaveBeenCalled();
    });
  });
});
