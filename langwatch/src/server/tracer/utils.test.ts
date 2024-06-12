import { describe, expect, it } from "vitest";
import { getRAGInfo } from "./utils";

describe("utils test", () => {
  it("extracts RAG context", async () => {
    const ragInfo = getRAGInfo([
      {
        output: {
          type: "chat_messages",
          value:
            '[{"role":"assistant","content":"Yes, we offer a custom ChatGPT bot for your website. It\'s easy to set up and requires no training or maintenance. You can automate customer support, resolve repetitive questions, and even escalate to a human agent if needed."}]',
        },
        input: {
          type: "chat_messages",
          value: '[{"role":"user","content":"Hi I am looking for a chatbot"}]',
        },
        trace_id: "sample_trace_id",
        span_id: "sample_span_id",
        project_id: "sample_project_id",
        parent_id: null,
        timestamps: {
          finished_at: 1714043578680,
          updated_at: 1714043579924,
          started_at: 1714043565444,
          inserted_at: 1714043579924,
        },
        contexts: [
          {
            document_id: "sample_document_id",
            chunk_id: "0",
            content: "Foo",
          },
          {
            document_id: "sample_document_id",
            chunk_id: "1",
            content: "Bar",
          },
          {
            document_id: "sample_document_id",
            chunk_id: "1",
            content: "Baz",
          },
        ],
        type: "rag",
      },
    ]);
    const input = ragInfo.input;
    const output = ragInfo.output;
    const contexts = ragInfo.contexts;

    expect(input).toBe("Hi I am looking for a chatbot");
    expect(output).toBe(
      "Yes, we offer a custom ChatGPT bot for your website. It's easy to set up and requires no training or maintenance. You can automate customer support, resolve repetitive questions, and even escalate to a human agent if needed."
    );
    expect(contexts).toEqual(["Foo", "Bar", "Baz"]);
  });
});
