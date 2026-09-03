import { describe, it, expect } from "vitest";

import {
  extractProvider,
  hasVariantSuffix,
  mapModelId,
  mapProviderName,
  normalizeModelName,
} from "../provider-id-mapping.rules";

describe("extractProvider", () => {
  it("returns the prefix before the first slash", () => {
    expect(extractProvider("openai/gpt-5")).toBe("openai");
    expect(extractProvider("anthropic/claude-opus-4.5")).toBe("anthropic");
    expect(extractProvider("google/gemini-2.5-pro")).toBe("google");
  });

  it("returns the whole id when no slash is present", () => {
    expect(extractProvider("standalone-id")).toBe("standalone-id");
  });
});

describe("mapProviderName", () => {
  it("rewrites google to gemini and x-ai to xai via the default mapping", () => {
    expect(mapProviderName("google")).toBe("gemini");
    expect(mapProviderName("x-ai")).toBe("xai");
  });

  it("preserves providers not in the mapping", () => {
    expect(mapProviderName("openai")).toBe("openai");
    expect(mapProviderName("anthropic")).toBe("anthropic");
    expect(mapProviderName("brand-new-provider")).toBe("brand-new-provider");
  });

  it("honors a custom mapping passed as second arg", () => {
    expect(mapProviderName("foo", { foo: "bar" })).toBe("bar");
  });
});

describe("normalizeModelName", () => {
  describe("when the provider is anthropic", () => {
    it("rewrites every digit-dot-digit pair to dashes", () => {
      expect(normalizeModelName("anthropic", "claude-opus-4.5")).toBe("claude-opus-4-5");
      expect(normalizeModelName("anthropic", "claude-3.5-sonnet")).toBe("claude-3-5-sonnet");
      expect(normalizeModelName("anthropic", "claude-sonnet-4.6")).toBe("claude-sonnet-4-6");
    });

    it("rewrites multiple version segments in the same name", () => {
      expect(normalizeModelName("anthropic", "name-1.2-suffix-3.4")).toBe("name-1-2-suffix-3-4");
    });

    it("leaves non-numeric dots untouched", () => {
      expect(normalizeModelName("anthropic", "model.beta")).toBe("model.beta");
      expect(normalizeModelName("anthropic", "v1-alpha.preview")).toBe("v1-alpha.preview");
    });

    it("returns the input unchanged when no version dots exist", () => {
      expect(normalizeModelName("anthropic", "claude-haiku")).toBe("claude-haiku");
    });
  });

  describe("when the provider is not in the dot-normalized set", () => {
    it("preserves OpenAI dotted ids untouched", () => {
      // OpenAI's API accepts the dotted form for these published ids.
      expect(normalizeModelName("openai", "gpt-5.4-nano")).toBe("gpt-5.4-nano");
      expect(normalizeModelName("openai", "gpt-3.5-turbo")).toBe("gpt-3.5-turbo");
    });

    it("preserves Gemini dotted ids untouched", () => {
      expect(normalizeModelName("gemini", "gemini-2.5-pro")).toBe("gemini-2.5-pro");
      expect(normalizeModelName("gemini", "gemini-3.1-flash-lite-preview")).toBe(
        "gemini-3.1-flash-lite-preview",
      );
    });

    it("preserves xAI, Mistral, DeepSeek dotted ids untouched", () => {
      expect(normalizeModelName("xai", "grok-4.20")).toBe("grok-4.20");
      expect(normalizeModelName("mistralai", "mistral-medium-3.1")).toBe("mistral-medium-3.1");
      expect(normalizeModelName("deepseek", "deepseek-v3.2-exp")).toBe("deepseek-v3.2-exp");
    });
  });
});

describe("mapModelId", () => {
  it("preserves an unmapped provider and an unaffected model name", () => {
    expect(mapModelId("openai/gpt-5")).toBe("openai/gpt-5");
    expect(mapModelId("openai/gpt-5.4-nano")).toBe("openai/gpt-5.4-nano");
  });

  it("rewrites google to gemini while preserving the model name (Gemini keeps dots)", () => {
    expect(mapModelId("google/gemini-2.5-pro")).toBe("gemini/gemini-2.5-pro");
    expect(mapModelId("google/gemini-3.1-flash-lite-preview")).toBe(
      "gemini/gemini-3.1-flash-lite-preview",
    );
  });

  it("rewrites x-ai to xai while preserving the model name (xAI keeps dots)", () => {
    expect(mapModelId("x-ai/grok-2")).toBe("xai/grok-2");
    expect(mapModelId("x-ai/grok-4.20")).toBe("xai/grok-4.20");
  });

  describe("when the mapped provider is Anthropic", () => {
    it("normalizes version dots to dashes in the model name", () => {
      expect(mapModelId("anthropic/claude-opus-4.5")).toBe("anthropic/claude-opus-4-5");
      expect(mapModelId("anthropic/claude-3.5-sonnet")).toBe("anthropic/claude-3-5-sonnet");
      expect(mapModelId("anthropic/claude-sonnet-4.6")).toBe("anthropic/claude-sonnet-4-6");
    });

    it("leaves Anthropic ids without version dots untouched", () => {
      expect(mapModelId("anthropic/claude-haiku")).toBe("anthropic/claude-haiku");
    });
  });
});

describe("hasVariantSuffix", () => {
  it("flags ids ending with known routing-variant suffixes", () => {
    expect(hasVariantSuffix("anthropic/claude:free")).toBe(true);
    expect(hasVariantSuffix("openai/gpt:thinking")).toBe(true);
    expect(hasVariantSuffix("z-ai/glm-4.7:beta")).toBe(true);
  });

  it("returns false when the colon-suffix is purely numeric", () => {
    // numeric suffixes are real model versions, not variant aliases
    expect(hasVariantSuffix("provider/model:0")).toBe(false);
    expect(hasVariantSuffix("bedrock/anthropic.claude-3-sonnet:1")).toBe(false);
  });

  it("returns false for ids without a colon", () => {
    expect(hasVariantSuffix("anthropic/claude-opus-4-5")).toBe(false);
  });
});
