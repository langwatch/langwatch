import { describe, expect, it } from "vitest";
import type { MaybeStoredModelProvider } from "../../server/modelProviders/registry";
import { getCustomModels } from "../ModelSelector";

const makeProvider = (
  overrides: Partial<MaybeStoredModelProvider> & { provider: string },
): MaybeStoredModelProvider => ({
  enabled: true,
  customKeys: null,
  models: null,
  embeddingsModels: null,
  customModels: null,
  customEmbeddingsModels: null,
  deploymentMapping: null,
  extraHeaders: null,
  ...overrides,
});

describe("getCustomModels()", () => {
  describe("when all providers are enabled and have no custom models", () => {
    it("returns all registry models from the options list", () => {
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: makeProvider({ provider: "openai" }),
        anthropic: makeProvider({ provider: "anthropic" }),
      };

      const options = [
        "openai/gpt-4o",
        "openai/gpt-4o-mini",
        "anthropic/claude-sonnet-4-20250514",
      ];

      const result = getCustomModels(providers, options, "chat");

      expect(result).toEqual(expect.arrayContaining(options));
      expect(result).toHaveLength(3);
    });
  });

  describe("when a provider is disabled", () => {
    it("excludes that provider's registry models", () => {
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: makeProvider({ provider: "openai" }),
        anthropic: makeProvider({ provider: "anthropic", enabled: false }),
      };

      const options = [
        "openai/gpt-4o",
        "anthropic/claude-sonnet-4-20250514",
      ];

      const result = getCustomModels(providers, options, "chat");

      expect(result).toContain("openai/gpt-4o");
      expect(result).not.toContain("anthropic/claude-sonnet-4-20250514");
    });
  });

  describe("when a provider has custom chat models", () => {
    it("includes both registry models and custom models", () => {
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: makeProvider({
          provider: "openai",
          customModels: [
            {
              modelId: "ft:gpt-4o:my-org",
              displayName: "My Fine-tuned GPT-4o",
              mode: "chat",
            },
          ],
        }),
      };

      const options = ["openai/gpt-4o", "openai/gpt-4o-mini"];

      const result = getCustomModels(providers, options, "chat");

      expect(result).toContain("openai/gpt-4o");
      expect(result).toContain("openai/gpt-4o-mini");
      expect(result).toContain("openai/ft:gpt-4o:my-org");
    });
  });

  describe("when a disabled provider has custom models", () => {
    it("excludes both registry and custom models for that provider", () => {
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: makeProvider({
          provider: "openai",
          enabled: false,
          customModels: [
            {
              modelId: "ft:gpt-4o:my-org",
              displayName: "My Fine-tuned GPT-4o",
              mode: "chat",
            },
          ],
        }),
        anthropic: makeProvider({ provider: "anthropic" }),
      };

      const options = ["openai/gpt-4o", "anthropic/claude-sonnet-4-20250514"];

      const result = getCustomModels(providers, options, "chat");

      expect(result).not.toContain("openai/gpt-4o");
      expect(result).not.toContain("openai/ft:gpt-4o:my-org");
      expect(result).toContain("anthropic/claude-sonnet-4-20250514");
    });
  });

  describe("when mode is embedding", () => {
    it("includes custom embedding models from customEmbeddingsModels", () => {
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: makeProvider({
          provider: "openai",
          customEmbeddingsModels: [
            {
              modelId: "my-custom-embeddings",
              displayName: "Custom Embeddings",
              mode: "embedding",
            },
          ],
        }),
      };

      const options = ["openai/text-embedding-3-small"];

      const result = getCustomModels(providers, options, "embedding");

      expect(result).toContain("openai/text-embedding-3-small");
      expect(result).toContain("openai/my-custom-embeddings");
    });
  });

  describe("when mode is chat", () => {
    it("does not include customEmbeddingsModels", () => {
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: makeProvider({
          provider: "openai",
          customEmbeddingsModels: [
            {
              modelId: "my-custom-embeddings",
              displayName: "Custom Embeddings",
              mode: "embedding",
            },
          ],
        }),
      };

      const options = ["openai/gpt-4o"];

      const result = getCustomModels(providers, options, "chat");

      expect(result).toContain("openai/gpt-4o");
      expect(result).not.toContain("openai/my-custom-embeddings");
    });
  });

  describe("when mode is embedding", () => {
    it("does not include customModels (chat-only)", () => {
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: makeProvider({
          provider: "openai",
          customModels: [
            {
              modelId: "ft:gpt-4o:my-org",
              displayName: "My Fine-tuned GPT-4o",
              mode: "chat",
            },
          ],
        }),
      };

      const options = ["openai/text-embedding-3-small"];

      const result = getCustomModels(providers, options, "embedding");

      expect(result).toContain("openai/text-embedding-3-small");
      expect(result).not.toContain("openai/ft:gpt-4o:my-org");
    });
  });

  describe("when a provider has no entry in the modelProviders record", () => {
    it("excludes models from unknown providers", () => {
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: makeProvider({ provider: "openai" }),
      };

      const options = [
        "openai/gpt-4o",
        "unknown_provider/some-model",
      ];

      const result = getCustomModels(providers, options, "chat");

      expect(result).toContain("openai/gpt-4o");
      expect(result).not.toContain("unknown_provider/some-model");
    });
  });

  describe("when no providers are configured", () => {
    it("returns an empty array", () => {
      const providers: Record<string, MaybeStoredModelProvider> = {};

      const options = ["openai/gpt-4o"];

      const result = getCustomModels(providers, options, "chat");

      expect(result).toEqual([]);
    });
  });

  describe("when multiple providers have custom models", () => {
    it("includes custom models from all enabled providers", () => {
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: makeProvider({
          provider: "openai",
          customModels: [
            {
              modelId: "ft:gpt-4o:acme",
              displayName: "ACME GPT",
              mode: "chat",
            },
          ],
        }),
        anthropic: makeProvider({
          provider: "anthropic",
          customModels: [
            {
              modelId: "my-claude",
              displayName: "My Claude",
              mode: "chat",
            },
          ],
        }),
      };

      const options = ["openai/gpt-4o", "anthropic/claude-sonnet-4-20250514"];

      const result = getCustomModels(providers, options, "chat");

      expect(result).toContain("openai/gpt-4o");
      expect(result).toContain("anthropic/claude-sonnet-4-20250514");
      expect(result).toContain("openai/ft:gpt-4o:acme");
      expect(result).toContain("anthropic/my-claude");
    });
  });

  describe("when custom model has same ID as a registry model", () => {
    it("does not duplicate the model in the result", () => {
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: makeProvider({
          provider: "openai",
          customModels: [
            {
              modelId: "gpt-4o",
              displayName: "GPT-4o Custom",
              mode: "chat",
            },
          ],
        }),
      };

      const options = ["openai/gpt-4o"];

      const result = getCustomModels(providers, options, "chat");

      // "openai/gpt-4o" should appear only once because we use a Set
      const gpt4oCount = result.filter((m) => m === "openai/gpt-4o").length;
      expect(gpt4oCount).toBe(1);
    });
  });

  describe("when using default mode parameter", () => {
    it("defaults to chat mode", () => {
      const providers: Record<string, MaybeStoredModelProvider> = {
        openai: makeProvider({
          provider: "openai",
          customModels: [
            {
              modelId: "my-chat-model",
              displayName: "My Chat",
              mode: "chat",
            },
          ],
          customEmbeddingsModels: [
            {
              modelId: "my-embed",
              displayName: "My Embed",
              mode: "embedding",
            },
          ],
        }),
      };

      const options = ["openai/gpt-4o"];

      // No mode argument - should default to "chat"
      const result = getCustomModels(providers, options);

      expect(result).toContain("openai/my-chat-model");
      expect(result).not.toContain("openai/my-embed");
    });
  });
});
