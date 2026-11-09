import { isVariablePriceRouter, llmModels } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { spendUsageSchema, type SpendUsage } from "../features/spend/gateway-spend.schemas.ts";
import {
  currentRegistryRateVersion,
  findSpendRatingFaults,
  NO_RATE_RULE_CODE,
  rateSpendNanoUsd,
  UNPRICED_QUANTITIES_CODE,
  UNPRICED_RATE_VERSION_PREFIX,
} from "../features/spend/gateway.spend-rating.ts";

const usage = (quantities: Partial<SpendUsage>): SpendUsage => spendUsageSchema.parse(quantities);

describe("rateSpendNanoUsd", () => {
  describe("given a character-priced speech call", () => {
    it("rates 4000 characters of openai/tts-1 at exactly $0.06", () => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model: "openai/tts-1",
        usage: usage({ input_chars: 4000 }),
      });
      expect(costNanoUsd).toBe(60_000_000);
    });
  });

  describe("given a second-priced conversation", () => {
    it("rates elevenlabs/convai at $0.08 for a minute", () => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model: "convai",
        usage: usage({ audio_ms: 60_000 }),
      });
      expect(costNanoUsd).toBe(80_000_000);
    });
  });

  describe("given a rate version the caller carried", () => {
    it("stamps the carried version rather than the registry's", () => {
      const { rateVersion } = rateSpendNanoUsd({
        model: "openai/tts-1",
        usage: usage({ input_chars: 1 }),
        rateVersion: "pinned@2026-01-01",
      });
      expect(rateVersion).toBe("pinned@2026-01-01");
    });
  });

  describe("given no rate version", () => {
    it("stamps the registry's version", () => {
      const { rateVersion } = rateSpendNanoUsd({
        model: "openai/tts-1",
        usage: usage({ input_chars: 1 }),
      });
      expect(rateVersion).toMatch(/^registry@/);
    });
  });
});

describe("findSpendRatingFaults", () => {
  describe("given a matched rule that prices none of the reported quantities", () => {
    it("names the unpriced fault and the quantities carried", () => {
      expect(
        findSpendRatingFaults({
          model: "openai/tts-1",
          usage: usage({ input_tokens: 65, output_tokens: 22 }),
        }),
      ).toEqual([
        { code: UNPRICED_QUANTITIES_CODE, measured: { input_tokens: 65, output_tokens: 22 } },
      ]);
    });
  });

  describe("given a model the catalog does not carry", () => {
    it("names the missing rule even when nothing was measured", () => {
      const faults = findSpendRatingFaults({
        model: "nonexistent-vendor/nonexistent-model-xyz",
        usage: usage({}),
      });
      expect(faults.map((fault) => fault.code)).toEqual([NO_RATE_RULE_CODE]);
    });
  });

  describe("given a model the catalog prices at zero on purpose", () => {
    it("finds no fault", () => {
      expect(
        findSpendRatingFaults({
          model: "gemini/lyria-3-pro-preview",
          usage: usage({ input_tokens: 1200, output_tokens: 300 }),
        }),
      ).toEqual([]);
    });
  });

  describe("given a request that carried only an image count", () => {
    it("finds no fault", () => {
      expect(
        findSpendRatingFaults({ model: "openai/gpt-image-2", usage: usage({ image_count: 1 }) }),
      ).toEqual([]);
    });
  });
});

/** Every model id the catalog prices as a router: all its stated rates are negative. */
const VARIABLE_PRICE_ROUTERS = Object.entries(llmModels.models)
  .filter(([, entry]) => isVariablePriceRouter(entry.pricing))
  .map(([modelId]) => modelId)
  .toSorted();

describe("rateSpendNanoUsd for a variable-price router", () => {
  describe("given a gateway request routed through a router", () => {
    it("has routers in the catalog to guard against", () => {
      expect(VARIABLE_PRICE_ROUTERS).toContain("nvidia/switchyard");
    });

    /** @scenario A router call through the gateway never lowers spend */
    it.each(VARIABLE_PRICE_ROUTERS)("never rates %s below zero", (model) => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model,
        usage: usage({ input_tokens: 1000, output_tokens: 500 }),
      });
      expect(costNanoUsd).toBeGreaterThanOrEqual(0);
    });
  });
});

