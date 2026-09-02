import { beforeEach, describe, expect, it, vi } from "vitest";
import { EMPTY_SPEND_USAGE, type SpendUsage } from "../schemas/commands";
import {
  NO_RATE_RULE_CODE,
  rateSpendNanoUsd,
  UNPRICED_QUANTITIES_CODE,
} from "../services/spend-rating.service";

// The rating service is the only place that can see a request burn something
// and be charged nothing, and its one way of saying so is this logger.
const warned = vi.fn();
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: (...args: unknown[]) => warned(...args),
    debug: vi.fn(),
  }),
}));

/**
 * Rating for the quantities that are not token classes.
 *
 * The regression this pins: a character-priced call rated at zero because
 * the wire dropped its characters, so $0.18 of speech synthesis moved a
 * budget $0.0002 in production (langwatch/langwatch#6934).
 */

const usage = (overrides: Partial<SpendUsage>): SpendUsage => ({
  ...EMPTY_SPEND_USAGE,
  ...overrides,
});

describe("rateSpendNanoUsd", () => {
  describe("given a character-priced speech call", () => {
    it("rates 4000 characters of openai/tts-1 at exactly $0.06", () => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model: "openai/tts-1",
        usage: usage({ input_chars: 4000 }),
      });
      expect(costNanoUsd).toBe(60_000_000);
    });

    it("rates the same for the bare model id the gateway resolves to", () => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model: "tts-1",
        usage: usage({ input_chars: 4000 }),
      });
      expect(costNanoUsd).toBe(60_000_000);
    });
  });

  describe("given a second-priced transcription call", () => {
    it("rates whisper by the audio duration it carried", () => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model: "openai/whisper-1",
        usage: usage({ audio_ms: 60_000 }),
      });
      expect(costNanoUsd).toBeGreaterThan(0);
    });

    it("rates elevenlabs/convai at $0.08 for a minute of conversation", () => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model: "convai",
        usage: usage({ audio_ms: 60_000 }),
      });
      expect(costNanoUsd).toBe(80_000_000);
    });
  });

  describe("given hour-long cache writes", () => {
    it("prices them above the short-lived rate", () => {
      const short = rateSpendNanoUsd({
        model: "anthropic/claude-sonnet-4.5",
        usage: usage({ cache_creation_input_tokens: 10_000 }),
      }).costNanoUsd;
      const hourLong = rateSpendNanoUsd({
        model: "anthropic/claude-sonnet-4.5",
        usage: usage({
          cache_creation_input_tokens: 10_000,
          cache_creation_1h_tokens: 10_000,
        }),
      }).costNanoUsd;
      expect(hourLong).toBeGreaterThan(short);
    });
  });

  describe("given a realtime call with an audio token split", () => {
    it("prices the audio portion at the audio rate", () => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model: "openai/gpt-realtime",
        usage: usage({
          input_tokens: 200,
          input_audio_tokens: 800,
          output_tokens: 50,
          output_audio_tokens: 250,
        }),
      });
      // 200 * $4/M + 800 * $32/M + 50 * $16/M + 250 * $64/M = $0.0432.
      // Metered as flat text totals instead, the same turn rates $0.0088,
      // a fifth of what the provider charged.
      expect(costNanoUsd).toBe(43_200_000);
    });

    it("charges the smaller model less for the same conversation", () => {
      const full = rateSpendNanoUsd({
        model: "openai/gpt-realtime",
        usage: usage({ input_audio_tokens: 800, output_audio_tokens: 250 }),
      }).costNanoUsd;
      const mini = rateSpendNanoUsd({
        model: "openai/gpt-realtime-mini",
        usage: usage({ input_audio_tokens: 800, output_audio_tokens: 250 }),
      }).costNanoUsd;
      expect(mini).toBeLessThan(full);
    });
  });

  describe("given an image generation with an image token split", () => {
    describe("when the request is rated", () => {
      it("prices gpt-image-2 by its text prompt and its output image tokens", () => {
        const { costNanoUsd } = rateSpendNanoUsd({
          model: "openai/gpt-image-2",
          usage: usage({
            input_tokens: 14,
            output_tokens: 0,
            input_image_tokens: 0,
            output_image_tokens: 196,
            image_count: 1,
          }),
        });
        // 14 * $5/M + 196 * $30/M = $0.00007 + $0.00588 = $0.00595.
        // Metered as flat text totals instead, the same call rates $0.00007,
        // less than two percent of what the provider charged.
        expect(costNanoUsd).toBe(5_950_000);
      });

      it("prices an edit for the image tokens it read as well", () => {
        const { costNanoUsd } = rateSpendNanoUsd({
          model: "openai/gpt-image-1",
          usage: usage({
            input_tokens: 20,
            input_image_tokens: 323,
            output_image_tokens: 1600,
            image_count: 1,
          }),
        });
        // 20 * $5/M + 323 * $10/M + 1600 * $40/M = $0.0001 + $0.00323 + $0.064.
        expect(costNanoUsd).toBe(67_330_000);
      });

      it("charges the mini model less for the same image", () => {
        const full = rateSpendNanoUsd({
          model: "openai/gpt-image-1",
          usage: usage({ output_image_tokens: 1600 }),
        }).costNanoUsd;
        const mini = rateSpendNanoUsd({
          model: "openai/gpt-image-1-mini",
          usage: usage({ output_image_tokens: 1600 }),
        }).costNanoUsd;
        expect(mini).toBeLessThan(full);
      });
    });
  });

  describe("given a model the catalog does not carry", () => {
    /** @scenario A model with no entry at all is reported */
    it("rates zero and leaves the miss visible", () => {
      const { costNanoUsd, rateVersion } = rateSpendNanoUsd({
        model: "nonexistent-vendor/nonexistent-model-xyz",
        usage: usage({ input_tokens: 1000 }),
      });
      expect(costNanoUsd).toBe(0);
      expect(rateVersion.length).toBeGreaterThan(0);
    });
  });

  /**
   * A request that burned something and was charged nothing is a catalog
   * fault, and it has to say so. The gpt-4o transcribe pair proved the quiet
   * case: the model matched an entry, the entry priced seconds, the provider
   * reported tokens, and every call settled at $0 with real usage on the row.
   */
  describe("given a model the catalog prices at zero on purpose", () => {
    beforeEach(() => {
      warned.mockClear();
    });

    describe("when rateSpendNanoUsd rates a request that burned tokens", () => {
      /** @scenario A request that measured nothing is not a fault */
      // A catalog entry whose every rate is zero is a free or bundled model,
      // not a gap. Warning on it would report a fault on every request.
      it("stays quiet, because charging nothing is the right answer", () => {
        const { costNanoUsd } = rateSpendNanoUsd({
          model: "gemini/lyria-3-pro-preview",
          usage: usage({ input_tokens: 1200, output_tokens: 300 }),
        });

        expect(costNanoUsd).toBe(0);
        expect(warned).not.toHaveBeenCalled();
      });
    });
  });

  describe("given a request the catalog cannot price", () => {
    beforeEach(() => {
      warned.mockClear();
    });

    /** @scenario A rule that prices none of the reported quantities is reported */
    it("warns when a matched rule prices none of the reported quantities", () => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model: "openai/tts-1",
        usage: usage({ input_tokens: 65, output_tokens: 22 }),
      });
      expect(costNanoUsd).toBe(0);
      expect(warned).toHaveBeenCalledTimes(1);
      expect(warned.mock.calls[0]?.[0]).toMatchObject({
        code: UNPRICED_QUANTITIES_CODE,
      });
    });

    /** @scenario A rule that prices none of the reported quantities is reported */
    it("names the quantities the request did carry", () => {
      rateSpendNanoUsd({
        model: "openai/tts-1",
        usage: usage({ input_tokens: 65, output_tokens: 22 }),
      });
      expect(warned.mock.calls[0]?.[0]).toMatchObject({
        model: "openai/tts-1",
        measured: { input_tokens: 65, output_tokens: 22 },
      });
    });

    /** @scenario A model with no entry at all is reported */
    it("warns once, not twice, when the model is unknown as well", () => {
      rateSpendNanoUsd({
        model: "nonexistent-vendor/nonexistent-model-xyz",
        usage: usage({ input_tokens: 1000 }),
      });
      expect(warned).toHaveBeenCalledTimes(1);
      expect(warned.mock.calls[0]?.[0]).toMatchObject({
        code: NO_RATE_RULE_CODE,
      });
    });

    /** @scenario The image count is display only and never a billable quantity */
    it("stays quiet when the request carried only an image count", () => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model: "openai/gpt-image-2",
        usage: usage({ image_count: 1 }),
      });
      expect(costNanoUsd).toBe(0);
      expect(warned).not.toHaveBeenCalled();
    });

    /** @scenario A request that measured nothing is not a fault */
    it("stays quiet when the request measured nothing", () => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model: "openai/tts-1",
        usage: usage({}),
      });
      expect(costNanoUsd).toBe(0);
      expect(warned).not.toHaveBeenCalled();
    });

    /** @scenario A request that measured nothing is not a fault */
    it("stays quiet when the rule priced the request", () => {
      const { costNanoUsd } = rateSpendNanoUsd({
        model: "openai/tts-1",
        usage: usage({ input_chars: 4000 }),
      });
      expect(costNanoUsd).toBe(60_000_000);
      expect(warned).not.toHaveBeenCalled();
    });

    /** @scenario A model with no entry at all is reported */
    it("still names an unknown model that measured nothing", () => {
      rateSpendNanoUsd({
        model: "nonexistent-vendor/nonexistent-model-xyz",
        usage: usage({}),
      });
      expect(warned).toHaveBeenCalledTimes(1);
    });
  });
});
