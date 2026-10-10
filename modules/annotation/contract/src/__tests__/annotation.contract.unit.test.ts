import { describe, expect, it } from "vitest";
import { ZodError } from "zod";

import {
  annotationAnchorColumnsSchema,
  createAnnotationInputSchema,
  readableAnnotationAnchor,
  findAnnotationSuggestionTargets,
} from "../index.ts";

describe("annotation contract", () => {
  it("rejects an incomplete anchor", () => {
    expect(() => annotationAnchorColumnsSchema.parse({ anchorKind: "field" })).toThrow(ZodError);
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
      findAnnotationSuggestionTargets({
        traceId: "trace-1",
        anchorKind: "field",
        anchorId: "span-1",
        anchorPath: "output",
      }),
    ).toEqual([{ kind: "span", spanId: "span-1", field: "output" }]);

    expect(
      findAnnotationSuggestionTargets({
        traceId: "trace-1",
        anchorKind: "message",
        anchorId: "trace-1",
        anchorPath: "message-1",
      }),
    ).toEqual([]);
  });
});
