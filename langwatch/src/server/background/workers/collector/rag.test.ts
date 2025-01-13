import { describe, expect, it } from "vitest";
import type { RAGChunk } from "../../../tracer/types";
import { extractRAGTextualContext, maybeAddIdsToContextList } from "./rag";

describe("RAG", () => {
  it("extracts textual only data from RAG content context", () => {
    const contexts: RAGChunk[] = [
      { document_id: "1", content: "foo" },
      { document_id: "2", content: { title: "bar", content: "baz", score: 0.87 } },
      {
        document_id: "3",
        content: {
          title: { nested: "wut", checked: false },
          text: "qux",
          when: new Date(),
        },
      },
      { document_id: "4", content: ["qwe", "qwert"] },
      { document_id: "2", content: { title: null, content: "baz", score: 0.87 } },
    ];

    expect(extractRAGTextualContext(contexts)).toEqual([
      "foo",
      "{\"title\":\"bar\",\"content\":\"baz\",\"score\":0.87}",
      JSON.stringify(contexts[2]?.content),
      "qwe\nqwert",
      "{\"title\":null,\"content\":\"baz\",\"score\":0.87}",
    ]);
  });

  it("add auto-generated md5 ids for ids-less contexts, but skip partially broken input", () => {
    let contexts: any[] = [
      { document_id: "1", content: "foo" },
      { document_id: "2", content: "bar" },
    ];

    expect(maybeAddIdsToContextList(contexts)).toEqual(contexts);

    contexts = ["foo", "bar"];

    expect(maybeAddIdsToContextList(contexts)).toEqual([
      {
        document_id: "acbd18db4cc2f85cedef654fccc4a4d8",
        content: "foo",
      },
      {
        document_id: "37b51d194a7513e45b56f6524f2d51f2",
        content: "bar",
      },
    ]);

    contexts = [
      { document_id: "1", content: "foo" },
      { content: "bar" },
    ];

    expect(maybeAddIdsToContextList(contexts)).toEqual(contexts);
  });
});
