/**
 * @vitest-environment node
 *
 * The anchor contract: what a comment may say it is about, what it may not, and
 * how an anchor this build does not recognise reads.
 */
import { describe, expect, it } from "vitest";
import {
  annotationAnchorColumnsSchema,
  annotationAnchorScopeWhere,
  readableAnnotationAnchor,
  refineAnnotationAnchorColumns,
  resolveAnnotationSuggestionTarget,
  withReadableAnnotationAnchor,
} from "../annotationAnchor";

const anchorInput = annotationAnchorColumnsSchema.superRefine(
  refineAnnotationAnchorColumns,
);

const storedRow = (
  overrides: Partial<{
    anchorKind: string | null;
    anchorId: string | null;
    anchorPath: string | null;
  }> = {},
) => ({
  anchorKind: null,
  anchorId: null,
  anchorPath: null,
  ...overrides,
});

describe("the anchor a comment is written with", () => {
  describe("given an anchor naming a part of the trace", () => {
    it("accepts a span with no field named", () => {
      expect(
        anchorInput.parse({ anchorKind: "span", anchorId: "span-1" }),
      ).toEqual({ anchorKind: "span", anchorId: "span-1" });
    });

    it("accepts a field of a span", () => {
      expect(
        anchorInput.parse({
          anchorKind: "field",
          anchorId: "span-1",
          anchorPath: "output",
        }),
      ).toEqual({
        anchorKind: "field",
        anchorId: "span-1",
        anchorPath: "output",
      });
    });

    it("accepts a message inside a transcript", () => {
      expect(
        anchorInput.parse({
          anchorKind: "message",
          anchorId: "trace-1",
          anchorPath: "assistant-2-9f1c",
        }).anchorPath,
      ).toBe("assistant-2-9f1c");
    });
  });

  describe("given no anchor at all", () => {
    it("reads as a comment about the trace as a whole", () => {
      expect(anchorInput.parse({})).toEqual({});
    });
  });

  describe("given half an anchor", () => {
    it("refuses a kind with nothing named", () => {
      expect(anchorInput.safeParse({ anchorKind: "span" }).success).toBe(false);
    });

    it("refuses a named part with no kind", () => {
      expect(anchorInput.safeParse({ anchorId: "span-1" }).success).toBe(false);
    });

    it("refuses a path with no kind", () => {
      expect(anchorInput.safeParse({ anchorPath: "output" }).success).toBe(
        false,
      );
    });
  });

  describe("given a kind that is not a part of a trace", () => {
    it("refuses it on the way in", () => {
      expect(
        anchorInput.safeParse({ anchorKind: "gizmo", anchorId: "whatever" })
          .success,
      ).toBe(false);
    });
  });
});

describe("reading a stored anchor", () => {
  describe("given an anchor this build recognises", () => {
    it("reads it as written", () => {
      expect(
        readableAnnotationAnchor(
          storedRow({
            anchorKind: "field",
            anchorId: "span-1",
            anchorPath: "output",
          }),
        ),
      ).toEqual({
        anchorKind: "field",
        anchorId: "span-1",
        anchorPath: "output",
      });
    });
  });

  describe("given a kind this build does not recognise", () => {
    /** @scenario "A comment about something this build does not recognise still reads" */
    it("reads as a comment about the trace as a whole", () => {
      expect(
        readableAnnotationAnchor(
          storedRow({
            anchorKind: "gizmo",
            anchorId: "gizmo-1",
            anchorPath: "somewhere",
          }),
        ),
      ).toEqual({ anchorKind: null, anchorId: null, anchorPath: null });
    });

    it("keeps the rest of the comment untouched", () => {
      expect(
        withReadableAnnotationAnchor({
          id: "annotation-1",
          comment: "this one is wrong",
          ...storedRow({ anchorKind: "gizmo", anchorId: "gizmo-1" }),
        }),
      ).toEqual({
        id: "annotation-1",
        comment: "this one is wrong",
        anchorKind: null,
        anchorId: null,
        anchorPath: null,
      });
    });
  });

  describe("given a kind with nothing named", () => {
    it("reads as a comment about the trace as a whole", () => {
      expect(
        readableAnnotationAnchor(storedRow({ anchorKind: "span" })).anchorKind,
      ).toBeNull();
    });
  });
});

