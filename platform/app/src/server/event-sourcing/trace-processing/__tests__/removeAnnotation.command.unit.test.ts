import { describe, expect, it } from "vitest";
import { removeAnnotation } from "../removeAnnotation.command";
import { TRACE_ID } from "./fixtures";

describe("the removeAnnotation command", () => {
  it("emits exactly the annotationRemoved event", async () => {
    const input = { traceId: TRACE_ID, annotationId: "ann-1", actedAt: 10 };
    expect(await removeAnnotation(input)).toEqual([
      { type: "annotationRemoved", data: input },
    ]);
  });
});
