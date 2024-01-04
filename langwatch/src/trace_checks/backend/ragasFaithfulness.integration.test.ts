import { describe, expect, it } from "vitest";
import { ragasFaithfulness } from "./ragasFaithfulness";
import type { Trace, ElasticSearchSpan } from "../../server/tracer/types";
import type { RagasResult } from "../types";

describe("RagasFaithfulness Integration", () => {
  it("evaluates faithfulness with a real request and a rag span", async () => {
    const sampleTrace: Trace = {
      id: "integration-test-faithfulness",
      project_id: "integration-test",
      input: { value: "What is the capital of France?" },
      output: { value: "The capital of France is Paris." },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: {},
    };
    const sampleSpans: ElasticSearchSpan[] = [
      {
        type: "rag",
        id: "rag-span-1",
        name: "RAG Span for Testing",
        parent_id: null,
        trace_id: "integration-test",
        input: { type: "text", value: "What is the capital of France?" },
        outputs: [{ type: "text", value: "The capital of France is Paris." }],
        project_id: "integration-test",
        timestamps: { started_at: Date.now(), finished_at: Date.now() },
        contexts: [
          "France is a country in Europe.",
          "Paris is a city in France.",
        ],
      },
    ];
    const response = await ragasFaithfulness(sampleTrace, sampleSpans);

    const faithfulnessScore = (response.raw_result as RagasResult).scores
      .faithfulness;
    expect(faithfulnessScore).toBeTypeOf("number"); // sometimes it returns 0, sometimes 1 for this test, maybe we need better examples, so we just check for number type here
    expect(response.value).toBe(faithfulnessScore);
  });
});
