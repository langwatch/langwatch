import { describe, expect, it } from "vitest";
import { describeAnnotationAnchor } from "../index";

const TRACE_ID = "95bf974e4f330faa31ed1decdeb0a590";

function describeAnchor({
  anchorKind,
  anchorId,
  anchorPath,
  spanName,
  selfLabel,
  withIds,
}: {
  anchorKind: "span" | "field" | "message" | null;
  anchorId: string | null;
  anchorPath?: string | null;
  spanName?: string | null;
  selfLabel?: string | null;
  withIds?: boolean;
}) {
  return describeAnnotationAnchor({
    anchor: { anchorKind, anchorId, anchorPath: anchorPath ?? null },
    traceId: TRACE_ID,
    spanName,
    ...(selfLabel === void 0 ? {} : { selfLabel }),
    ...(withIds === void 0 ? {} : { withIds }),
  });
}

describe("describeAnnotationAnchor", () => {
  describe("given a comment about the trace as a whole", () => {
    it("names nothing", () => {
      expect(describeAnchor({ anchorKind: null, anchorId: null })).toBeNull();
    });
  });

  describe("given a comment on a span", () => {
    it("names the span by its name when the caller knows it", () => {
      expect(
        describeAnchor({
          anchorKind: "span",
          anchorId: "span-7",
          spanName: "web_search",
        }),
      ).toBe("Span web_search");
    });

    it("names the span by its id when the caller does not", () => {
      expect(describeAnchor({ anchorKind: "span", anchorId: "span-7" })).toBe(
        "Span span-7",
      );
    });
  });

  describe("given a comment on a field this build names", () => {
    it("reads the field by its name", () => {
      expect(
        describeAnchor({
          anchorKind: "field",
          anchorId: "span-7",
          anchorPath: "output",
          spanName: "web_search",
        }),
      ).toBe("Span web_search · Output");
    });

    it("reads the trace's own field under the trace", () => {
      expect(
        describeAnchor({
          anchorKind: "field",
          anchorId: TRACE_ID,
          anchorPath: "metadata",
        }),
      ).toBe("Trace · Metadata");
    });
  });

  describe("given a comment on a key the reader chose", () => {
    it("reads the key whole, however many dots it carries", () => {
      expect(
        describeAnchor({
          anchorKind: "field",
          anchorId: "span-7",
          anchorPath: "params.gen_ai.request.model",
          spanName: "web_search",
        }),
      ).toBe("Span web_search · Parameters · gen_ai.request.model");
    });

    it("reads a metadata key the same way", () => {
      expect(
        describeAnchor({
          anchorKind: "field",
          anchorId: TRACE_ID,
          anchorPath: "metadata.customer.tier",
        }),
      ).toBe("Trace · Metadata · customer.tier");
    });
  });

  describe("given a caller already reading the trace the comment is on", () => {
    /** @scenario "A card about the turn's own input or output names only the field" */
    it("names the field alone rather than repeating the trace", () => {
      expect(
        describeAnchor({
          anchorKind: "field",
          anchorId: TRACE_ID,
          anchorPath: "output",
          selfLabel: null,
        }),
      ).toBe("Output");
    });

    /** @scenario "A card about the turn's own input or output names only the field" */
    it("still names a span, which is not the trace the caller is reading", () => {
      expect(
        describeAnchor({
          anchorKind: "field",
          anchorId: "span-7",
          anchorPath: "output",
          spanName: "web_search",
          selfLabel: null,
        }),
      ).toBe("Span web_search · Output");
    });

    it("names nothing for a comment on the trace itself", () => {
      expect(
        describeAnchor({
          anchorKind: "span",
          anchorId: TRACE_ID,
          selfLabel: null,
        }),
      ).toBeNull();
    });
  });

  describe("given a comment on a message", () => {
    it("says only that it is a message, never the key it is found by", () => {
      expect(
        describeAnchor({
          anchorKind: "message",
          anchorId: TRACE_ID,
          anchorPath: "text-3f-1a2b",
        }),
      ).toBe("Message");
    });
  });
});

describe("when the reader has no trace in front of them", () => {
  describe("given a comment on a named span", () => {
    it("names the span and enough of its id to match it against the waterfall", () => {
      expect(
        describeAnchor({
          anchorKind: "field",
          anchorId: "0af31b2c9d4e5f60",
          anchorPath: "output",
          spanName: "web_search",
          withIds: true,
        }),
      ).toBe("web_search span (0af31b2c) · Output");
    });

    it("says only the id when nobody named the span", () => {
      expect(
        describeAnchor({
          anchorKind: "span",
          anchorId: "0af31b2c9d4e5f60",
          withIds: true,
        }),
      ).toBe("span (0af31b2c)");
    });
  });

  describe("given a comment on the trace's own field", () => {
    it("names the trace by id too", () => {
      expect(
        describeAnchor({
          anchorKind: "field",
          anchorId: TRACE_ID,
          anchorPath: "output",
          withIds: true,
        }),
      ).toBe("Trace (95bf974e) · Output");
    });

    it("still leaves the trace out for a caller already reading it", () => {
      expect(
        describeAnchor({
          anchorKind: "field",
          anchorId: TRACE_ID,
          anchorPath: "output",
          selfLabel: null,
          withIds: true,
        }),
      ).toBe("Output");
    });
  });
});
