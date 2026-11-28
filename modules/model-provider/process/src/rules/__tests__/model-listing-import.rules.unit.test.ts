/**
 * Merging a provider's listing into its custom model lists.
 * @see specs/model-providers/custom-provider-model-import.feature
 */
import type { Model } from "@langwatch/model-provider-contract";
import { describe, expect, it } from "vitest";

import { MAX_IMPORTED_LIST_SIZE, mergeListedModels } from "../model-listing-import.rules.ts";

const chat = (id: string, extra: Partial<Model> = {}): Model => ({
  id,
  label: id,
  type: "chat",
  ...extra,
});

describe("mergeListedModels", () => {
  describe("given a provider with no custom models and no previous listing", () => {
    /** @scenario The first import adds every listed model */
    it("adds every listed model, sorted by id, with the id as its label", () => {
      const merged = mergeListedModels({
        listed: [{ id: "model-b" }, { id: "model-a", maxTokens: 8192, hasReasoning: true }],
        customModels: [],
        customEmbeddingsModels: [],
        previouslyListedIds: null,
      });

      expect(merged.customModels).toEqual([
        chat("model-a", { maxTokens: 8192, supportedParameters: ["reasoning"] }),
        chat("model-b"),
      ]);
      expect(merged.added).toBe(2);
      expect(merged.listedModelIds).toEqual(["model-b", "model-a"]);
    });

    it("adds an entry marked as embeddings to the embeddings list", () => {
      const merged = mergeListedModels({
        listed: [{ id: "embed-a", isEmbedding: true }],
        customModels: [],
        customEmbeddingsModels: [],
        previouslyListedIds: null,
      });

      expect(merged.customModels).toEqual([]);
      expect(merged.customEmbeddingsModels).toEqual([
        { id: "embed-a", label: "embed-a", type: "embedding" },
      ]);
    });
  });

  describe("given a custom model the user edited", () => {
    /** @scenario Existing entries are kept untouched */
    it("keeps the label and max tokens the user set", () => {
      const edited = chat("model-a", { label: "My Model A", maxTokens: 4096 });

      const merged = mergeListedModels({
        listed: [{ id: "model-a", maxTokens: 131072 }],
        customModels: [edited],
        customEmbeddingsModels: [],
        previouslyListedIds: null,
      });

      expect(merged.customModels).toEqual([edited]);
      expect(merged.added).toBe(0);
    });
  });

  describe("given a previous listing", () => {
    /** @scenario A later import adds models new to the listing */
    it("adds only the models new since that listing", () => {
      const merged = mergeListedModels({
        listed: [{ id: "model-a" }, { id: "model-b" }],
        customModels: [chat("model-a")],
        customEmbeddingsModels: [],
        previouslyListedIds: ["model-a"],
      });

      expect(merged.customModels.map((model) => model.id)).toEqual(["model-a", "model-b"]);
      expect(merged.added).toBe(1);
    });

    /** @scenario A model the endpoint stopped listing stays */
    it("keeps a model the endpoint no longer lists", () => {
      const merged = mergeListedModels({
        listed: [{ id: "model-new" }],
        customModels: [chat("model-old")],
        customEmbeddingsModels: [],
        previouslyListedIds: ["model-old"],
      });

      expect(merged.customModels.map((model) => model.id)).toEqual(["model-old", "model-new"]);
      expect(merged.listedModelIds).toEqual(["model-new"]);
    });

    /** @scenario A model the user removed is not imported again */
    it("does not add back a model the user removed", () => {
      const merged = mergeListedModels({
        listed: [{ id: "model-a" }, { id: "model-b" }],
        customModels: [chat("model-b")],
        customEmbeddingsModels: [],
        previouslyListedIds: ["model-a", "model-b"],
      });

      expect(merged.customModels.map((model) => model.id)).toEqual(["model-b"]);
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
        customEmbeddingsModels: [{ id: "embed-a", label: "embed-a", type: "embedding" }],
        previouslyListedIds: null,
      });

      expect(merged.customModels).toEqual([]);
      expect(merged.customEmbeddingsModels).toHaveLength(1);
      expect(merged.added).toBe(0);
    });
  });

  describe("given lists that grow toward the cap across imports", () => {
    /** @scenario Imports stop filling the lists at the listing cap */
    it("adds only up to the cap and leaves the rest unrecorded for a later import", () => {
      const existing = Array.from({ length: MAX_IMPORTED_LIST_SIZE - 1 }, (_, index) =>
        chat(`kept-${index}`),
      );

      const merged = mergeListedModels({
        listed: [{ id: "new-b" }, { id: "new-a" }, { id: `kept-0` }],
        customModels: existing,
        customEmbeddingsModels: [],
        previouslyListedIds: null,
      });

      expect(merged.customModels).toHaveLength(MAX_IMPORTED_LIST_SIZE);
      expect(merged.customModels.at(-1)?.id).toBe("new-b");
      expect(merged.added).toBe(1);
      expect(merged.listedModelIds).toEqual(["new-b", "kept-0"]);
    });

    it("keeps every user entry when the lists are already past the cap", () => {
      const existing = Array.from({ length: MAX_IMPORTED_LIST_SIZE + 5 }, (_, index) =>
        chat(`kept-${index}`),
      );

      const merged = mergeListedModels({
        listed: [{ id: "new-a" }],
        customModels: existing,
        customEmbeddingsModels: [],
        previouslyListedIds: ["gone"],
      });

      expect(merged.customModels).toEqual(existing);
      expect(merged.added).toBe(0);
      expect(merged.listedModelIds).toEqual([]);
    });
  });
});
