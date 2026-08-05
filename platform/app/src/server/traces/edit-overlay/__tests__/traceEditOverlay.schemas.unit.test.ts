/**
 * @vitest-environment node
 *
 * The correction contract: what a stored patch may say, what a malformed one
 * degrades to, and how the text a reviewer typed becomes a canonical captured
 * value again.
 */
import { describe, expect, it } from "vitest";
import {
  emptyTraceEditOverlayPatch,
  encodeSpanIOFromEditedText,
  parseTraceEditOverlayPatch,
  patchHasAnyEdit,
  TRACE_EDIT_OVERLAY_MAX_PATCH_BYTES,
  traceEditOverlayPatchSchema,
} from "../traceEditOverlay.schemas";

describe("trace edit overlay patch contract", () => {
  describe("given a patch written by this build", () => {
    it("accepts a span rename with the deleted ids and spans defaulted", () => {
      const parsed = traceEditOverlayPatchSchema.parse({
        version: 1,
        spans: [{ spanId: "span-1", name: "cleaned up" }],
      });

      expect(parsed.spans[0]?.name).toBe("cleaned up");
      expect(parsed.deletedSpanIds).toEqual([]);
    });

    it("keeps a null field, which is how a correction clears one", () => {
      const parsed = traceEditOverlayPatchSchema.parse({
        version: 1,
        spans: [{ spanId: "span-1", error: null, output: null }],
      });

      expect(parsed.spans[0]).toHaveProperty("error", null);
      expect(parsed.spans[0]).toHaveProperty("output", null);
    });
  });

  describe("given a patch this build cannot interpret", () => {
    it("degrades an unknown version to no correction", () => {
      expect(
        parseTraceEditOverlayPatch({
          version: 2,
          spans: [],
          deletedSpanIds: [],
        }),
      ).toBeNull();
    });

    it("degrades a span input that is not a captured value", () => {
      expect(
        parseTraceEditOverlayPatch({
          version: 1,
          spans: [{ spanId: "span-1", input: { type: "nonsense", value: 1 } }],
        }),
      ).toBeNull();
    });

    it("degrades a patch larger than the size limit", () => {
      const huge = "x".repeat(TRACE_EDIT_OVERLAY_MAX_PATCH_BYTES + 10);
      expect(
        parseTraceEditOverlayPatch({
          version: 1,
          spans: [{ spanId: "span-1", output: { type: "text", value: huge } }],
        }),
      ).toBeNull();
    });
  });

  describe("when asking whether a patch changes anything", () => {
    it("reports an empty patch as no edit", () => {
      expect(patchHasAnyEdit(emptyTraceEditOverlayPatch())).toBe(false);
    });

    it("reports a span entry carrying only its id as no edit", () => {
      expect(
        patchHasAnyEdit({
          version: 1,
          spans: [{ spanId: "span-1" }],
          deletedSpanIds: [],
        }),
      ).toBe(false);
    });

    it("reports a deletion as an edit", () => {
      expect(
        patchHasAnyEdit({
          version: 1,
          spans: [],
          deletedSpanIds: ["span-1"],
        }),
      ).toBe(true);
    });

    it("reports a trace output as an edit", () => {
      expect(
        patchHasAnyEdit({
          version: 1,
          trace: { output: { value: "corrected" } },
          spans: [],
          deletedSpanIds: [],
        }),
      ).toBe(true);
    });

    /** @scenario "A metadata correction alone counts as a correction" */
    it("reports corrected trace metadata as an edit", () => {
      expect(
        patchHasAnyEdit({
          version: 1,
          trace: { metadata: { environment: "production" } },
          spans: [],
          deletedSpanIds: [],
        }),
      ).toBe(true);
    });

    /** @scenario "A metadata correction alone counts as a correction" */
    it("reports cleared trace metadata as an edit", () => {
      expect(
        patchHasAnyEdit({
          version: 1,
          trace: { metadata: null },
          spans: [],
          deletedSpanIds: [],
        }),
      ).toBe(true);
    });
  });

  describe("when a correction carries trace metadata", () => {
    it("accepts a map of keys, a null value, and a cleared map", () => {
      const parsed = traceEditOverlayPatchSchema.parse({
        version: 1,
        trace: {
          metadata: { environment: "production", reviewer: null, count: 3 },
        },
        spans: [],
      });

      expect(parsed.trace?.metadata).toEqual({
        environment: "production",
        reviewer: null,
        count: 3,
      });
      expect(
        traceEditOverlayPatchSchema.parse({
          version: 1,
          trace: { metadata: null },
          spans: [],
        }).trace,
      ).toHaveProperty("metadata", null);
    });
  });
});

describe("encoding the text a reviewer typed", () => {
  describe("given the field was captured as a chat transcript", () => {
    /** @scenario "Text edited back into a chat transcript is stored as chat messages" */
    it("reads valid transcript text back as chat messages", () => {
      const encoded = encodeSpanIOFromEditedText({
        text: JSON.stringify([{ role: "user", content: "hello" }]),
        original: { type: "chat_messages", value: [] },
      });

      expect(encoded).toEqual({
        type: "chat_messages",
        value: [{ role: "user", content: "hello" }],
      });

      const asPlainText = encodeSpanIOFromEditedText({
        text: "just words, not JSON",
        original: { type: "chat_messages", value: [] },
      });
      expect(asPlainText).toEqual({
        type: "text",
        value: "just words, not JSON",
      });
    });

    it("keeps an array of unrelated objects as json rather than losing its keys", () => {
      const encoded = encodeSpanIOFromEditedText({
        text: JSON.stringify([{ anything: 1 }]),
        original: { type: "chat_messages", value: [] },
      });

      expect(encoded).toEqual({ type: "json", value: [{ anything: 1 }] });
    });
  });

  describe("given the field was captured as text or raw", () => {
    it("keeps numeric-looking text verbatim instead of reading it as json", () => {
      expect(
        encodeSpanIOFromEditedText({
          text: "42",
          original: { type: "text", value: "1" },
        }),
      ).toEqual({ type: "text", value: "42" });

      expect(
        encodeSpanIOFromEditedText({
          text: "{}",
          original: { type: "raw", value: "" },
        }),
      ).toEqual({ type: "raw", value: "{}" });
    });
  });

  describe("given the field was captured as structured json", () => {
    it("reads parseable text back as json", () => {
      expect(
        encodeSpanIOFromEditedText({
          text: '{"answer": 42}',
          original: { type: "json", value: {} },
        }),
      ).toEqual({ type: "json", value: { answer: 42 } });
    });

    it("keeps blank text as text", () => {
      expect(
        encodeSpanIOFromEditedText({
          text: "   ",
          original: { type: "json", value: {} },
        }),
      ).toEqual({ type: "text", value: "   " });
    });
  });
});
