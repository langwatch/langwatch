import type { LLMModelEntry } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import {
  mapDoublewordModel,
  mapDoublewordModels,
  resolveDoublewordEntries,
  type DoublewordModel,
} from "../doubleword-models.rules.ts";

// Shapes lifted from the live admin models endpoint on 2026-10-08.
const FLASH: DoublewordModel = {
  model_name: "deepseek-ai/DeepSeek-V4.1-Flash",
  display_name: "DeepSeek V4.1 Flash",
  description: "Long description.",
  model_type: "CHAT",
  capabilities: ["reasoning"],
  cache_pricing: {
    enabled: true,
    write_multiplier_5m: "1.2500",
    write_multiplier_1h: "2.0000",
    read_multiplier: "0.0200",
  },
  tariffs: [
    {
      name: "1h",
      input_price_per_token: "0.00000012",
      output_price_per_token: "0.00000048",
      api_key_purpose: "batch",
      is_active: true,
      valid_until: null,
    },
    {
      name: "Realtime",
      input_price_per_token: "0.00000015",
      output_price_per_token: "0.00000060",
      api_key_purpose: "realtime",
      is_active: true,
      valid_until: null,
    },
  ],
  metadata: {
    context_window: 1048576,
    extra: { summary: "DeepSeek's latest open-weight Flash model." },
  },
};

const VISION_NO_CACHE: DoublewordModel = {
  model_name: "tencent/Hy3-FP8",
  display_name: "Hy3",
  model_type: "CHAT",
  capabilities: ["reasoning", "vision"],
  cache_pricing: { enabled: false, read_multiplier: "0.1" },
  tariffs: [
    {
      name: "Realtime",
      input_price_per_token: "0.00000014",
      output_price_per_token: "0.00000058",
      api_key_purpose: "realtime",
      is_active: true,
    },
  ],
  metadata: { context_window: 196608 },
};

const BATCH_ONLY: DoublewordModel = {
  model_name: "Qwen/Qwen3.5-4B",
  model_type: "CHAT",
  capabilities: ["vision"],
  tariffs: [
    {
      name: "24h",
      input_price_per_token: "0.00000004",
      output_price_per_token: "0.00000006",
      api_key_purpose: "batch",
      is_active: true,
    },
  ],
};

const EMBEDDING: DoublewordModel = {
  model_name: "Qwen/Qwen3-Embedding-8B",
  display_name: "Qwen3 Embedding 8B",
  model_type: "EMBEDDINGS",
  capabilities: [],
  tariffs: [
    {
      name: "Realtime",
      input_price_per_token: "0.00000004",
      output_price_per_token: "0",
      api_key_purpose: "realtime",
      is_active: true,
    },
  ],
  metadata: { context_window: 32768 },
};

describe("mapDoublewordModel", () => {
  /** @scenario The catalog sync prices a Doubleword model from its realtime tariff */
  it("prices a chat model from its realtime tariff, not the batch one", () => {
    const entry = mapDoublewordModel(FLASH)!;
    expect(entry.id).toBe("doubleword/deepseek-ai/DeepSeek-V4.1-Flash");
    expect(entry.provider).toBe("doubleword");
    expect(entry.name).toBe("Doubleword: DeepSeek V4.1 Flash");
    expect(entry.mode).toBe("chat");
    expect(entry.contextLength).toBe(1048576);
    expect(entry.description).toBe("DeepSeek's latest open-weight Flash model.");
    expect(entry.pricing.inputCostPerToken).toBeCloseTo(0.00000015, 15);
    expect(entry.pricing.outputCostPerToken).toBeCloseTo(0.0000006, 15);
  });

  it("derives cache rates from the input rate and the multipliers", () => {
    const { pricing } = mapDoublewordModel(FLASH)!;
    expect(pricing.inputCacheReadPerToken).toBeCloseTo(0.00000015 * 0.02, 15);
    expect(pricing.inputCacheWritePerToken).toBeCloseTo(0.00000015 * 1.25, 15);
    expect(pricing.inputCacheWrite1hPerToken).toBeCloseTo(0.00000015 * 2, 15);
  });

  it("carries no cache rates when cache pricing is disabled", () => {
    const entry = mapDoublewordModel(VISION_NO_CACHE)!;
    expect(entry.pricing.inputCacheReadPerToken).toBeUndefined();
    expect(entry.pricing.inputCacheWritePerToken).toBeUndefined();
    expect(entry.supportsImageInput).toBe(true);
    expect(entry.modality).toBe("text+image->text");
  });

  it("leaves out a batch-only model, which the gateway cannot call", () => {
    expect(mapDoublewordModel(BATCH_ONLY)).toBeUndefined();
  });

  it("leaves out a realtime tariff that has expired", () => {
    const expired: DoublewordModel = {
      ...VISION_NO_CACHE,
      tariffs: VISION_NO_CACHE.tariffs!.map((t) => ({
        ...t,
        valid_until: "2026-01-01T00:00:00Z",
      })),
    };
    expect(mapDoublewordModel(expired)).toBeUndefined();
  });

  it("maps an embedding model", () => {
    const entry = mapDoublewordModel(EMBEDDING)!;
    expect(entry.mode).toBe("embedding");
    expect(entry.modality).toBe("text->embeddings");
    expect(entry.supportedParameters).toEqual([]);
    expect(entry.pricing.outputCostPerToken).toBe(0);
  });
});

describe("mapDoublewordModels", () => {
  it("skips excluded ids so overlay corrections win", () => {
    const entries = mapDoublewordModels(
      [FLASH, VISION_NO_CACHE, BATCH_ONLY],
      new Set(["doubleword/tencent/Hy3-FP8"]),
    );
    expect(entries.map((e) => e.id)).toEqual(["doubleword/deepseek-ai/DeepSeek-V4.1-Flash"]);
  });
});

describe("resolveDoublewordEntries", () => {
  const previousModels: Record<string, LLMModelEntry> = {
    "doubleword/kept/Model": { ...mapDoublewordModel(FLASH)!, id: "doubleword/kept/Model" },
    "doubleword/overlaid/Model": { ...mapDoublewordModel(FLASH)!, id: "doubleword/overlaid/Model" },
    "openai/gpt-5": { ...mapDoublewordModel(FLASH)!, id: "openai/gpt-5", provider: "openai" },
  };

  describe("when this run read Doubleword's model list", () => {
    it("answers the fetched models and drops the ones no longer listed", () => {
      const entries = resolveDoublewordEntries({
        fetched: [FLASH, BATCH_ONLY],
        previousModels,
        excludeIds: new Set(),
      });
      expect(entries.map((e) => e.id)).toEqual(["doubleword/deepseek-ai/DeepSeek-V4.1-Flash"]);
    });
  });

  describe("when the key is missing or the request failed", () => {
    /** @scenario The catalog sync keeps the Doubleword models when it cannot read the list */
    it("keeps the Doubleword entries already in the catalog", () => {
      const entries = resolveDoublewordEntries({
        fetched: undefined,
        previousModels,
        excludeIds: new Set(["doubleword/overlaid/Model"]),
      });
      expect(entries.map((e) => e.id)).toEqual(["doubleword/kept/Model"]);
    });
  });
});
