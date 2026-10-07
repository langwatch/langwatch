/**
 * Covers the listing scenarios of
 * specs/model-providers/custom-provider-model-import.feature.
 */
import { describe, expect, it } from "vitest";
import {
  MODEL_LISTING_MAX_MODELS,
  parseModelListing,
  parseModelListingText,
  readBoundedText,
} from "../modelListing";

function streamOf(chunks: string[]) {
  const encoder = new TextEncoder();
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      const next = chunks.shift();
      if (next === undefined) controller.close();
      else controller.enqueue(encoder.encode(next));
    },
    cancel() {
      cancelled = true;
    },
  });
  return { stream, wasCancelled: () => cancelled };
}

describe("parseModelListing", () => {
  describe("given an OpenAI-shaped listing", () => {
    /** @scenario Listing entries become importable models */
    it("yields the listed ids in order", () => {
      const models = parseModelListing({
        object: "list",
        data: [
          { id: "model-a", object: "model" },
          { id: "model-b", object: "model" },
        ],
      });

      expect(models).toEqual([{ id: "model-a" }, { id: "model-b" }]);
    });

    it("skips entries without a usable id and duplicates", () => {
      const models = parseModelListing({
        data: [
          { id: "model-a" },
          { id: "" },
          { id: 42 },
          null,
          "model-x",
          { id: "  model-a  " },
          { id: "x".repeat(300) },
        ],
      });

      expect(models).toEqual([{ id: "model-a" }]);
    });
  });

  describe("given entries that state metadata", () => {
    /** @scenario Listing metadata is read only when the entry states it */
    it("reads max tokens, reasoning and the embeddings marker", () => {
      const models = parseModelListing({
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
      });

      expect(models).toEqual([
        { id: "reasoner", maxTokens: 131072, reasoning: true },
        { id: "vllm-model", maxTokens: 32768 },
        { id: "embed-a", embedding: true },
        { id: "embed-b", embedding: true },
        { id: "embed-c", embedding: true },
        { id: "plain" },
      ]);
    });

    it("does not read an empty reasoning efforts list as reasoning", () => {
      expect(
        parseModelListing({
          data: [{ id: "m", supported_reasoning_efforts: [] }],
        }),
      ).toEqual([{ id: "m" }]);
    });
  });

  describe("given a body that is not a listing", () => {
    /** @scenario A body that is not a model listing yields no listing */
    it("yields no listing", () => {
      expect(parseModelListingText("<html>nope</html>")).toBeUndefined();
      expect(parseModelListingText('{"models": []}')).toBeUndefined();
      expect(parseModelListingText("[]")).toBeUndefined();
      expect(parseModelListingText(undefined)).toBeUndefined();
      expect(parseModelListing(null)).toBeUndefined();
    });

    it("yields an empty listing for an empty data array", () => {
      expect(parseModelListingText('{"data": []}')).toEqual([]);
    });
  });

  describe("given more entries than the model cap", () => {
    /** @scenario A listing is bounded in size and length */
    it("keeps only the first entries up to the cap", () => {
      const data = Array.from(
        { length: MODEL_LISTING_MAX_MODELS + 10 },
        (_, i) => ({ id: `m-${i}` }),
      );

      const models = parseModelListing({ data });

      expect(models).toHaveLength(MODEL_LISTING_MAX_MODELS);
      expect(models?.at(-1)?.id).toBe(`m-${MODEL_LISTING_MAX_MODELS - 1}`);
    });
  });
});

describe("readBoundedText", () => {
  describe("when the body fits the cap", () => {
    it("returns the whole text across chunks", async () => {
      const { stream } = streamOf(['{"data":', '[{"id":"a"}]}']);

      expect(await readBoundedText({ body: stream, maxBytes: 100 })).toBe(
        '{"data":[{"id":"a"}]}',
      );
    });
  });

  describe("when the body is over the cap", () => {
    it("returns nothing and cancels the stream", async () => {
      const { stream, wasCancelled } = streamOf([
        "x".repeat(60),
        "y".repeat(60),
        "z".repeat(60),
        "w".repeat(60),
      ]);

      expect(await readBoundedText({ body: stream, maxBytes: 100 })).toBe(
        undefined,
      );
      expect(wasCancelled()).toBe(true);
    });
  });

  describe("when there is no body", () => {
    it("returns nothing", async () => {
      expect(await readBoundedText({ body: null })).toBeUndefined();
    });
  });
});
