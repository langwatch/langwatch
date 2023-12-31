import { describe, expect, it } from "vitest";
import { ragasContextPrecision } from "./ragasContextPrecision";
import type { ElasticSearchSpan, Trace } from "../../server/tracer/types";
import type { RagasResult } from "../types";

describe("RagasContextPrecision Integration", () => {
  it("evaluates context precision with a real request", async () => {
    const sampleTrace: Trace = {
      id: "integration-test",
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

    const response = await ragasContextPrecision(sampleTrace, sampleSpans);

    const context_precision = (response.raw_result as RagasResult).scores
      .context_precision;
    expect(context_precision).toBeGreaterThan(0.01);
    expect(response.value).toBe(context_precision);
    expect(response.costs[0]?.amount).toBeGreaterThan(0);
    expect(response.status).toBe("succeeded");
  });
});