// openai/gpt-5-mini in the catalog: $0.25 in, $2 out per million tokens, $0.01 per web search.
const GPT5MINI_IN = 2.5e-7;
const GPT5MINI_OUT = 2e-6;
const WEB_SEARCH_PER_QUERY = 0.01;

describe("rateSpendNanoUsd for web search tool calls", () => {
  describe("given a model the catalog prices web search on", () => {
    /** @scenario "a spend record with web searches debits them" */
    it("charges three searches at the per-query rate on top of the tokens", () => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model: "openai/gpt-5-mini",
        usage: usage({ input_tokens: 1000, output_tokens: 200, web_search_requests: 3 }),
      });
      expect(costNanoUsd).toBe(
        Math.round((1000 * GPT5MINI_IN + 200 * GPT5MINI_OUT + 3 * WEB_SEARCH_PER_QUERY) * 1e9),
      );
    });
  });

  describe("given an emitter that sends no web search count", () => {
    /** @scenario "a spend record without a web search count rates as before" */
    it("charges the tokens only", () => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model: "openai/gpt-5-mini",
        usage: usage({ input_tokens: 1000, output_tokens: 200 }),
      });
      expect(costNanoUsd).toBe(Math.round((1000 * GPT5MINI_IN + 200 * GPT5MINI_OUT) * 1e9));
    });
  });
});

describe("rateSpendNanoUsd marking unpriced spend", () => {
  describe("given a model the catalog does not carry", () => {
    /** @scenario "an unknown model with usage is stamped unpriced" */
    it("rates zero and stamps the registry version under the unpriced mark", () => {
      const rated = rateSpendNanoUsd({
        model: "nonexistent-vendor/nonexistent-model-xyz",
        usage: usage({ input_tokens: 500, output_tokens: 50 }),
      });
      expect(rated.costNanoUsd).toBe(0);
      expect(rated.rateVersion).toBe(
        `${UNPRICED_RATE_VERSION_PREFIX}${currentRegistryRateVersion()}`,
      );
    });
  });

  describe("given a rule that prices none of the reported quantities", () => {
    /** @scenario "a known model whose rule prices none of the quantities is stamped unpriced" */
    it("stamps the row unpriced", () => {
      const { rateVersion } = rateSpendNanoUsd({
        model: "openai/tts-1",
        usage: usage({ input_tokens: 65, output_tokens: 22 }),
      });
      expect(rateVersion.startsWith(UNPRICED_RATE_VERSION_PREFIX)).toBe(true);
    });
  });

  describe("given a carried rate version on an unknown model", () => {
    /** @scenario "a carried rate version keeps its value under the unpriced mark" */
    it("prefixes the carried version", () => {
      const { rateVersion } = rateSpendNanoUsd({
        model: "nonexistent-vendor/nonexistent-model-xyz",
        usage: usage({ input_tokens: 1 }),
        rateVersion: "pinned@2026-01-01",
      });
      expect(rateVersion).toBe(`${UNPRICED_RATE_VERSION_PREFIX}pinned@2026-01-01`);
    });
  });

  describe("given a priced request, a free model and an empty failure", () => {
    /** @scenario "a priced row, a free model and an empty failure are not marked" */
    it.each([
      { model: "openai/gpt-5-mini", quantities: { input_tokens: 10 } },
      { model: "gemini/lyria-3-pro-preview", quantities: { input_tokens: 1200 } },
      { model: "nonexistent-vendor/nonexistent-model-xyz", quantities: {} },
    ])("leaves $model unmarked", ({ model, quantities }) => {
      const { rateVersion } = rateSpendNanoUsd({ model, usage: usage(quantities) });
      expect(rateVersion.startsWith(UNPRICED_RATE_VERSION_PREFIX)).toBe(false);
    });
  });
});
