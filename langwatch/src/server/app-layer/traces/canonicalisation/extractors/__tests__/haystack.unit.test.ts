import { describe, expect, it } from "vitest";

import { ATTR_KEYS } from "../_constants";
import { HaystackExtractor } from "../haystack";
import { createExtractorContext } from "./_testHelpers";

describe("HaystackExtractor", () => {
  const extractor = new HaystackExtractor();

  const haystackScope = {
    instrumentationScope: {
      name: "openinference.instrumentation.haystack",
      version: null,
    },
  };

  describe("when instrumentationScope.name is openinference.instrumentation.haystack", () => {
    it("extracts retrieval.documents as langwatch.rag.contexts", () => {
      const docs = [
        { document: { content: "Document 1 content", id: "doc-1" } },
        { document: { content: "Document 2 content" } },
      ];
      const ctx = createExtractorContext(
        { [ATTR_KEYS.RETRIEVAL_DOCUMENTS]: JSON.stringify(docs) },
        haystackScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS]).toEqual(
        JSON.stringify([
          { document_id: "doc-1", content: "Document 1 content" },
          { content: "Document 2 content" },
        ]),
      );
    });

    it("infers span type as rag", () => {
      const docs = [{ document: { content: "Some content" } }];
      const ctx = createExtractorContext(
        { [ATTR_KEYS.RETRIEVAL_DOCUMENTS]: JSON.stringify(docs) },
        haystackScope,
      );

      extractor.apply(ctx);

      expect(ctx.out[ATTR_KEYS.SPAN_TYPE]).toBe("rag");
    });

    it("extracts document_id when present", () => {
      const docs = [
        { document: { content: "Content", id: "my-doc-id" } },
      ];
      const ctx = createExtractorContext(
        { [ATTR_KEYS.RETRIEVAL_DOCUMENTS]: JSON.stringify(docs) },
        haystackScope,
      );

      extractor.apply(ctx);

      const contexts = JSON.parse(
        ctx.out[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS] as string,
      ) as Array<{ content: string; document_id?: string }>;
      expect(contexts[0]!.document_id).toBe("my-doc-id");
    });

    it("filters out documents without content", () => {
      const docs = [
        { document: { content: "Valid" } },
        { document: { content: "" } },
        { document: { id: "no-content" } },
      ];
      const ctx = createExtractorContext(
        { [ATTR_KEYS.RETRIEVAL_DOCUMENTS]: JSON.stringify(docs) },
        haystackScope,
      );

      extractor.apply(ctx);

      const contexts = JSON.parse(
        ctx.out[ATTR_KEYS.LANGWATCH_RAG_CONTEXTS] as string,
      ) as unknown[];
      expect(contexts).toHaveLength(1);
      expect(contexts[0]).toEqual({ content: "Valid" });
    });
  });

  describe("when instrumentationScope.name is NOT haystack", () => {
    it("does nothing", () => {
      const docs = [{ document: { content: "Content" } }];
      const ctx = createExtractorContext(
        { [ATTR_KEYS.RETRIEVAL_DOCUMENTS]: JSON.stringify(docs) },
        { instrumentationScope: { name: "other", version: null } },
      );

      extractor.apply(ctx);

      expect(ctx.setAttr).not.toHaveBeenCalled();
    });
  });

  describe("when retrieval.documents is empty or malformed", () => {
    it("does nothing for empty array", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.RETRIEVAL_DOCUMENTS]: JSON.stringify([]) },
        haystackScope,
      );

      extractor.apply(ctx);

      expect(ctx.setAttr).not.toHaveBeenCalled();
    });

    it("does nothing for non-array", () => {
      const ctx = createExtractorContext(
        { [ATTR_KEYS.RETRIEVAL_DOCUMENTS]: "not-json" },
        haystackScope,
      );

      extractor.apply(ctx);

      expect(ctx.setAttr).not.toHaveBeenCalled();
    });
  });
});
