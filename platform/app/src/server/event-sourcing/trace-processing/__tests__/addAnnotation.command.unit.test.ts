import { describe, expect, it } from "vitest";
import { addAnnotation } from "../addAnnotation.command";
import { TRACE_ID } from "./fixtures";

describe("the addAnnotation command", () => {
  it("emits exactly the annotationAdded event", async () => {
    const input = { traceId: TRACE_ID, annotationId: "ann-1", actedAt: 10 };
    expect(await addAnnotation(input)).toEqual([
      { type: "annotationAdded", data: input },
    ]);
  });
});
