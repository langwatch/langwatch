import { describe, expect, it } from "vitest";

import { readerHoldsTrace } from "../braid-held-trace.rules.ts";

const ZERO = "0000000000000000";

describe("readerHoldsTrace", () => {
  describe("when a reader span is the parent of an owner span", () => {
    it("holds the trace", () => {
      expect(
        readerHoldsTrace({
          readerSpans: [{ spanId: "r1", parentSpanId: null }],
          ownerSpans: [{ spanId: "o1", parentSpanId: "r1" }],
        }),
      ).toBe(true);
    });
  });

  describe("when an owner span is the parent of a reader span", () => {
    it("holds the trace", () => {
      expect(
        readerHoldsTrace({
          readerSpans: [{ spanId: "r1", parentSpanId: "o1" }],
          ownerSpans: [{ spanId: "o1", parentSpanId: null }],
        }),
      ).toBe(true);
    });
  });

  describe.each([
    ["an empty", ""],
    ["the all-zero", ZERO],
  ])("when a reader span carries %s span id", (_, unset) => {
    it("holds nothing through an owner root whose parent is unset the same way", () => {
      expect(
        readerHoldsTrace({
          readerSpans: [{ spanId: unset, parentSpanId: null }],
          ownerSpans: [{ spanId: "o1", parentSpanId: unset }],
        }),
      ).toBe(false);
    });

    it("holds nothing through an owner span carrying the same unset id", () => {
      expect(
        readerHoldsTrace({
          readerSpans: [{ spanId: "r1", parentSpanId: unset }],
          ownerSpans: [{ spanId: unset, parentSpanId: null }],
        }),
      ).toBe(false);
    });
  });
});
