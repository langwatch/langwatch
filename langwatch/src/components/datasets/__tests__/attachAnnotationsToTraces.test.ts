import { describe, expect, it } from "vitest";
import { attachAnnotationsToTraces } from "../attachAnnotationsToTraces";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";

const makeAnnotation = ({
  traceId,
  expectedOutput = null,
  comment = null,
}: {
  traceId: string;
  expectedOutput?: string | null;
  comment?: string | null;
}): AnnotationByTrace =>
  ({
    id: `annotation-${traceId}-${expectedOutput ?? comment ?? "x"}`,
    traceId,
    expectedOutput,
    comment,
    isThumbsUp: true,
  }) as AnnotationByTrace;

describe("attachAnnotationsToTraces", () => {
  describe("given a trace with a reviewer annotation", () => {
    it("attaches the annotation so the mapping can read expected_output", () => {
      const result = attachAnnotationsToTraces({
        traces: [{ trace_id: "trace-a" }],
        annotations: [
          makeAnnotation({ traceId: "trace-a", expectedOutput: "42" }),
        ],
      });

      expect(result[0]?.annotations).toHaveLength(1);
      expect(result[0]?.annotations[0]?.expectedOutput).toBe("42");
    });
  });

  describe("given a trace nobody annotated", () => {
    // The absent key is exactly what produced a silent empty column, so the
    // field has to exist and be empty rather than be missing.
    it("attaches an empty array rather than leaving the key undefined", () => {
      const result = attachAnnotationsToTraces({
        traces: [{ trace_id: "trace-a" }],
        annotations: [],
      });

      expect(result[0]).toHaveProperty("annotations");
      expect(result[0]?.annotations).toEqual([]);
    });
  });

  describe("given several reviewers on the same trace", () => {
    it("keeps all of them", () => {
      const result = attachAnnotationsToTraces({
        traces: [{ trace_id: "trace-a" }],
        annotations: [
          makeAnnotation({ traceId: "trace-a", comment: "first" }),
          makeAnnotation({ traceId: "trace-a", comment: "second" }),
        ],
      });

      expect(result[0]?.annotations).toHaveLength(2);
    });
  });

  describe("given annotations belonging to other traces", () => {
    it("routes each annotation to its own trace only", () => {
      const result = attachAnnotationsToTraces({
        traces: [{ trace_id: "trace-a" }, { trace_id: "trace-b" }],
        annotations: [
          makeAnnotation({ traceId: "trace-b", expectedOutput: "b-answer" }),
          makeAnnotation({ traceId: "trace-a", expectedOutput: "a-answer" }),
        ],
      });

      expect(result[0]?.annotations[0]?.expectedOutput).toBe("a-answer");
      expect(result[1]?.annotations[0]?.expectedOutput).toBe("b-answer");
    });

    it("ignores annotations whose trace is not in the set", () => {
      const result = attachAnnotationsToTraces({
        traces: [{ trace_id: "trace-a" }],
        annotations: [makeAnnotation({ traceId: "trace-elsewhere" })],
      });

      expect(result[0]?.annotations).toEqual([]);
    });
  });

  describe("given the other fields on a trace", () => {
    it("preserves them", () => {
      const result = attachAnnotationsToTraces({
        traces: [{ trace_id: "trace-a", input: { value: "hello" } }],
        annotations: [],
      });

      expect(result[0]?.input).toEqual({ value: "hello" });
    });
  });

  describe("given no traces at all", () => {
    it("returns nothing rather than throwing", () => {
      expect(
        attachAnnotationsToTraces({ traces: [], annotations: [] }),
      ).toEqual([]);
    });
  });
});
