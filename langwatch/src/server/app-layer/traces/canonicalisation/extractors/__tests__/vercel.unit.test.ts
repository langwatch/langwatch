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
