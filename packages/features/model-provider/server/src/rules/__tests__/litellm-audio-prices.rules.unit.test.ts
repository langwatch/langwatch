import { describe, expect, it } from "vitest";
import {
  litellmPricingById,
  mapLitellmAudioModels,
  type LitellmPriceEntry,
} from "../litellm-audio-prices.rules";

// Shapes lifted from litellm's real model_prices_and_context_window.json.
const FIXTURE: Record<string, LitellmPriceEntry> = {
  "tts-1": { mode: "audio_speech", litellm_provider: "openai", input_cost_per_character: 0.000015 },
  // Prices output seconds at the same rate as input seconds, so the input
  // rate expresses the whole bill and the entry is representable.
  "whisper-1": {
    mode: "audio_transcription",
    litellm_provider: "openai",
    input_cost_per_second: 0.0001,
    output_cost_per_second: 0.0001,
  },
  "elevenlabs/scribe_v1": {
    mode: "audio_transcription",
    litellm_provider: "elevenlabs",
    input_cost_per_second: 0.0000611,
  },
  "elevenlabs/eleven_v3": {
    mode: "audio_speech",
    litellm_provider: "elevenlabs",
    input_cost_per_character: 0.00018,
  },
  // Token-priced transcription. Priced by token rather than by second, which
  // is why reading only per-second rates dropped it and it billed nothing.
  "gpt-4o-transcribe": {
    mode: "audio_transcription",
    litellm_provider: "openai",
    input_cost_per_token: 0.0000025,
    input_cost_per_audio_token: 0.0000025,
    output_cost_per_token: 0.00001,
  },
  // Bills its output by the second of speech produced. The catalog has a
  // per-second field for input only, so this one is reported not imported.
  "gpt-4o-mini-tts": {
    mode: "audio_speech",
    litellm_provider: "openai",
    input_cost_per_token: 0.0000025,
    output_cost_per_token: 0.00001,
    output_cost_per_audio_token: 0.000012,
    output_cost_per_second: 0.00025,
  },
  "gpt-realtime": {
    mode: "realtime",
    litellm_provider: "openai",
    input_cost_per_token: 0.000004,
    input_cost_per_audio_token: 0.000032,
    output_cost_per_token: 0.000016,
    output_cost_per_audio_token: 0.000064,
  },
  // Dated snapshot: excluded as noise.
  "gpt-4o-mini-transcribe-2025-03-20": {
    mode: "audio_transcription",
    litellm_provider: "openai",
    input_cost_per_second: 0.00005,
  },
  // Unsupported provider: excluded.
  "azure/tts-1": {
    mode: "audio_speech",
    litellm_provider: "azure",
    input_cost_per_character: 0.000015,
  },
  // Chat model: excluded regardless of provider.
  "gpt-5-mini": {
    mode: "chat",
    litellm_provider: "openai",
    input_cost_per_token: 0.00000025,
    output_cost_per_token: 0.000002,
  },
};

