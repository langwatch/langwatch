import { describe, expect, it } from "vitest";
import {
  annotationAnchorColumnsSchema,
  createAnnotationInputSchema,
  readableAnnotationAnchor,
  resolveAnnotationSuggestionTarget,
} from "../src";

describe("annotation contract", () => {
  it("rejects an incomplete anchor", () => {
    expect(() => annotationAnchorColumnsSchema.parse({ anchorKind: "field" })).toThrow();
  });

  it("defaults score options at the write boundary", () => {
    const value = createAnnotationInputSchema.parse({
      id: "annotation-1",
      projectId: "project-1",
      traceId: "trace-1",
      userId: "user-1",
      comment: "useful",
      isThumbsUp: null,
      expectedOutput: null,
    });
    expect(value.scoreOptions).toEqual({});
  });

  it("degrades unknown persisted anchors without hiding the annotation", () => {
    expect(
      readableAnnotationAnchor({
        anchorKind: "future-kind",
        anchorId: "target-1",
        anchorPath: "output",
      }),
    ).toEqual({ anchorKind: null, anchorId: null, anchorPath: null });
  });

  it("resolves suggestions only to supported trace or span IO fields", () => {
    expect(
      resolveAnnotationSuggestionTarget({
        traceId: "trace-1",
        anchorKind: "field",
        anchorId: "span-1",
        anchorPath: "output",
      }),
    ).toEqual({ kind: "span", spanId: "span-1", field: "output" });
    expect(
      resolveAnnotationSuggestionTarget({
        traceId: "trace-1",
        anchorKind: "message",
        anchorId: "trace-1",
        anchorPath: "message-1",
      }),
    ).toBeNull();
  });
});
