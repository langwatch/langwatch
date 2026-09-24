import { describe, expect, it } from "vitest";

import { spendUsageSchema, type SpendUsage } from "../gateway-spend.schemas.ts";
import {
  findSpendRatingFaults,
  NO_RATE_RULE_CODE,
  rateSpendNanoUsd,
  UNPRICED_QUANTITIES_CODE,
} from "../gateway.spend-rating.ts";

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
