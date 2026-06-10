import { describe, expect, it } from "vitest";
import { extractPromptReference } from "../promptAttributes";

// Wire-format contract pinned by specs/nlp-go/prompt-spans-*.feature.
// Each test exercises a single attribute permutation that nlpgo (or
// any langwatch SDK) can emit on a Prompt.compile / PromptApiService.get
// span and asserts the parser surfaces the right resume target.

describe("extractPromptReference", () => {
  describe("when no prompt attributes are present", () => {
    it("returns null for null/empty params", () => {
      expect(extractPromptReference(null)).toBeNull();
      expect(extractPromptReference(undefined)).toBeNull();
      expect(extractPromptReference({})).toBeNull();
    });
  });

  describe("when combined langwatch.prompt.id = handle:version is present", () => {
    it("parses handle + versionNumber + draft=false (omitted)", () => {
      const ref = extractPromptReference({
        "langwatch.prompt.id": "support-router:6",
      });
      expect(ref).toEqual({
        handle: "support-router",
        versionNumber: 6,
        tag: null,
        variables: null,
        draft: false,
      });
    });
  });

  describe("when separate handle + version.number attributes are present", () => {
    it("parses both into the reference", () => {
      const ref = extractPromptReference({
        "langwatch.prompt.handle": "support-router",
        "langwatch.prompt.version.number": 6,
      });
      expect(ref?.handle).toBe("support-router");
      expect(ref?.versionNumber).toBe(6);
      expect(ref?.draft).toBe(false);
    });
  });

  describe("when langwatch.prompt.draft = true is stamped on the span", () => {
    // Pinned by specs/nlp-go/prompt-spans-unsaved-version.feature:
    //   "trace drawer surfaces the draft state on the 'Open in Prompts' affordance"
    // The base id/handle/version still flow through unchanged; only the
    // draft boolean flips so consumers can append "(unsaved edits)".
    it("preserves the base reference and flips draft to true", () => {
      const ref = extractPromptReference({
        "langwatch.prompt.id": "support-router:6",
        "langwatch.prompt.handle": "support-router",
        "langwatch.prompt.version.id": "prompt_version_xyz",
        "langwatch.prompt.version.number": 6,
        "langwatch.prompt.draft": true,
      });
      expect(ref).toMatchObject({
        handle: "support-router",
        versionNumber: 6,
        draft: true,
      });
    });

    it("supports the nested attribute shape (un-flattened by ingestion)", () => {
      // Same emission, but stored as a nested object — what readAttribute's
      // dotted-path fallback must catch. Without this, draft is silently
      // false even when the span carried draft=true.
      const ref = extractPromptReference({
        langwatch: {
          prompt: {
            id: "support-router:6",
            draft: true,
          },
        },
      });
      expect(ref?.draft).toBe(true);
    });

    it("accepts the stringified \"true\" form (ClickHouse SpanAttributes path)", () => {
      // Regression caught during 2026-05-17 dogfood: the ClickHouse
      // SpanAttributes column stringifies scalar OTel attrs on ingest,
      // so an `attribute.Bool(true)` from nlpgo lands as the literal
      // string "true" by the time the trace API serves it back. A
      // strict `=== true` check returned false and the "unsaved edits"
      // chip never rendered. The reader now accepts both boolean true
      // and the string form.
      const refFlat = extractPromptReference({
        "langwatch.prompt.id": "support-router:6",
        "langwatch.prompt.draft": "true",
      });
      expect(refFlat?.draft).toBe(true);

      const refNested = extractPromptReference({
        langwatch: { prompt: { id: "support-router:6", draft: "true" } },
      });
      expect(refNested?.draft).toBe(true);
    });
  });

  describe("when langwatch.prompt.draft is explicitly false or absent", () => {
    it("returns draft=false in both cases (omission == false)", () => {
      const withFalse = extractPromptReference({
        "langwatch.prompt.id": "support-router:6",
        "langwatch.prompt.draft": false,
      });
      const withoutKey = extractPromptReference({
        "langwatch.prompt.id": "support-router:6",
      });
      expect(withFalse?.draft).toBe(false);
      expect(withoutKey?.draft).toBe(false);
    });
  });
});
