import { describe, expect, it } from "vitest";
import { ragasAnswerRelevancy } from "./ragasAnswerRelevancy";
import type { Trace } from "../../server/tracer/types";
import type { RagasResult } from "../types";

describe("RagasAnswerRelevancy Integration", () => {
  it("evaluates answer relevancy with a real request", async () => {
    const sampleTrace: Trace = {
      trace_id: "integration-test",
      project_id: "integration-test",
      input: { value: "What is the capital of France?" },
      output: { value: "The capital of France is Paris." },
      metrics: {},
      timestamps: { started_at: Date.now(), inserted_at: Date.now() },
      search_embeddings: {},
    };

    const response = await ragasAnswerRelevancy(sampleTrace);

    const answer_relevancy = (response.raw_result as RagasResult).scores.answer_relevancy
    expect(answer_relevancy).toBeGreaterThan(0.99);
    expect(response.value).toBe(answer_relevancy);
    expect(response.costs[0]?.amount).toBeGreaterThan(0);
    expect(response.status).toBe("succeeded");
  });
});