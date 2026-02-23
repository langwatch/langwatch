import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../_constants";
import { LangWatchExtractor } from "../langwatch";
import { createExtractorContext } from "./_testHelpers";

describe("LangWatchExtractor", () => {
  const extractor = new LangWatchExtractor();

  describe("metrics extraction (langwatch.metrics)", () => {
    describe("when langwatch.metrics has valid cost", () => {
      it("sets langwatch.span.cost via setAttrIfAbsent", () => {
        const ctx = createExtractorContext({
          [ATTR_KEYS.LANGWATCH_METRICS]: JSON.stringify({
            type: "json",
            value: { promptTokens: 100, completionTokens: 50, cost: 0.005 },
          }),
        });

        extractor.apply(ctx);

        expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
          ATTR_KEYS.LANGWATCH_SPAN_COST,
          0.005,
        );
        expect(ctx.out[ATTR_KEYS.LANGWATCH_SPAN_COST]).toBe(0.005);
      });
    });

    describe("when langwatch.metrics has token counts", () => {
      it("sets gen_ai.usage.input_tokens and gen_ai.usage.output_tokens", () => {
        const ctx = createExtractorContext({
          [ATTR_KEYS.LANGWATCH_METRICS]: JSON.stringify({
            type: "json",
            value: { promptTokens: 100, completionTokens: 50, cost: 0.005 },
          }),
        });

        extractor.apply(ctx);

        expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
          ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS,
          100,
        );
        expect(ctx.setAttrIfAbsent).toHaveBeenCalledWith(
          ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS,
          50,
        );
        expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(100);
        expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(50);
      });
    });

    describe("when gen_ai.usage.input_tokens is already set", () => {
      it("does not override (setAttrIfAbsent)", () => {
        const ctx = createExtractorContext({
          [ATTR_KEYS.LANGWATCH_METRICS]: JSON.stringify({
            type: "json",
            value: { promptTokens: 100, completionTokens: 50, cost: 0.005 },
          }),
        });
        // Pre-set token values (as if GenAI extractor ran first)
        ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS] = 200;
        ctx.out[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS] = 75;

        extractor.apply(ctx);

        // setAttrIfAbsent should not override existing values
        expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBe(200);
        expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_OUTPUT_TOKENS]).toBe(75);
      });
    });

    describe("when langwatch.metrics is malformed", () => {
      it("skips gracefully for invalid JSON", () => {
        const ctx = createExtractorContext({
          [ATTR_KEYS.LANGWATCH_METRICS]: "{not valid json",
        });

        expect(() => extractor.apply(ctx)).not.toThrow();
        expect(ctx.out[ATTR_KEYS.LANGWATCH_SPAN_COST]).toBeUndefined();
        expect(ctx.out[ATTR_KEYS.GEN_AI_USAGE_INPUT_TOKENS]).toBeUndefined();
      });

      it("skips gracefully when value is not an object", () => {
        const ctx = createExtractorContext({
          [ATTR_KEYS.LANGWATCH_METRICS]: JSON.stringify({
            type: "json",
            value: "not-an-object",
          }),
        });

        expect(() => extractor.apply(ctx)).not.toThrow();
        expect(ctx.out[ATTR_KEYS.LANGWATCH_SPAN_COST]).toBeUndefined();
      });

      it("skips gracefully when missing type/value structure", () => {
        const ctx = createExtractorContext({
          [ATTR_KEYS.LANGWATCH_METRICS]: JSON.stringify({
            promptTokens: 100,
          }),
        });

        expect(() => extractor.apply(ctx)).not.toThrow();
        expect(ctx.out[ATTR_KEYS.LANGWATCH_SPAN_COST]).toBeUndefined();
      });
    });

    describe("when langwatch.metrics has tokensEstimated: true", () => {
      it("sets langwatch.tokens.estimated", () => {
        const ctx = createExtractorContext({
          [ATTR_KEYS.LANGWATCH_METRICS]: JSON.stringify({
            type: "json",
            value: {
              promptTokens: 100,
              completionTokens: 50,
              cost: 0.005,
              tokensEstimated: true,
            },
          }),
        });

        extractor.apply(ctx);

        expect(ctx.setAttr).toHaveBeenCalledWith(
          ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED,
          true,
        );
        expect(ctx.out[ATTR_KEYS.LANGWATCH_TOKENS_ESTIMATED]).toBe(true);
      });
    });

    describe("when langwatch.span.cost is already in the bag", () => {
      it("does not override (setAttrIfAbsent)", () => {
        const ctx = createExtractorContext({
          [ATTR_KEYS.LANGWATCH_METRICS]: JSON.stringify({
            type: "json",
            value: { promptTokens: 100, completionTokens: 50, cost: 0.005 },
          }),
        });
        // Pre-set cost (as if enrichment or another extractor already set it)
        ctx.out[ATTR_KEYS.LANGWATCH_SPAN_COST] = 0.010;

        extractor.apply(ctx);

        // setAttrIfAbsent should not override existing value
        expect(ctx.out[ATTR_KEYS.LANGWATCH_SPAN_COST]).toBe(0.010);
      });
    });

    describe("when langwatch.metrics has zero cost", () => {
      it("does not set langwatch.span.cost", () => {
        const ctx = createExtractorContext({
          [ATTR_KEYS.LANGWATCH_METRICS]: JSON.stringify({
            type: "json",
            value: { promptTokens: 0, completionTokens: 0, cost: 0 },
          }),
        });

        extractor.apply(ctx);

        expect(ctx.out[ATTR_KEYS.LANGWATCH_SPAN_COST]).toBeUndefined();
      });
    });
  });
});
