/** @vitest-environment node */
import { describe, expect, it } from "vitest";
import { annotationSuggestedOutput, type AnnotationSuggestionSource } from "../index";

const traceId = "trace-1";

const suggestionOf = (annotation: AnnotationSuggestionSource = {}) =>
  annotationSuggestedOutput({ annotation, traceId });

describe("the expected output an annotation suggests", () => {
  describe("given a comment about the whole trace", () => {
    it("reads the suggestion as the trace's expected output", () => {
      expect(suggestionOf({ expectedOutput: "the right answer" })).toBe("the right answer");
    });

    it("reads nothing when the reviewer suggested nothing", () => {
      expect(suggestionOf({ expectedOutput: null })).toBeNull();
    });
  });

  describe("given a comment on the trace's own output", () => {
    it("reads the suggestion as the trace's expected output", () => {
      expect(
        suggestionOf({
          expectedOutput: "the right answer",
          anchorKind: "field",
          anchorId: traceId,
          anchorPath: "output",
        }),
      ).toBe("the right answer");
    });
  });

  describe("given a comment on the trace's own input", () => {
    it("reads no expected output, because that is not what was suggested", () => {
      expect(
        suggestionOf({
          expectedOutput: "what the user meant to ask",
          anchorKind: "field",
          anchorId: traceId,
          anchorPath: "input",
        }),
      ).toBeNull();
    });
  });

  describe("given a comment on a span's field", () => {
    it("reads no expected output for a span's output", () => {
      expect(
        suggestionOf({
          expectedOutput: "Amsterdam",
          anchorKind: "field",
          anchorId: "span-search",
          anchorPath: "output",
        }),
      ).toBeNull();
    });

    it("reads no expected output for a span's input", () => {
      expect(
        suggestionOf({
          expectedOutput: "capital of the Netherlands",
          anchorKind: "field",
          anchorId: "span-search",
          anchorPath: "input",
        }),
      ).toBeNull();
    });
  });

  describe("given a comment on a whole span or on a message", () => {
    it("reads no expected output for a span", () => {
      expect(
        suggestionOf({
          expectedOutput: "something else",
          anchorKind: "span",
          anchorId: "span-search",
        }),
      ).toBeNull();
    });

    it("reads no expected output for a message", () => {
      expect(
        suggestionOf({
          expectedOutput: "something else",
          anchorKind: "message",
          anchorId: traceId,
          anchorPath: "assistant-2-9f1c",
        }),
      ).toBeNull();
    });
  });

  describe("given an anchor this build does not recognise", () => {
    it("reads the suggestion the way the comment itself reads", () => {
      expect(
        suggestionOf({
          expectedOutput: "the right answer",
          anchorKind: "gizmo",
          anchorId: "gizmo-1",
          anchorPath: "somewhere",
        }),
      ).toBe("the right answer");
    });

    it("reads the same way when the kind names nothing at all", () => {
      expect(
        suggestionOf({
          expectedOutput: "the right answer",
          anchorKind: "field",
          anchorId: null,
          anchorPath: "output",
        }),
      ).toBe("the right answer");
    });
  });
});
