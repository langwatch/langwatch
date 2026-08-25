import { describe, expect, it } from "vitest";
import {
  annotationAnchorColumnsSchema,
  annotationAnchorScopeWhere,
  createAnnotationInputSchema,
} from "../src";

describe("annotation contract", () => {
  it("rejects an incomplete anchor", () => {
    expect(() => annotationAnchorColumnsSchema.parse({ anchorKind: "field" })).toThrow();
  });

  it("keeps trace scope separate from anchored comments", () => {
    expect(annotationAnchorScopeWhere("trace")).toEqual({ anchorKind: null });
    expect(annotationAnchorScopeWhere("all")).toEqual({});
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
});