describe("mapLitellmAudioModels", () => {
  it("maps speech and transcription entries with their audio rates", () => {
    const { entries } = mapLitellmAudioModels(FIXTURE, new Set());
    expect(entries.map((e) => e.id)).toEqual([
      "elevenlabs/eleven_v3",
      "elevenlabs/scribe_v1",
      "openai/gpt-4o-transcribe",
      "openai/gpt-realtime",
      "openai/tts-1",
      "openai/whisper-1",
    ]);

    const tts = entries.find((e) => e.id === "openai/tts-1")!;
    expect(tts.mode).toBe("audio");
    expect(tts.modality).toBe("text->audio");
    expect(tts.supportsAudioOutput).toBe(true);
    expect(tts.supportsAudioInput).toBe(false);
    expect(tts.pricing.inputCostPerCharacter).toBe(0.000015);
    expect(tts.pricing.inputCostPerSecond).toBeUndefined();

    const stt = entries.find((e) => e.id === "elevenlabs/scribe_v1")!;
    expect(stt.modality).toBe("audio->text");
    expect(stt.supportsAudioInput).toBe(true);
    expect(stt.pricing.inputCostPerSecond).toBe(0.0000611);
  });

  it("maps token-priced transcription, the case that billed zero", () => {
    const { entries } = mapLitellmAudioModels(FIXTURE, new Set());
    const transcribe = entries.find((e) => e.id === "openai/gpt-4o-transcribe")!;
    expect(transcribe).toBeDefined();
    expect(transcribe.pricing).toEqual({
      inputCostPerToken: 0.0000025,
      outputCostPerToken: 0.00001,
      audioCostPerToken: 0.0000025,
    });
  });

  it("maps a realtime model, audio rates on both sides", () => {
    const { entries } = mapLitellmAudioModels(FIXTURE, new Set());
    const realtime = entries.find((e) => e.id === "openai/gpt-realtime")!;
    expect(realtime).toBeDefined();
    expect(realtime.pricing).toEqual({
      inputCostPerToken: 0.000004,
      outputCostPerToken: 0.000016,
      audioCostPerToken: 0.000032,
      audioOutputCostPerToken: 0.000064,
    });
    expect(realtime.modality).toBe("audio->audio");
    expect(realtime.supportsAudioInput).toBe(true);
    expect(realtime.supportsAudioOutput).toBe(true);
  });

  it("reports models whose upstream price the catalog cannot express", () => {
    const { entries, unrepresentable } = mapLitellmAudioModels(FIXTURE, new Set());
    expect(entries.map((e) => e.id)).not.toContain("openai/gpt-4o-mini-tts");
    expect(unrepresentable).toEqual([
      { id: "openai/gpt-4o-mini-tts", fields: ["output_cost_per_second"] },
    ]);
  });

  it("keeps a model whose output rate equals its input rate", () => {
    const { entries, unrepresentable } = mapLitellmAudioModels(FIXTURE, new Set());
    expect(entries.map((e) => e.id)).toContain("openai/whisper-1");
    expect(unrepresentable.map((u) => u.id)).not.toContain("openai/whisper-1");
  });

  it("skips ids the overlay already covers, so manual prices win", () => {
    const { entries } = mapLitellmAudioModels(
      FIXTURE,
      new Set(["elevenlabs/scribe_v1", "openai/tts-1"]),
    );
    expect(entries.map((e) => e.id)).toEqual([
      "elevenlabs/eleven_v3",
      "openai/gpt-4o-transcribe",
      "openai/gpt-realtime",
      "openai/whisper-1",
    ]);
  });

  it("excludes dated snapshots, other providers, and chat models", () => {
    const { entries } = mapLitellmAudioModels(FIXTURE, new Set());
    const ids = entries.map((e) => e.id);
    expect(ids).not.toContain("openai/gpt-4o-mini-transcribe-2025-03-20");
    expect(ids.some((id) => id.startsWith("azure/"))).toBe(false);
    expect(ids).not.toContain("openai/gpt-5-mini");
  });
});

describe("litellmPricingById", () => {
  it("covers every mode and provider, for the drift audit", () => {
    const byId = litellmPricingById(FIXTURE);
    // Chat and other-provider entries are kept here even though the audio
    // importer skips them: the audit compares them against the overlay.
    expect(byId["openai/gpt-5-mini"]?.inputCostPerToken).toBe(0.00000025);
    expect(byId["azure/tts-1"]?.inputCostPerCharacter).toBe(0.000015);
    // Entries the importer holds back are still comparable.
    expect(byId["openai/gpt-realtime"]?.inputCostPerToken).toBe(0.000004);
  });

  it("drops dated snapshots so a stale variant cannot be compared", () => {
    const byId = litellmPricingById(FIXTURE);
    expect("openai/gpt-4o-mini-transcribe-2025-03-20" in byId).toBe(false);
  });
});
