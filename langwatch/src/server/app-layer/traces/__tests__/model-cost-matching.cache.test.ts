import { describe, it, expect } from "vitest";

import { ATTR_KEYS } from "~/server/app-layer/traces/canonicalisation/extractors/_constants";
import { computeSpanCost } from "~/server/app-layer/traces/model-cost-matching";
import type { NormalizedAttributes } from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";

// Prompt-cache cost: a span whose prompt was mostly served from cache must be
// priced at the provider's cache-read rate, not the full input rate. A cached
// follow-up was being billed as if every token were fresh input.
//
// Spec: specs/ai-gateway/cache-token-telemetry.feature

describe("computeSpanCost cache pricing", () => {
  describe("given a cached request for a model that carries cache rates", () => {
    /** @scenario "Cost reflects cache pricing, not the full input price" */
    it("prices the cache-read tokens below the full input rate", () => {
      const model = "claude-opus-4-7";
      const cachedTokens = 37127;

      // Mostly served from cache: the fresh input is the small remainder, the
      // bulk is reported as cache_read (the dotted OTel attr the gateway emits).
      const cachedCost = computeSpanCost({
        attrs: {
          [ATTR_KEYS.GEN_AI_USAGE_CACHE_READ_INPUT_TOKENS]: cachedTokens,
        } as unknown as NormalizedAttributes,
        model,
        promptTokens: 510,
        completionTokens: 12,
      });

      // The same token volume billed entirely as fresh input (no cache).
      const fullInputCost = computeSpanCost({
        attrs: {} as unknown as NormalizedAttributes,
        model,
        promptTokens: 510 + cachedTokens,
        completionTokens: 12,
      });

      expect(cachedCost).toBeGreaterThan(0);
      expect(cachedCost).toBeLessThan(fullInputCost);
    });
  });
});
