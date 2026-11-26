/**
 * Reading a provider's models answer.
 * @see specs/model-providers/custom-provider-model-import.feature
 */
import { describe, expect, it } from "vitest";

import {
  MODEL_LISTING_MAX_CHARACTERS,
  MODEL_LISTING_MAX_MODELS,
  readModelListing,
  readModelListingText,
} from "../model-listing.rules.ts";

const NOT_A_LISTING = { kind: "not-a-listing" };

function listedModels(body: unknown) {
  const read = readModelListing(body);
  if (read.kind !== "listing") throw new Error("expected a listing");
  return read.models;
}

describe("readModelListing", () => {
  describe("given an OpenAI-shaped listing", () => {
    /** @scenario Listing entries become importable models */
    it("yields the listed ids in order", () => {
      expect(
        listedModels({
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
        listedModels({
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
      expect(listedModels({ models: [{ name: "models/gemini-3-pro" }] })).toEqual([
        { id: "gemini-3-pro" },
      ]);
    });
  });

  describe("given entries that state metadata", () => {
    /** @scenario Listing metadata is read only when the entry states it */
    it("reads max tokens, reasoning and the embeddings marker", () => {
      expect(
        listedModels({
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
        listedModels({
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
      expect(readModelListingText("<html>nope</html>")).toEqual(NOT_A_LISTING);
      expect(readModelListingText('{"error": "nope"}')).toEqual(NOT_A_LISTING);
      expect(readModelListingText("[]")).toEqual(NOT_A_LISTING);
      expect(readModelListing(null)).toEqual(NOT_A_LISTING);
    });

    it("yields an empty listing for an empty data array", () => {
      expect(readModelListingText('{"data": []}')).toEqual({ kind: "listing", models: [] });
    });
  });

  describe("given a listing past the size or length cap", () => {
    /** @scenario A listing is bounded in size and length */
    it("treats an oversized body as no listing and keeps only the first entries up to the cap", () => {
      const oversized = JSON.stringify({
        data: [{ id: "a", padding: "x".repeat(MODEL_LISTING_MAX_CHARACTERS) }],
      });
      expect(readModelListingText(oversized)).toEqual(NOT_A_LISTING);

      const data = Array.from({ length: MODEL_LISTING_MAX_MODELS + 10 }, (_, index) => ({
        id: `m-${index}`,
      }));
      const models = listedModels({ data });
      expect(models).toHaveLength(MODEL_LISTING_MAX_MODELS);
      expect(models.at(-1)?.id).toBe(`m-${MODEL_LISTING_MAX_MODELS - 1}`);
    });
  });
});
