import { describe, expect, it } from "vitest";
import { describeAnnotationAnchor } from "../annotationAnchorLabel";

const TRACE_ID = "trace-1";

function describe_({
  anchorKind,
  anchorId,
  anchorPath,
  spanName,
  selfLabel,
}: {
  anchorKind: "span" | "field" | "message" | null;
  anchorId: string | null;
  anchorPath?: string | null;
  spanName?: string | null;
  selfLabel?: string | null;
}) {
  return describeAnnotationAnchor({
    anchor: { anchorKind, anchorId, anchorPath: anchorPath ?? null },
    traceId: TRACE_ID,
    spanName,
    ...(selfLabel === undefined ? {} : { selfLabel }),
  });
}

describe("describeAnnotationAnchor", () => {
  describe("given a comment about the trace as a whole", () => {
    it("names nothing", () => {
      expect(describe_({ anchorKind: null, anchorId: null })).toBeNull();
    });
  });

  describe("given a comment on a span", () => {
    it("names the span by its name when the caller knows it", () => {
      expect(
        describe_({
          anchorKind: "span",
          anchorId: "span-7",
          spanName: "web_search",
        }),
      ).toBe("Span web_search");
    });

    it("names the span by its id when the caller does not", () => {
      expect(describe_({ anchorKind: "span", anchorId: "span-7" })).toBe(
        "Span span-7",
      );
    });
  });

  describe("given a comment on a field this build names", () => {
    it("reads the field by its name", () => {
      expect(
        describe_({
          anchorKind: "field",
          anchorId: "span-7",
          anchorPath: "output",
          spanName: "web_search",
        }),
      ).toBe("Span web_search · Output");
    });

    it("reads the trace's own field under the trace", () => {
      expect(
        describe_({
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
        describe_({
          anchorKind: "field",
          anchorId: "span-7",
          anchorPath: "params.gen_ai.request.model",
          spanName: "web_search",
        }),
      ).toBe("Span web_search · Parameters · gen_ai.request.model");
    });

    it("reads a metadata key the same way", () => {
      expect(
        describe_({
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
        describe_({
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
        describe_({
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
        describe_({
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
        describe_({
          anchorKind: "message",
          anchorId: TRACE_ID,
          anchorPath: "text-3f-1a2b",
        }),
      ).toBe("Message");
    });
  });
});