describe("the comments a read asks for", () => {
  it("narrows to the ones about whole traces", () => {
    expect(annotationAnchorScopeWhere("trace")).toEqual({ anchorKind: null });
  });

  it("narrows to nothing when every comment is wanted", () => {
    expect(annotationAnchorScopeWhere("all")).toEqual({});
  });
});

describe("where a suggestion left with a comment belongs", () => {
  const traceId = "trace-1";

  describe("given a comment about the whole trace", () => {
    it("corrects the trace output", () => {
      expect(resolveAnnotationSuggestionTarget({ traceId })).toEqual({
        kind: "trace",
        field: "output",
      });
    });
  });

  describe("given a comment on the trace's own output", () => {
    it("corrects the trace output", () => {
      expect(
        resolveAnnotationSuggestionTarget({
          traceId,
          anchorKind: "field",
          anchorId: traceId,
          anchorPath: "output",
        }),
      ).toEqual({ kind: "trace", field: "output" });
    });
  });

  describe("given a comment on the trace's own input", () => {
    /** @scenario "A suggestion on the trace's own input becomes the corrected trace input" */
    it("corrects the trace input", () => {
      expect(
        resolveAnnotationSuggestionTarget({
          traceId,
          anchorKind: "field",
          anchorId: traceId,
          anchorPath: "input",
        }),
      ).toEqual({ kind: "trace", field: "input" });
    });
  });

  describe("given a comment on a span's field", () => {
    it("corrects that field of that span", () => {
      expect(
        resolveAnnotationSuggestionTarget({
          traceId,
          anchorKind: "field",
          anchorId: "span-1",
          anchorPath: "output",
        }),
      ).toEqual({ kind: "span", spanId: "span-1", field: "output" });
    });

    it("corrects the input when the comment is on the input", () => {
      expect(
        resolveAnnotationSuggestionTarget({
          traceId,
          anchorKind: "field",
          anchorId: "span-1",
          anchorPath: "input",
        }),
      ).toEqual({ kind: "span", spanId: "span-1", field: "input" });
    });
  });

  describe("given an anchor with nothing for a suggestion to correct", () => {
    it("carries no correction for an attribute row", () => {
      expect(
        resolveAnnotationSuggestionTarget({
          traceId,
          anchorKind: "field",
          anchorId: "span-1",
          anchorPath: "params.temperature",
        }),
      ).toBeNull();
    });

    it("carries no correction for a message", () => {
      expect(
        resolveAnnotationSuggestionTarget({
          traceId,
          anchorKind: "message",
          anchorId: traceId,
          anchorPath: "assistant-2-9f1c",
        }),
      ).toBeNull();
    });

    it("carries no correction for a whole span", () => {
      expect(
        resolveAnnotationSuggestionTarget({
          traceId,
          anchorKind: "span",
          anchorId: "span-1",
        }),
      ).toBeNull();
    });

    it("carries no correction for a trace field other than its input or output", () => {
      expect(
        resolveAnnotationSuggestionTarget({
          traceId,
          anchorKind: "field",
          anchorId: traceId,
          anchorPath: "metadata.environment",
        }),
      ).toBeNull();
    });
  });

  describe("given an anchor this build does not recognise", () => {
    it("corrects the trace output, the same way the comment reads", () => {
      expect(
        resolveAnnotationSuggestionTarget({
          traceId,
          anchorKind: "gizmo",
          anchorId: "gizmo-1",
        }),
      ).toEqual({ kind: "trace", field: "output" });
    });
  });
});
