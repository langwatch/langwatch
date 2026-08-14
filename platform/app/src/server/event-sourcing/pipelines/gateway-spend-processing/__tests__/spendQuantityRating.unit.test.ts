import { describe, expect, it } from "vitest";
import { EMPTY_SPEND_USAGE, type SpendUsage } from "../schemas/commands";
import { rateSpendNanoUsd } from "../services/spend-rating.service";

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

  describe("given a model the catalog does not carry", () => {
    it("rates zero and leaves the miss visible", () => {
      const { costNanoUsd, rateVersion } = rateSpendNanoUsd({
        model: "nonexistent-vendor/nonexistent-model-xyz",
        usage: usage({ input_tokens: 1000 }),
      });
      expect(costNanoUsd).toBe(0);
      expect(rateVersion.length).toBeGreaterThan(0);
    });
  });
});
