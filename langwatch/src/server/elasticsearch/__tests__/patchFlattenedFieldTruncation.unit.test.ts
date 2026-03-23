import { Client as ElasticClient } from "@elastic/elasticsearch";
import { describe, expect, it } from "vitest";
import { patchForFlattenedFieldTruncation } from "../patchFlattenedFieldTruncation";

/**
 * Tests for the ES flattened-field truncation patch.
 *
 * We create a real ElasticClient, replace its index/update/bulk methods
 * with captures, then apply the patch on top. The patch wraps those
 * captures, so we see exactly what the patch passes to the original method.
 */

const OVERSIZED = "x".repeat(33_000); // > 32,766 bytes
const SMALL = "hello";
const encoder = new TextEncoder();
const byteLen = (s: string) => encoder.encode(s).length;

function createPatchedClient(): {
  client: ElasticClient;
  captured: Array<{ method: string; params: any }>;
} {
  const client = new ElasticClient({ node: "http://localhost:19200" });
  const captured: Array<{ method: string; params: any }> = [];

  // Replace methods with captures BEFORE patching.
  // The patch wraps these, so we see what the patch passes through.
  // @ts-ignore
  client.index = async (params: any) => {
    captured.push({ method: "index", params });
  };
  // @ts-ignore
  client.update = async (params: any) => {
    captured.push({ method: "update", params });
  };
  // @ts-ignore
  client.bulk = async (params: any) => {
    captured.push({ method: "bulk", params });
  };

  patchForFlattenedFieldTruncation(client);

  return { client, captured };
}

describe("patchForFlattenedFieldTruncation", () => {
  describe("when calling client.index", () => {
    it("truncates oversized leaf strings in the body", async () => {
      const { client, captured } = createPatchedClient();

      await client.index({
        index: "test-index",
        body: {
          small: SMALL,
          big: OVERSIZED,
          nested: { deep: { value: OVERSIZED } },
        },
      });

      const body = captured[0]!.params.body;
      expect(body.small).toBe(SMALL);
      expect(body.big).toContain("...[truncated]");
      expect(byteLen(body.big)).toBeLessThanOrEqual(32_766);
      expect(body.nested.deep.value).toContain("...[truncated]");

      // key_path + \0 + value must fit within 32,766
      const keyPath = "nested.deep.value";
      expect(
        byteLen(keyPath) + 1 + byteLen(body.nested.deep.value),
      ).toBeLessThanOrEqual(32_766);
    });

    it("leaves small bodies untouched", async () => {
      const { client, captured } = createPatchedClient();

      const original = { name: "test", count: 42, tags: ["a", "b"] };
      await client.index({ index: "test-index", body: original });

      expect(captured[0]!.params.body).toEqual(original);
    });
  });

  describe("when calling client.update with a script", () => {
    it("truncates script.params leaf strings", async () => {
      const { client, captured } = createPatchedClient();

      await client.update({
        index: "test-index",
        id: "doc-1",
        body: {
          script: {
            source: "ctx._source.data = params.data",
            params: {
              data: {
                entry: { content: OVERSIZED },
                predicted: { output: SMALL },
              },
            },
          },
        },
      });

      const body = captured[0]!.params.body;
      expect(body.script.params.data.entry.content).toContain(
        "...[truncated]",
      );
      expect(body.script.params.data.predicted.output).toBe(SMALL);
      expect(body.script.source).toBe("ctx._source.data = params.data");
    });
  });

  describe("when calling client.update with doc/upsert", () => {
    it("truncates both doc and upsert bodies", async () => {
      const { client, captured } = createPatchedClient();

      await client.update({
        index: "test-index",
        id: "doc-1",
        body: {
          doc: { field: OVERSIZED },
          upsert: { field: OVERSIZED, other: SMALL },
        },
      });

      const body = captured[0]!.params.body;
      expect(body.doc.field).toContain("...[truncated]");
      expect(body.upsert.field).toContain("...[truncated]");
      expect(body.upsert.other).toBe(SMALL);
    });
  });

  describe("when calling client.bulk", () => {
    it("truncates document lines but not action lines", async () => {
      const { client, captured } = createPatchedClient();

      const actionLine = { index: { _index: "test-index", _id: "1" } };
      const docLine = { content: OVERSIZED, small: SMALL };

      await client.bulk({ body: [actionLine, docLine] });

      const body = captured[0]!.params.body as any[];
      // Action line (index 0) untouched
      expect(body[0]).toEqual(actionLine);
      // Document line (index 1) truncated
      expect(body[1].content).toContain("...[truncated]");
      expect(body[1].small).toBe(SMALL);
    });
  });

  describe("when verifying the real-world batch evaluation pattern", () => {
    it("truncates evaluator inputs inside a Painless script upsert", async () => {
      const { client, captured } = createPatchedClient();

      // Mirrors elasticsearchBatchEvaluation.repository.ts upsertResults
      await client.update({
        index: "search-batch-evaluations-alias",
        id: "some-id",
        body: {
          script: {
            source: "for (d in params.dataset) { ... }",
            params: {
              dataset: [
                {
                  index: 0,
                  entry: { question: SMALL },
                  predicted: { output: OVERSIZED },
                },
                {
                  index: 1,
                  entry: { question: OVERSIZED },
                  predicted: { output: SMALL },
                },
              ],
              evaluations: [
                {
                  evaluator: "llm_boolean",
                  score: 1.0,
                  passed: true,
                  details: SMALL,
                  inputs: { conversation: OVERSIZED },
                },
              ],
            },
          },
        },
      });

      const params = captured[0]!.params.body.script.params;

      // Dataset: oversized values truncated, small ones intact
      expect(params.dataset[0].entry.question).toBe(SMALL);
      expect(params.dataset[0].predicted.output).toContain("...[truncated]");
      expect(params.dataset[1].entry.question).toContain("...[truncated]");
      expect(params.dataset[1].predicted.output).toBe(SMALL);

      // Evaluator results: score/passed/details preserved, oversized inputs truncated
      expect(params.evaluations[0].score).toBe(1.0);
      expect(params.evaluations[0].passed).toBe(true);
      expect(params.evaluations[0].details).toBe(SMALL);
      expect(params.evaluations[0].inputs.conversation).toContain(
        "...[truncated]",
      );
    });
  });
});
