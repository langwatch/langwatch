import { describe, expect, it, vi } from "vitest";

const warned = vi.fn();
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: (...args: unknown[]) => warned(...args),
    debug: vi.fn(),
  }),
}));

import { GatewayConfigAssemblyAdapter } from "../postgres.gateway-config-assembly.adapter";

const assembly = GatewayConfigAssemblyAdapter.create({ prisma: {} as never });

describe("tryDeclaredModelsForProvider", () => {
  describe("when a custom provider declares models", () => {
    it("declares the customer's own model ids", () => {
      const declared = assembly.tryDeclaredModelsForProvider({
        provider: "custom",
        customModels: [{ modelId: "stealth/ox-alpha", displayName: "Ox", mode: "chat" }],
        customEmbeddingsModels: null,
      });

      expect(declared).toEqual(["stealth/ox-alpha"]);
    });

    it("keeps a model id that contains a slash whole", () => {
      const declared = assembly.tryDeclaredModelsForProvider({
        provider: "custom",
        customModels: ["meta-llama/Llama-3-70B"],
        customEmbeddingsModels: null,
      });

      expect(declared).toContain("meta-llama/Llama-3-70B");
    });

    it("declares chat and embeddings models together", () => {
      const declared = assembly.tryDeclaredModelsForProvider({
        provider: "custom",
        customModels: ["chat-one"],
        customEmbeddingsModels: ["embed-one"],
      });

      expect(declared).toEqual(["chat-one", "embed-one"]);
    });
  });

  describe("when the provider is a hosted family", () => {
    it("declares the shipped catalog with the family prefix removed", () => {
      const declared = assembly.tryDeclaredModelsForProvider({
        provider: "openai",
        customModels: null,
        customEmbeddingsModels: null,
      });

      expect(declared).toContain("gpt-5-mini");
      expect(declared?.some((id) => id.startsWith("openai/"))).toBe(false);
    });

    it("declares the customer's own models alongside the shipped ones", () => {
      const declared = assembly.tryDeclaredModelsForProvider({
        provider: "openai",
        customModels: ["ft:gpt-5-mini:acme:1"],
        customEmbeddingsModels: null,
      });

      expect(declared).toContain("ft:gpt-5-mini:acme:1");
      expect(declared).toContain("gpt-5-mini");
    });

    it("reads Anthropic and Gemini from the same catalog", () => {
      expect(
        assembly.tryDeclaredModelsForProvider({
          provider: "anthropic",
          customModels: null,
          customEmbeddingsModels: null,
        }),
      ).toContain("claude-sonnet-5");
      expect(
        assembly
          .tryDeclaredModelsForProvider({
            provider: "gemini",
            customModels: null,
            customEmbeddingsModels: null,
          })
          ?.every((id) => !id.includes("/")),
      ).toBe(true);
    });
  });

  describe("when a provider declares nothing", () => {
    it("declares nothing at all rather than an empty list", () => {
      // Silence is not a denial: the gateway reads an absent catalog as "this
      // provider said nothing" and keeps it a candidate for a model no other
      // provider claims. An empty list would read as "serves no models".
      expect(
        assembly.tryDeclaredModelsForProvider({
          provider: "bedrock",
          customModels: null,
          customEmbeddingsModels: null,
        }),
      ).toBeUndefined();
      expect(
        assembly.tryDeclaredModelsForProvider({
          provider: "groq",
          customModels: [],
          customEmbeddingsModels: [],
        }),
      ).toBeUndefined();
    });
  });

  describe("when a stored custom model entry fails the strict parse", () => {
    /** @scenario A stored custom model entry that fails the strict parse is dropped loudly */
    it("drops it from the declared list and logs it at warn by name", () => {
      warned.mockClear();
      const declared = assembly.tryDeclaredModelsForProvider({
        provider: "custom",
        customModels: [
          { modelId: "good-model", displayName: "Good", mode: "chat" },
          { modelId: "bad-model", displayName: "Bad", mode: "chat", extra: "nope" },
        ],
        customEmbeddingsModels: null,
      });

      expect(declared).toEqual(["good-model"]);
      expect(warned).toHaveBeenCalledTimes(1);
      const [payload] = warned.mock.calls[0] as [{ rejected: string[] }];
      expect(payload.rejected).toEqual(["bad-model"]);
    });
  });

  describe("when the same model is declared twice", () => {
    it("declares it once, sorted, so the payload does not move on its own", () => {
      const declared = assembly.tryDeclaredModelsForProvider({
        provider: "custom",
        customModels: ["b-model", "a-model"],
        customEmbeddingsModels: ["a-model"],
      });

      expect(declared).toEqual(["a-model", "b-model"]);
    });
  });
});
