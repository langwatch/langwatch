/**
 * The `document_id` a RAG chunk is given when the SDK sent none.
 *
 * It is derived from the chunk's own text, so the same chunk seen in two
 * traces is recognised as the same document. That makes the derivation load
 * bearing in two directions: a chunk that already carries an id must keep it
 * (the customer's own id is the one their systems know), and the enrichment
 * must write back under the canonical key even when it read the legacy one.
 */

import crypto from "crypto";
import { describe, expect, it } from "vitest";
import {
  SpanNormalizationPipelineService,
  TraceCanonicalisationService,
} from "@langwatch/trace-server";

const CANONICAL = "langwatch.rag.contexts";
const LEGACY = "langwatch.rag_contexts";

const generateDocumentId = (content: unknown) =>
  SpanNormalizationPipelineService.documentIdFor(content);

const service = new SpanNormalizationPipelineService(TraceCanonicalisationService.create());

/** A span carrying nothing but the RAG attribute under test. */
function spanWith(attributes: Record<string, unknown>) {
  const span = { spanAttributes: attributes } as never as Parameters<
    typeof service.enrichRagContextIds
  >[0];
  service.enrichRagContextIds(span);
  return span.spanAttributes as Record<string, unknown>;
}

const contextsIn = (attributes: Record<string, unknown>) =>
  attributes[CANONICAL] as Array<Record<string, unknown>>;

describe("generateDocumentId", () => {
  describe("when content is a plain string", () => {
    it("returns MD5 hash of the trimmed content", () => {
      const content = "hello world";
      const expected = crypto.createHash("md5").update(content).digest("hex");

      expect(generateDocumentId(content)).toBe(expected);
    });
  });

  describe("when content is an object", () => {
    it("returns MD5 hash of JSON-stringified content", () => {
      const content = { text: "hello" };
      const expected = crypto.createHash("md5").update(JSON.stringify(content)).digest("hex");

      expect(generateDocumentId(content)).toBe(expected);
    });
  });

  describe("when content is an array", () => {
    it("returns MD5 hash of joined array content", () => {
      const content = ["line 1", "line 2"];
      const expected = crypto.createHash("md5").update("line 1\nline 2").digest("hex");

      expect(generateDocumentId(content)).toBe(expected);
    });
  });
});

describe("SpanNormalizationPipelineService.enrichRagContextIds", () => {
  describe("given a chunk with no document_id", () => {
    it("derives one from the chunk's content", () => {
      const attributes = spanWith({ [CANONICAL]: [{ content: "hello world" }] });

      expect(contextsIn(attributes)[0]?.document_id).toBe(generateDocumentId("hello world"));
    });

    it("gives two chunks with the same text the same id", () => {
      const attributes = spanWith({
        [CANONICAL]: [{ content: "same" }, { content: "same" }, { content: "other" }],
      });
      const [first, second, third] = contextsIn(attributes);

      expect(first?.document_id).toBe(second?.document_id);
      expect(first?.document_id).not.toBe(third?.document_id);
    });

    it("hashes the whole entry when it carries no content field", () => {
      const entry = { title: "no content here" };
      const attributes = spanWith({ [CANONICAL]: [{ ...entry }] });

      expect(contextsIn(attributes)[0]?.document_id).toBe(generateDocumentId(entry));
    });
  });

  describe("given a chunk that already has a document_id", () => {
    it("leaves it alone, because that id is the customer's own", () => {
      const attributes = spanWith({
        [CANONICAL]: [{ content: "hello world", document_id: "theirs" }],
      });

      expect(contextsIn(attributes)[0]?.document_id).toBe("theirs");
    });

    it("still enriches its neighbours", () => {
      const attributes = spanWith({
        [CANONICAL]: [{ content: "a", document_id: "theirs" }, { content: "b" }],
      });

      expect(contextsIn(attributes).map((entry) => entry.document_id)).toEqual([
        "theirs",
        generateDocumentId("b"),
      ]);
    });
  });

  describe("given the contexts arrived under the legacy key", () => {
    it("writes the enriched list back under the canonical one", () => {
      const attributes = spanWith({ [LEGACY]: [{ content: "hello world" }] });

      expect(contextsIn(attributes)[0]?.document_id).toBe(generateDocumentId("hello world"));
    });
  });

  describe("given there are no contexts to enrich", () => {
    it("leaves a span without the attribute untouched", () => {
      expect(spanWith({ "other.attribute": 1 })).toEqual({ "other.attribute": 1 });
    });

    it("leaves the attribute alone when it is not a list", () => {
      expect(spanWith({ [CANONICAL]: "not a list" })).toEqual({ [CANONICAL]: "not a list" });
    });

    it("passes non-object entries through rather than hashing them", () => {
      const attributes = spanWith({ [CANONICAL]: [null, "text", ["nested"]] });

      expect(attributes[CANONICAL]).toEqual([null, "text", ["nested"]]);
    });
  });
});
