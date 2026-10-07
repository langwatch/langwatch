/**
 * Covers the merge scenarios of
 * specs/model-providers/custom-provider-model-import.feature.
 */
import { describe, expect, it } from "vitest";
import { importsModelListing, mergeListedModels } from "../customModelImport";

describe("mergeListedModels", () => {
  describe("given a provider with no custom models and no previous listing", () => {
    /** @scenario The first import adds every listed model */
    it("adds every listed model as a chat model under its plain id", () => {
      const merged = mergeListedModels({
        listed: [
          { id: "model-a", maxTokens: 8192 },
          { id: "model-b", reasoning: true },
        ],
        customModels: undefined,
        customEmbeddingsModels: undefined,
        previouslyListedIds: null,
      });

      expect(merged.customModels).toEqual([
        {
          modelId: "model-a",
          displayName: "model-a",
          mode: "chat",
          maxTokens: 8192,
        },
        {
          modelId: "model-b",
          displayName: "model-b",
          mode: "chat",
          supportedParameters: ["reasoning"],
        },
      ]);
      expect(merged.customEmbeddingsModels).toEqual([]);
      expect(merged.added).toBe(2);
      expect(merged.listedModelIds).toEqual(["model-a", "model-b"]);
    });

    it("adds an entry marked as embeddings to the embeddings list", () => {
      const merged = mergeListedModels({
        listed: [{ id: "embed-a", embedding: true }],
        customModels: [],
        customEmbeddingsModels: [],
        previouslyListedIds: null,
      });

      expect(merged.customModels).toEqual([]);
      expect(merged.customEmbeddingsModels).toEqual([
        { modelId: "embed-a", displayName: "embed-a", mode: "embedding" },
      ]);
    });
  });

  describe("given an entry the user edited", () => {
    /** @scenario Existing entries are kept untouched */
    it("keeps it exactly as the user left it", () => {
      const edited = {
        modelId: "model-a",
        displayName: "My Model A",
        mode: "chat" as const,
        maxTokens: 1000,
        supportedParameters: ["temperature" as const],
      };

      const merged = mergeListedModels({
        listed: [{ id: "model-a", maxTokens: 9999, reasoning: true }],
        customModels: [edited],
        customEmbeddingsModels: [],
        previouslyListedIds: null,
      });

      expect(merged.customModels).toEqual([edited]);
      expect(merged.added).toBe(0);
    });

    it("normalises legacy string lists without losing entries", () => {
      const merged = mergeListedModels({
        listed: [{ id: "model-a" }, { id: "model-b" }],
        customModels: ["model-a"],
        customEmbeddingsModels: null,
        previouslyListedIds: null,
      });

      expect(merged.customModels.map((m) => m.modelId)).toEqual([
        "model-a",
        "model-b",
      ]);
      expect(merged.added).toBe(1);
    });
  });

  describe("given a previous listing", () => {
    /** @scenario A later import adds models new to the listing */
    it("adds only the models new since then", () => {
      const merged = mergeListedModels({
        listed: [{ id: "model-a" }, { id: "model-b" }],
        customModels: [
          { modelId: "model-a", displayName: "model-a", mode: "chat" },
        ],
        customEmbeddingsModels: [],
        previouslyListedIds: ["model-a"],
      });

      expect(merged.customModels.map((m) => m.modelId)).toEqual([
        "model-a",
        "model-b",
      ]);
      expect(merged.added).toBe(1);
    });

    /** @scenario A model the endpoint stopped listing stays */
    it("keeps a model the endpoint no longer lists", () => {
      const merged = mergeListedModels({
        listed: [{ id: "model-new" }],
        customModels: [
          { modelId: "model-old", displayName: "model-old", mode: "chat" },
        ],
        customEmbeddingsModels: [],
        previouslyListedIds: ["model-old"],
      });

      expect(merged.customModels.map((m) => m.modelId)).toEqual([
        "model-old",
        "model-new",
      ]);
      expect(merged.listedModelIds).toEqual(["model-new"]);
    });

    /** @scenario A model the user removed is not imported again */
    it("does not add back a model the user removed", () => {
      const merged = mergeListedModels({
        listed: [{ id: "model-a" }, { id: "model-b" }],
        customModels: [
          { modelId: "model-b", displayName: "model-b", mode: "chat" },
        ],
        customEmbeddingsModels: [],
        previouslyListedIds: ["model-a", "model-b"],
      });

      expect(merged.customModels.map((m) => m.modelId)).toEqual(["model-b"]);
      expect(merged.added).toBe(0);
      expect(merged.listedModelIds).toEqual(["model-a", "model-b"]);
    });
  });

  describe("given an existing embeddings model", () => {
    /** @scenario An embeddings model is not duplicated as a chat model */
    it("does not add the same id as a chat model", () => {
      const merged = mergeListedModels({
        listed: [{ id: "embed-a" }],
        customModels: [],
        customEmbeddingsModels: [
          { modelId: "embed-a", displayName: "embed-a", mode: "embedding" },
        ],
        previouslyListedIds: null,
      });

      expect(merged.customModels).toEqual([]);
      expect(merged.customEmbeddingsModels).toHaveLength(1);
      expect(merged.added).toBe(0);
    });
  });
});

describe("importsModelListing", () => {
  const openAIDefaultBaseUrl = "https://api.openai.com/v1";

  /** @scenario Only custom providers and OpenAI on another base URL import */
  it("imports for custom and for OpenAI on another base URL only", () => {
    expect(
      importsModelListing({
        provider: "custom",
        baseUrl: "https://llm.example.com/v1",
        openAIDefaultBaseUrl,
      }),
    ).toBe(true);
    expect(
      importsModelListing({
        provider: "openai",
        baseUrl: "https://llm.example.com/v1",
        openAIDefaultBaseUrl,
      }),
    ).toBe(true);
    expect(
      importsModelListing({
        provider: "openai",
        baseUrl: "https://api.openai.com/",
        openAIDefaultBaseUrl,
      }),
    ).toBe(false);
    expect(
      importsModelListing({
        provider: "openai",
        baseUrl: "",
        openAIDefaultBaseUrl,
      }),
    ).toBe(false);
    expect(
      importsModelListing({
        provider: "anthropic",
        baseUrl: "https://llm.example.com",
        openAIDefaultBaseUrl,
      }),
    ).toBe(false);
  });
});
