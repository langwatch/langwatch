import { describe, expect, it } from "vitest";

import { readerHoldsTrace } from "../braid-held-trace.rules.ts";

const ZERO = "0000000000000000";

describe("readerHoldsTrace", () => {
  describe("when a reader span is the parent of an owner span", () => {
    it("holds the trace", () => {
      expect(
        readerHoldsTrace({
          readerSpans: [{ spanId: "r1", parentSpanId: null, startTimeMs: 1 }],
          ownerSpans: [{ spanId: "o1", parentSpanId: "r1", startTimeMs: 1 }],
          fromMs: 0,
        }),
      ).toBe(true);
    });
  });

  describe("when an owner span is the parent of a reader span", () => {
    it("holds the trace", () => {
      expect(
        readerHoldsTrace({
          readerSpans: [{ spanId: "r1", parentSpanId: "o1", startTimeMs: 1 }],
          ownerSpans: [{ spanId: "o1", parentSpanId: null, startTimeMs: 1 }],
          fromMs: 0,
        }),
      ).toBe(true);
    });
  });

  describe("when the linked reader span starts before the braids' earliest window", () => {
    /** @scenario "Testing a trace and the preview hold a trace only through links the reader's fence holds" */
    it("holds nothing, as the live fence would not", () => {
      const linked = {
        readerSpans: [{ spanId: "r1", parentSpanId: null, startTimeMs: 50 }],
        ownerSpans: [{ spanId: "o1", parentSpanId: "r1", startTimeMs: 150 }],
      };

      expect(readerHoldsTrace({ ...linked, fromMs: 100 })).toBe(false);
      expect(readerHoldsTrace({ ...linked, fromMs: 50 })).toBe(true);
    });
  });

  describe.each([
    ["an empty", ""],
    ["the all-zero", ZERO],
  ])("when a reader span carries %s span id", (_, unset) => {
    it("holds nothing through an owner root whose parent is unset the same way", () => {
      expect(
        readerHoldsTrace({
          readerSpans: [{ spanId: unset, parentSpanId: null, startTimeMs: 1 }],
          ownerSpans: [{ spanId: "o1", parentSpanId: unset, startTimeMs: 1 }],
          fromMs: 0,
        }),
      ).toBe(false);
    });

    it("holds nothing through an owner span carrying the same unset id", () => {
      expect(
        readerHoldsTrace({
          readerSpans: [{ spanId: "r1", parentSpanId: unset, startTimeMs: 1 }],
          ownerSpans: [{ spanId: unset, parentSpanId: null, startTimeMs: 1 }],
          fromMs: 0,
        }),
      ).toBe(false);
    });
  });
});
