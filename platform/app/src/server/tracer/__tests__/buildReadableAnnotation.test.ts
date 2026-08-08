/**
 * One reviewer's annotation as a single readable line.
 * See specs/datasets/dataset-annotations-mapping.feature.
 */
import type { AnnotationScore } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  buildReadableAnnotation,
  type TraceAnnotation,
} from "../tracesMapping";

const TRACE_ID = "trace-1";

/** A stored annotation, with only the parts a scenario cares about filled in. */
const annotationWith = (fields: Partial<TraceAnnotation>): TraceAnnotation => ({
  id: "annotation-1",
  projectId: "project-1",
  traceId: TRACE_ID,
  comment: null,
  isThumbsUp: null,
  userId: null,
  user: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  email: null,
  scoreOptions: null,
  expectedOutput: null,
  anchorKind: null,
  anchorId: null,
  anchorPath: null,
  ...fields,
});

const GOODNESS: AnnotationScore = {
  id: "score-abc123",
  name: "goodness",
} as AnnotationScore;

const SPAN_NAMES = new Map<string, string | null | undefined>([
  ["span-1", "web_search"],
]);

describe("given an annotation left on part of a trace", () => {
  describe("when it is read into the ai_readable column", () => {
    /** @scenario "The readable annotation names the part of the trace it is about" */
    it("names the span and the field the comment was left on", () => {
      const line = buildReadableAnnotation({
        annotation: annotationWith({
          user: { name: "Ada" },
          comment: "too terse",
          anchorKind: "field",
          anchorId: "span-1",
          anchorPath: "output",
        }),
        traceId: TRACE_ID,
        spanNamesById: SPAN_NAMES,
      });

      expect(line).toBe("Ada (on Span web_search · Output): too terse");
    });

    it("falls back to the span id when the trace does not carry that span", () => {
      const line = buildReadableAnnotation({
        annotation: annotationWith({
          user: { name: "Ada" },
          comment: "too terse",
          anchorKind: "span",
          anchorId: "span-missing",
        }),
        traceId: TRACE_ID,
        spanNamesById: SPAN_NAMES,
      });

      expect(line).toBe("Ada (on Span span-missing): too terse");
    });

    /** @scenario "A comment left on a message reads as a message" */
    it("says the comment is about a message", () => {
      const line = buildReadableAnnotation({
        annotation: annotationWith({
          user: { name: "Ada" },
          comment: "wrong tone",
          anchorKind: "message",
          anchorId: TRACE_ID,
          anchorPath: "message-7",
        }),
        traceId: TRACE_ID,
      });

      expect(line).toBe("Ada (on Message): wrong tone");
    });
  });
});

describe("given an annotation about the whole trace", () => {
  describe("when it is read into the ai_readable column", () => {
    /** @scenario "A comment about the whole trace reads with no part named" */
    it("reads as the author and their comment, with no part named", () => {
      const line = buildReadableAnnotation({
        annotation: annotationWith({
          user: { name: "Ada" },
          comment: "too terse",
        }),
        traceId: TRACE_ID,
      });

      expect(line).toBe("Ada: too terse");
    });
  });
});

describe("given an annotation carrying everything a reviewer can leave", () => {
  const everything = () =>
    buildReadableAnnotation({
      annotation: annotationWith({
        user: { name: "Ada" },
        comment: "too terse",
        isThumbsUp: false,
        scoreOptions: {
          "score-abc123": { value: "mild", reason: "not enough detail" },
        },
        expectedOutput: "A fuller answer.",
        anchorKind: "field",
        anchorId: "span-1",
        anchorPath: "output",
      }),
      traceId: TRACE_ID,
      spanNamesById: SPAN_NAMES,
      scoreOptions: [GOODNESS],
    });

  describe("when it is read into the ai_readable column", () => {
    /** @scenario "The readable annotation carries author, part, score and comment in one line" */
    it("carries the author, the part, the comment, the rating, the score and the suggestion", () => {
      expect(everything()).toBe(
        "Ada (on Span web_search · Output): too terse [thumbs down] " +
          "[goodness: mild, reason: not enough detail] " +
          "[suggested output: A fuller answer.]",
      );
    });

    it("stays a single line", () => {
      expect(everything()).not.toContain("\n");
    });

    it("writes no em dash", () => {
      expect(everything()).not.toContain("—");
    });
  });
});

