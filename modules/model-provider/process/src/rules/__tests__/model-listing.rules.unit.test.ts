/**
 * Reading a provider's models answer.
 * @see specs/model-providers/custom-provider-model-import.feature
 */
import { describe, expect, it } from "vitest";

import {
  MODEL_LISTING_MAX_CHARACTERS,
  MODEL_LISTING_MAX_MODELS,
  listedModelsFromListing,
  listedModelsFromListingText,
} from "../model-listing.rules.ts";

describe("listedModelsFromListing", () => {
  describe("given an OpenAI-shaped listing", () => {
    /** @scenario Listing entries become importable models */
    it("yields the listed ids in order", () => {
      expect(
        listedModelsFromListing({
          object: "list",
          data: [
            { id: "model-a", object: "model" },
            { id: "model-b", object: "model" },
          ],
        }),
      ).toEqual([{ id: "model-a" }, { id: "model-b" }]);
    });

    it("skips entries without a usable id and duplicates", () => {
      expect(
        listedModelsFromListing({
          data: [
            { id: "model-a" },
            { id: "" },
            { id: 42 },
            null,
            "model-x",
            { id: "  model-a  " },
            { id: "x".repeat(300) },
          ],
        }),
      ).toEqual([{ id: "model-a" }]);
    });

    it("reads a Gemini-shaped listing by name", () => {
      expect(listedModelsFromListing({ models: [{ name: "models/gemini-3-pro" }] })).toEqual([
        { id: "gemini-3-pro" },
      ]);
    });
  });

  describe("given entries that state metadata", () => {
    /** @scenario Listing metadata is read only when the entry states it */
    it("reads max tokens, reasoning and the embeddings marker", () => {
      expect(
        listedModelsFromListing({
          data: [
            {
              id: "reasoner",
              context_length: 131072,
              supported_reasoning_efforts: ["low", "high"],
            },
            { id: "vllm-model", max_model_len: 32768 },
            { id: "embed-a", type: "embedding" },
            { id: "embed-b", capabilities: ["embeddings"] },
            { id: "embed-c", capabilities: { embeddings: true } },
            { id: "plain", object: "model", context_length: -1 },
          ],
        }),
      ).toEqual([
        { id: "reasoner", maxTokens: 131072, hasReasoning: true },
        { id: "vllm-model", maxTokens: 32768 },
        { id: "embed-a", isEmbedding: true },
        { id: "embed-b", isEmbedding: true },
        { id: "embed-c", isEmbedding: true },
        { id: "plain" },
      ]);
    });

    it("reads reasoning from supported parameters, never from an empty efforts list", () => {
      expect(
        listedModelsFromListing({
          data: [
            { id: "with", supported_parameters: ["temperature", "reasoning"] },
            { id: "without", supported_parameters: ["temperature"] },
            { id: "empty", supported_reasoning_efforts: [] },
          ],
        }),
      ).toEqual([{ id: "with", hasReasoning: true }, { id: "without" }, { id: "empty" }]);
    });
  });

  describe("given a body that is not a listing", () => {
    /** @scenario A body that is not a model listing yields no listing */
    it("yields no listing", () => {
      expect(listedModelsFromListingText("<html>nope</html>")).toBeNull();
      expect(listedModelsFromListingText('{"error": "nope"}')).toBeNull();
      expect(listedModelsFromListingText("[]")).toBeNull();
      expect(listedModelsFromListing(null)).toBeNull();
    });

    it("yields an empty listing for an empty data array", () => {
      expect(listedModelsFromListingText('{"data": []}')).toEqual([]);
    });
  });

  describe("given a listing past the size or length cap", () => {
    /** @scenario A listing is bounded in size and length */
    it("treats an oversized body as no listing and keeps only the first entries up to the cap", () => {
      const oversized = JSON.stringify({
        data: [{ id: "a", padding: "x".repeat(MODEL_LISTING_MAX_CHARACTERS) }],
      });
      expect(listedModelsFromListingText(oversized)).toBeNull();

      const data = Array.from({ length: MODEL_LISTING_MAX_MODELS + 10 }, (_, index) => ({
        id: `m-${index}`,
      }));
      const models = listedModelsFromListing({ data });
      expect(models).toHaveLength(MODEL_LISTING_MAX_MODELS);
      expect(models?.at(-1)?.id).toBe(`m-${MODEL_LISTING_MAX_MODELS - 1}`);
    });
  });
});
