import { describe, expect, it } from "vitest";

import {
  litellmPricingById,
  mapLitellmModels,
  type LitellmPriceEntry,
} from "../litellm-prices.rules.ts";

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

describe("mapLitellmModels", () => {
  it("maps speech and transcription entries with their audio rates", () => {
    const { entries } = mapLitellmModels(FIXTURE, new Set());
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
    const { entries } = mapLitellmModels(FIXTURE, new Set());
    const transcribe = entries.find((e) => e.id === "openai/gpt-4o-transcribe")!;
    expect(transcribe).toBeDefined();
    expect(transcribe.pricing).toEqual({
      inputCostPerToken: 0.0000025,
      outputCostPerToken: 0.00001,
      audioCostPerToken: 0.0000025,
    });
  });

  it("maps a realtime model, audio rates on both sides", () => {
    const { entries } = mapLitellmModels(FIXTURE, new Set());
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
    const { entries, unrepresentable } = mapLitellmModels(FIXTURE, new Set());
    expect(entries.map((e) => e.id)).not.toContain("openai/gpt-4o-mini-tts");
    expect(unrepresentable).toEqual([
      { id: "openai/gpt-4o-mini-tts", fields: ["output_cost_per_second"] },
    ]);
  });

  it("keeps a model whose output rate equals its input rate", () => {
    const { entries, unrepresentable } = mapLitellmModels(FIXTURE, new Set());
    expect(entries.map((e) => e.id)).toContain("openai/whisper-1");
    expect(unrepresentable.map((u) => u.id)).not.toContain("openai/whisper-1");
  });

  it("skips ids the overlay already covers, so manual prices win", () => {
    const { entries } = mapLitellmModels(
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
    const { entries } = mapLitellmModels(FIXTURE, new Set());
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

// Image generation shapes, also lifted from litellm's real registry.
const IMAGE_FIXTURE: Record<string, LitellmPriceEntry> = {
  "gpt-image-2": {
    mode: "image_generation",
    litellm_provider: "openai",
    input_cost_per_token: 0.000005,
    input_cost_per_image_token: 0.000008,
    output_cost_per_token: 0.00001,
    output_cost_per_image_token: 0.00003,
    cache_read_input_token_cost: 0.00000125,
  },
  // No text output rate: the output side is image tokens only.
  "gpt-image-1": {
    mode: "image_generation",
    litellm_provider: "openai",
    input_cost_per_token: 0.000005,
    input_cost_per_image_token: 0.00001,
    output_cost_per_image_token: 0.00004,
    cache_read_input_token_cost: 0.00000125,
  },
  "gpt-image-1-mini": {
    mode: "image_generation",
    litellm_provider: "openai",
    input_cost_per_token: 0.000002,
    input_cost_per_image_token: 0.0000025,
    output_cost_per_image_token: 0.000008,
    cache_read_input_token_cost: 0.0000002,
  },
  "gpt-image-1.5": {
    mode: "image_generation",
    litellm_provider: "openai",
    input_cost_per_token: 0.000005,
    input_cost_per_image_token: 0.000008,
    output_cost_per_token: 0.00001,
    output_cost_per_image_token: 0.000032,
    cache_read_input_token_cost: 0.00000125,
  },
  // Billed a flat amount per image: no per-token rate to import.
  "dall-e-3": {
    mode: "image_generation",
    litellm_provider: "openai",
    input_cost_per_image: 0.04,
  },
  // Per-pixel size variant of the same model.
  "hd/1024-x-1024/dall-e-3": {
    mode: "image_generation",
    litellm_provider: "openai",
    input_cost_per_pixel: 0.00000007629,
    output_cost_per_pixel: 0,
  },
  // Quality and size variant, priced per image. The base id carries the
  // per-token rates.
  "low/1024-x-1024/gpt-image-1": {
    mode: "image_generation",
    litellm_provider: "openai",
    input_cost_per_image: 0.011,
    input_cost_per_pixel: 0.000000010490417,
    output_cost_per_pixel: 0,
  },
  // Dated snapshot: excluded as noise.
  "gpt-image-2-2026-04-21": {
    mode: "image_generation",
    litellm_provider: "openai",
    input_cost_per_token: 0.000005,
    input_cost_per_image_token: 0.000008,
    output_cost_per_image_token: 0.00003,
  },
  // Azure copy: the gateway serves images on openai only.
  "azure/gpt-image-1": {
    mode: "image_generation",
    litellm_provider: "azure",
    input_cost_per_token: 0.000005,
    input_cost_per_image_token: 0.00001,
    output_cost_per_image_token: 0.00004,
  },
};

describe("mapLitellmModels, realtime model with an image rate", () => {
  it("keeps a realtime model that also lists a per-image input rate", () => {
    // The audio and text token rates are the bill for this model. Holding it
    // back over the image rate would leave it with no price at all.
    const { entries, unrepresentable } = mapLitellmModels(
      {
        "gpt-realtime-2.1": {
          mode: "realtime",
          litellm_provider: "openai",
          input_cost_per_token: 0.000004,
          input_cost_per_audio_token: 0.000032,
          input_cost_per_image: 0.000005,
          output_cost_per_token: 0.000024,
          output_cost_per_audio_token: 0.000064,
        },
      },
      new Set(),
    );
    expect(entries.find((e) => e.id === "openai/gpt-realtime-2.1")?.pricing).toEqual({
      inputCostPerToken: 0.000004,
      outputCostPerToken: 0.000024,
      audioCostPerToken: 0.000032,
      audioOutputCostPerToken: 0.000064,
    });
    expect(unrepresentable).toEqual([]);
  });
});

describe("mapLitellmModels, image family", () => {
  it("maps the openai image models with their three token rates", () => {
    const { entries } = mapLitellmModels(IMAGE_FIXTURE, new Set());
    expect(entries.map((e) => e.id)).toEqual([
      "openai/gpt-image-1",
      "openai/gpt-image-1-mini",
      "openai/gpt-image-1.5",
      "openai/gpt-image-2",
    ]);

    const image2 = entries.find((e) => e.id === "openai/gpt-image-2")!;
    expect(image2.mode).toBe("image");
    expect(image2.modality).toBe("text->image");
    expect(image2.supportsImageInput).toBe(true);
    expect(image2.supportsImageOutput).toBe(true);
    expect(image2.supportsAudioInput).toBe(false);
    expect(image2.supportsAudioOutput).toBe(false);
    expect(image2.description).toContain("litellm");
    expect(image2.pricing).toEqual({
      inputCostPerToken: 0.000005,
      outputCostPerToken: 0.00001,
      imageCostPerToken: 0.000008,
      imageOutputCostPerToken: 0.00003,
      inputCacheReadPerToken: 0.00000125,
    });
  });

  it("maps a model whose output side is image tokens only", () => {
    // gpt-image-1 publishes no text output rate. Zero there is correct: the
    // model answers with image tokens, which the image output rate prices.
    const { entries } = mapLitellmModels(IMAGE_FIXTURE, new Set());
    const image1 = entries.find((e) => e.id === "openai/gpt-image-1")!;
    expect(image1.pricing).toEqual({
      inputCostPerToken: 0.000005,
      outputCostPerToken: 0,
      imageCostPerToken: 0.00001,
      imageOutputCostPerToken: 0.00004,
      inputCacheReadPerToken: 0.00000125,
    });

    const mini = entries.find((e) => e.id === "openai/gpt-image-1-mini")!;
    expect(mini.pricing).toEqual({
      inputCostPerToken: 0.000002,
      outputCostPerToken: 0,
      imageCostPerToken: 0.0000025,
      imageOutputCostPerToken: 0.000008,
      inputCacheReadPerToken: 0.0000002,
    });

    const image15 = entries.find((e) => e.id === "openai/gpt-image-1.5")!;
    expect(image15.pricing.imageOutputCostPerToken).toBe(0.000032);
    expect(image15.pricing.outputCostPerToken).toBe(0.00001);
  });

  it("reports a per-image price instead of importing part of it", () => {
    const { entries, unrepresentable } = mapLitellmModels(IMAGE_FIXTURE, new Set());
    expect(entries.map((e) => e.id)).not.toContain("openai/dall-e-3");
    expect(unrepresentable).toEqual([{ id: "openai/dall-e-3", fields: ["input_cost_per_image"] }]);
  });

  it("excludes size variants, dated snapshots and other providers", () => {
    const { entries, unrepresentable } = mapLitellmModels(IMAGE_FIXTURE, new Set());
    const reported = [...entries.map((e) => e.id), ...unrepresentable.map((u) => u.id)];
    // A size variant repeats the base model at one setting, so it is noise
    // rather than a coverage gap.
    expect(reported).not.toContain("openai/hd/1024-x-1024/dall-e-3");
    expect(reported).not.toContain("openai/low/1024-x-1024/gpt-image-1");
    expect(reported.some((id) => id.includes("2026-04-21"))).toBe(false);
    expect(reported.some((id) => id.startsWith("azure/"))).toBe(false);
  });

  it("skips ids the overlay already covers, so manual prices win", () => {
    const { entries } = mapLitellmModels(
      IMAGE_FIXTURE,
      new Set(["openai/gpt-image-2", "openai/gpt-image-1-mini"]),
    );
    expect(entries.map((e) => e.id)).toEqual(["openai/gpt-image-1", "openai/gpt-image-1.5"]);
  });

  it("carries the image token rates into the drift comparison", () => {
    const byId = litellmPricingById(IMAGE_FIXTURE);
    expect(byId["openai/gpt-image-2"]).toMatchObject({
      imageCostPerToken: 0.000008,
      imageOutputCostPerToken: 0.00003,
    });
    // Held back from the import, still comparable against a hand-written rate.
    expect(byId["azure/gpt-image-1"]?.imageOutputCostPerToken).toBe(0.00004);
  });
});

describe("litellmPricingById, cache writes", () => {
  it("carries the standard cache-write rate", () => {
    const byId = litellmPricingById({
      "gpt-5.6-sol": {
        mode: "chat",
        litellm_provider: "openai",
        input_cost_per_token: 4e-6,
        output_cost_per_token: 2e-5,
        cache_read_input_token_cost: 4e-7,
        cache_creation_input_token_cost: 5e-6,
      },
    });
    expect(byId["openai/gpt-5.6-sol"]?.inputCacheWritePerToken).toBe(5e-6);
  });

  it("leaves the field out when the vendor does not charge for writes", () => {
    // DeepSeek publishes 0. A zero rate would read as a price, so it is dropped.
    const byId = litellmPricingById({
      "deepseek/deepseek-v4-flash": {
        mode: "chat",
        litellm_provider: "deepseek",
        input_cost_per_token: 3e-7,
        output_cost_per_token: 1.2e-6,
        cache_creation_input_token_cost: 0,
      },
    });
    expect(byId["deepseek/deepseek-v4-flash"]).not.toHaveProperty("inputCacheWritePerToken");
  });
});