describe("given an annotation scored against the project's scores", () => {
  describe("when it is read into the ai_readable column", () => {
    /** @scenario "A score reads by its name, not by its id" */
    it("names the score rather than its id", () => {
      const line = buildReadableAnnotation({
        annotation: annotationWith({
          user: { name: "Ada" },
          scoreOptions: { "score-abc123": { value: "mild", reason: null } },
        }),
        traceId: TRACE_ID,
        scoreOptions: [GOODNESS],
      });

      expect(line).toBe("Ada [goodness: mild]");
      expect(line).not.toContain("score-abc123");
    });

    it("joins the answers of a score that takes several", () => {
      const line = buildReadableAnnotation({
        annotation: annotationWith({
          user: { name: "Ada" },
          scoreOptions: {
            "score-abc123": { value: ["mild", "vague"], reason: null },
          },
        }),
        traceId: TRACE_ID,
        scoreOptions: [GOODNESS],
      });

      expect(line).toBe("Ada [goodness: mild, vague]");
    });

    it("leaves out a score the reviewer did not answer", () => {
      const line = buildReadableAnnotation({
        annotation: annotationWith({
          user: { name: "Ada" },
          comment: "too terse",
          scoreOptions: { "score-abc123": { value: null, reason: null } },
        }),
        traceId: TRACE_ID,
        scoreOptions: [GOODNESS],
      });

      expect(line).toBe("Ada: too terse");
    });

    it("names the score by its id when the project no longer has it", () => {
      const line = buildReadableAnnotation({
        annotation: annotationWith({
          user: { name: "Ada" },
          scoreOptions: { "score-removed": { value: "mild" } },
        }),
        traceId: TRACE_ID,
        scoreOptions: [GOODNESS],
      });

      expect(line).toBe("Ada [score-removed: mild]");
    });
  });
});

describe("given an annotation whose author has no account name", () => {
  describe("when it is read into the ai_readable column", () => {
    /** @scenario "A reviewer with no account name reads by their email" */
    it("names them by their email", () => {
      const line = buildReadableAnnotation({
        annotation: annotationWith({
          email: "ada@example.com",
          comment: "too terse",
        }),
        traceId: TRACE_ID,
      });

      expect(line).toBe("ada@example.com: too terse");
    });

    it("reads as Unknown when there is no email either", () => {
      const line = buildReadableAnnotation({
        annotation: annotationWith({ comment: "too terse" }),
        traceId: TRACE_ID,
      });

      expect(line).toBe("Unknown: too terse");
    });
  });
});

describe("given an annotation written across several lines", () => {
  describe("when it is read into the ai_readable column", () => {
    /** @scenario "A comment spanning several lines stays on one line" */
    it("holds it as a single line", () => {
      const line = buildReadableAnnotation({
        annotation: annotationWith({
          user: { name: "Ada" },
          comment: "too terse\n\nand it skipped the second question",
          expectedOutput: "A fuller\nanswer.",
        }),
        traceId: TRACE_ID,
      });

      expect(line).toBe(
        "Ada: too terse and it skipped the second question " +
          "[suggested output: A fuller answer.]",
      );
    });
  });
});

describe("given an annotation with only a thumbs rating", () => {
  describe("when it is read into the ai_readable column", () => {
    it("reads as the author and the rating", () => {
      expect(
        buildReadableAnnotation({
          annotation: annotationWith({
            user: { name: "Ada" },
            isThumbsUp: true,
          }),
          traceId: TRACE_ID,
        }),
      ).toBe("Ada [thumbs up]");
    });

    it("leaves the rating out when the reviewer gave none", () => {
      expect(
        buildReadableAnnotation({
          annotation: annotationWith({
            user: { name: "Ada" },
            comment: "too terse",
          }),
          traceId: TRACE_ID,
        }),
      ).toBe("Ada: too terse");
    });
  });
});
