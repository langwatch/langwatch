import { describe, it, expect } from "vitest";
import { categorizeTraces, type CategorizationParams } from "./categorization";
import { getOpenAIEmbeddings } from "../server/embeddings";

describe("Categorization Integration Test", () => {
  it("cluster tracers into categories", async () => {
    const traces: CategorizationParams["file"] = [
      {
        _source: {
          id: "trace_1",
          input: { value: "hey there, how is it going?" },
        },
      },
      {
        _source: {
          id: "trace_2",
          input: { value: "hi, what is up?" },
        },
      },
      {
        _source: {
          id: "trace_3",
          input: { value: "please repeat" },
        },
      },
      {
        _source: {
          id: "trace_4",
          input: { value: "sorry, can you repeat?" },
        },
      },
    ];

    for (const trace of traces) {
      trace._source.input.openai_embeddings = await getOpenAIEmbeddings(
        trace._source.input.value
      );
    }

    const categories = await categorizeTraces({ categories: [], file: traces });

    expect(categories).toEqual({
      trace_1: "Greetings and Salutations",
      trace_2: "Greetings and Salutations",
      trace_3: "Request for Repetition",
      trace_4: "Request for Repetition",
    });
  });
});
