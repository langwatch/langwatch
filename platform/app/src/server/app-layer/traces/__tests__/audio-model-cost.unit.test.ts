import { describe, expect, it } from "vitest";
import { getProviderModelOptions } from "@langwatch/model-provider-contract";
import { estimateCost } from "../../../tracer/collector/cost";
import { computeSpanCost } from "../model-cost-matching";

// Catalog rates under test (llmModels.overlay.json): flash v2 $0.05/1k chars,
// scribe $0.22/hour, gpt-4o-transcribe $2.50/$10.00 per million tokens,
// gpt-transcribe $0.0045/min, gpt-realtime $4/$16 text and $32/$64 audio per
// million tokens.
const FLASH_PER_CHAR = 5e-5;
const SCRIBE_PER_SECOND = 6.11e-5;
const TRANSCRIBE_AUDIO_IN = 2.5e-6;
const TRANSCRIBE_OUT = 1e-5;
const GPT_TRANSCRIBE_PER_SECOND = 7.5e-5;
const REALTIME_TEXT_IN = 4e-6;
const REALTIME_TEXT_OUT = 1.6e-5;
const REALTIME_AUDIO_IN = 3.2e-5;
const REALTIME_AUDIO_OUT = 6.4e-5;

describe("audio model cost", () => {
  /** @scenario a text-to-speech call is costed by the characters it spoke */
  it("prices a TTS span from gen_ai.usage.input_chars", () => {
    const result = computeSpanCost({
      attrs: {
        "gen_ai.request.model": "elevenlabs/eleven_flash_v2",
        "gen_ai.usage.input_chars": 1000,
      },
      promptTokens: null,
      completionTokens: null,
    });
    expect(result).toBeCloseTo(1000 * FLASH_PER_CHAR, 10);
  });

  /** @scenario a transcription call is costed by the audio it heard */
  it("prices an STT span from gen_ai.usage.audio_seconds", () => {
    const result = computeSpanCost({
      attrs: {
        "gen_ai.request.model": "elevenlabs/scribe_v1",
        "gen_ai.usage.audio_seconds": 60,
      },
      promptTokens: null,
      completionTokens: null,
    });
    expect(result).toBeCloseTo(60 * SCRIBE_PER_SECOND, 10);
  });

  /** @scenario an audio call with no token usage still gets a cost */
  it("consults the registry when only audio usage is present, and not when nothing is", () => {
    const withAudio = computeSpanCost({
      attrs: {
        "gen_ai.request.model": "elevenlabs/eleven_flash_v2",
        "gen_ai.usage.input_chars": 500,
      },
      promptTokens: 0,
      completionTokens: 0,
    });
    expect(withAudio).toBeGreaterThan(0);

    const withNothing = computeSpanCost({
      attrs: {
        "gen_ai.request.model": "elevenlabs/eleven_flash_v2",
      },
      promptTokens: 0,
      completionTokens: 0,
    });
    expect(withNothing).toBe(0);
  });

  /** @scenario a model priced only by audio usage is never silently free */
  it("estimateCost handles per-character and per-second entries", () => {
    const ttsEntry = {
      projectId: "",
      model: "elevenlabs/eleven_flash_v2",
      regex: "^(elevenlabs\\/)?eleven_flash_v2",
      inputCostPerCharacter: FLASH_PER_CHAR,
    };
    expect(estimateCost({ llmModelCost: ttsEntry, inputCharacters: 2000 })).toBeCloseTo(
      2000 * FLASH_PER_CHAR,
      10,
    );

    const sttEntry = {
      projectId: "",
      model: "elevenlabs/scribe_v1",
      regex: "^(elevenlabs\\/)?scribe_v1",
      inputCostPerSecond: SCRIBE_PER_SECOND,
    };
    expect(estimateCost({ llmModelCost: sttEntry, audioSeconds: 3600 })).toBeCloseTo(
      3600 * SCRIBE_PER_SECOND,
      10,
    );

    // A rate-less entry still reports "cannot price" rather than zero.
    expect(
      estimateCost({
        llmModelCost: {
          projectId: "",
          model: "x",
          regex: "^x",
        },
        inputCharacters: 100,
      }),
    ).toBeUndefined();
  });

  describe("given a transcribe model that reports audio tokens", () => {
    describe("when the span is costed", () => {
      /** @scenario gpt-4o-transcribe bills at its own audio rate, not gpt-4o's chat rate */
      it("prices gpt-4o-transcribe from the tokens it reports", () => {
        // The response states the whole input as audio tokens and no duration,
        // so a per-second entry priced every call at zero.
        const result = computeSpanCost({
          attrs: {
            "gen_ai.request.model": "openai/gpt-4o-transcribe",
            "gen_ai.usage.input_audio_tokens": 65,
          },
          promptTokens: 0,
          completionTokens: 32,
        });
        expect(result).toBeCloseTo(65 * TRANSCRIBE_AUDIO_IN + 32 * TRANSCRIBE_OUT, 12);
        expect(result).toBeGreaterThan(0);
      });
    });
  });

  describe("given a transcribe model priced by the second", () => {
    describe("when the span is costed", () => {
      /** @scenario the duration-priced transcribe model bills by the second */
      it("prices gpt-transcribe per second", () => {
        const result = computeSpanCost({
          attrs: {
            "gen_ai.request.model": "openai/gpt-transcribe",
            "gen_ai.usage.audio_seconds": 60,
          },
          promptTokens: 0,
          completionTokens: 0,
        });
        expect(result).toBeCloseTo(60 * GPT_TRANSCRIBE_PER_SECOND, 12);
      });
    });
  });

  describe("given a span stating audio tokens beside its text totals", () => {
    describe("when the span is costed", () => {
      /** @scenario an audio turn costs the audio rate on the trace, not the text rate */
      it("prices audio tokens apart from the text totals on a span", () => {
        const attrs = {
          "gen_ai.request.model": "openai/gpt-realtime",
          "gen_ai.usage.input_audio_tokens": 800,
          "gen_ai.usage.output_audio_tokens": 250,
        };
        const result = computeSpanCost({
          attrs,
          promptTokens: 200,
          completionTokens: 50,
        });
        expect(result).toBeCloseTo(
          200 * REALTIME_TEXT_IN +
            50 * REALTIME_TEXT_OUT +
            800 * REALTIME_AUDIO_IN +
            250 * REALTIME_AUDIO_OUT,
          12,
        );

        // The same 1300 tokens priced flat at the text rate, which is what the
        // trace charged while the budget charged the audio rate: $0.0088 against
        // $0.0432, the gap the two surfaces disagreed by.
        const asIfText = computeSpanCost({
          attrs: { "gen_ai.request.model": "openai/gpt-realtime" },
          promptTokens: 1000,
          completionTokens: 300,
        });
        expect(asIfText).toBeCloseTo(0.0088, 12);
        expect(result).toBeCloseTo(0.0432, 12);
      });
    });
  });

  describe("given several transcribe entries sharing a prefix", () => {
    describe("when each model id is matched", () => {
      /** @scenario each transcribe model matches its own rate, not a shorter neighbour's */
      it("keeps the transcribe entries from capturing each other", () => {
        // Registry matching is prefix-anchored, so these three ids all start with
        // one another's stems. Each must land on its own rate.
        const perSecond = computeSpanCost({
          attrs: {
            "gen_ai.request.model": "openai/gpt-transcribe",
            "gen_ai.usage.audio_seconds": 60,
          },
          promptTokens: 0,
          completionTokens: 0,
        });
        expect(perSecond).toBeCloseTo(60 * GPT_TRANSCRIBE_PER_SECOND, 12);

        const mini = computeSpanCost({
          attrs: { "gen_ai.request.model": "openai/gpt-4o-mini-transcribe" },
          promptTokens: 0,
          completionTokens: 100,
        });
        expect(mini).toBeCloseTo(100 * 5e-6, 12);

        // A diarize call has no published rate of its own and OpenAI charges it
        // the same as gpt-4o-transcribe, so the prefix match is the right answer.
        const diarize = computeSpanCost({
          attrs: { "gen_ai.request.model": "openai/gpt-4o-transcribe-diarize" },
          promptTokens: 0,
          completionTokens: 100,
        });
        expect(diarize).toBeCloseTo(100 * TRANSCRIBE_OUT, 12);
      });
    });
  });

  /** @scenario speech and transcription models are not offered as chat models */
  it("keeps audio entries out of chat and embedding selectors", () => {
    const elevenChat = getProviderModelOptions("elevenlabs", "chat");
    const elevenEmbedding = getProviderModelOptions("elevenlabs", "embedding");
    expect(elevenChat).toHaveLength(0);
    expect(elevenEmbedding).toHaveLength(0);

    const openaiChat = getProviderModelOptions("openai", "chat").map((o) => o.value);
    for (const audioModel of [
      "tts-1",
      "tts-1-hd",
      "gpt-4o-mini-tts",
      "whisper-1",
      "gpt-4o-transcribe",
      "gpt-4o-mini-transcribe",
    ]) {
      expect(openaiChat).not.toContain(audioModel);
    }
  });
});
