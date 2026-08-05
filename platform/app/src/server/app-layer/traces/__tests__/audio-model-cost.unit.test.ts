import { describe, expect, it } from "vitest";
import { getProviderModelOptions } from "../../../modelProviders/registry";
import { estimateCost } from "../../../tracer/collector/cost";
import { computeSpanCost } from "../model-cost-matching";

// Catalog rates under test (llmModels.overlay.json): flash v2 $0.05/1k chars,
// scribe $0.22/hour, gpt-4o-transcribe $0.006/min.
const FLASH_PER_CHAR = 5e-5;
const SCRIBE_PER_SECOND = 6.11e-5;
const TRANSCRIBE_PER_SECOND = 1e-4;

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
    expect(
      estimateCost({ llmModelCost: ttsEntry, inputCharacters: 2000 }),
    ).toBeCloseTo(2000 * FLASH_PER_CHAR, 10);

    const sttEntry = {
      projectId: "",
      model: "elevenlabs/scribe_v1",
      regex: "^(elevenlabs\\/)?scribe_v1",
      inputCostPerSecond: SCRIBE_PER_SECOND,
    };
    expect(
      estimateCost({ llmModelCost: sttEntry, audioSeconds: 3600 }),
    ).toBeCloseTo(3600 * SCRIBE_PER_SECOND, 10);

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

  /** @scenario gpt-4o-transcribe bills at its own audio rate, not gpt-4o's chat rate */
  it("prices gpt-4o-transcribe per second even when token usage is reported", () => {
    const result = computeSpanCost({
      attrs: {
        "gen_ai.request.model": "openai/gpt-4o-transcribe",
        "gen_ai.usage.audio_seconds": 60,
      },
      promptTokens: 100,
      completionTokens: 20,
    });
    // The explicit transcribe entry carries zero token rates and a
    // per-second rate; a gpt-4o prefix match would have priced the
    // tokens at chat rates instead.
    expect(result).toBeCloseTo(60 * TRANSCRIBE_PER_SECOND, 10);
  });

  /** @scenario speech and transcription models are not offered as chat models */
  it("keeps audio entries out of chat and embedding selectors", () => {
    const elevenChat = getProviderModelOptions("elevenlabs", "chat");
    const elevenEmbedding = getProviderModelOptions("elevenlabs", "embedding");
    expect(elevenChat).toHaveLength(0);
    expect(elevenEmbedding).toHaveLength(0);

    const openaiChat = getProviderModelOptions("openai", "chat").map(
      (o) => o.value,
    );
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
