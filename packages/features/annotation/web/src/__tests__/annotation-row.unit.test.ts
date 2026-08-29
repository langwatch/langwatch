import { describe, expect, it } from "vitest";
import {
  annotationAnchorLabel,
  annotationRatingExportLabel,
  annotationScores,
  annotationScoresLine,
  countAnnotationScores,
  groupedAnnotationsToRows,
  queueItemsToRows,
  suggestionExportLine,
  toOccurredAtMsHint,
  type AnnotationWithUser,
} from "../annotation-row";
import { readAnnotationScoreOptions } from "../index";

const score = (scoreOptions: unknown) => ({ scoreOptions });

const annotation = ({
  id,
  createdAt,
  anchorKind = null,
  anchorId = null,
  anchorPath = null,
}: {
  id: string;
  createdAt: string;
  anchorKind?: string | null;
  anchorId?: string | null;
  anchorPath?: string | null;
}): AnnotationWithUser => ({
  id,
  projectId: "project-1",
  traceId: "trace-1",
  userId: "user-1",
  comment: "comment",
  isThumbsUp: null,
  scoreOptions: {},
  expectedOutput: "expected",
  anchorKind,
  anchorId,
  anchorPath,
  createdAt,
  updatedAt: createdAt,
});

describe("annotation row score presentation", () => {
  it("keeps only score choices the controlled form can edit", () => {
    expect(
      readAnnotationScoreOptions({
        helpfulness: { value: "helpful", reason: "answered directly" },
        malformed: { value: true },
      }),
    ).toEqual({
      helpfulness: { value: "helpful", reason: "answered directly" },
    });

    expect(
      readAnnotationScoreOptions({
        helpfulness: { value: ["helpful", "concise"] },
      }),
    ).toEqual({ helpfulness: { value: ["helpful", "concise"] } });
  });

  it("exports only explicit ratings", () => {
    expect(annotationRatingExportLabel(true)).toBe("Thumbs Up");
    expect(annotationRatingExportLabel(false)).toBe("Thumbs Down");
    expect(annotationRatingExportLabel(null)).toBe("");
    expect(annotationRatingExportLabel(void 0)).toBe("");
  });

  it("uses project score names and preserves score reasons", () => {
    const line = annotationScoresLine({
      annotation: score({
        "score-1": { value: "mild", reason: "not enough detail" },
      }),
      scoreNamesById: new Map([["score-1", "goodness"]]),
    });

    expect(line).toBe("goodness: mild (not enough detail)");
  });

  it("keeps a retired score readable by its stored id", () => {
    const line = annotationScoresLine({
      annotation: score({ "score-retired": { value: "mild" } }),
      scoreNamesById: new Map(),
    });

    expect(line).toBe("score-retired: mild");
  });

  it("joins multi-value answers and ignores blank values", () => {
    const annotation = score({
      "score-1": { value: ["mild", "vague"] },
      "score-2": { value: "" },
      "score-3": { value: null },
    });

    expect(annotationScores({ annotation })).toEqual([
      { name: "score-1", values: ["mild", "vague"], reason: null },
    ]);
  });

  it("counts answers rather than reviewers", () => {
    expect(
      countAnnotationScores([
        score({ "score-1": { value: "mild" }, "score-2": { value: "4" } }),
        score({ "score-1": { value: "strong" } }),
      ]),
    ).toBe(3);
  });

  it("ignores malformed score payloads", () => {
    expect(
      annotationScores({
        annotation: score({
          "score-1": "mild",
          "score-2": { value: "valid" },
        }),
      }),
    ).toEqual([{ name: "score-2", values: ["valid"], reason: null }]);
    expect(annotationScores({ annotation: score(null) })).toEqual([]);
  });
});

describe("annotation row shaping", () => {
  it("describes trace and span field anchors without exposing unknown anchors", () => {
    expect(
      annotationAnchorLabel({
        annotation: {
          anchorKind: "field",
          anchorId: "trace-1",
          anchorPath: "output.answer",
        },
        traceId: "trace-1",
      }),
    ).toBe("Trace · Output · answer");
    expect(
      annotationAnchorLabel({
        annotation: {
          anchorKind: "field",
          anchorId: "span-1",
          anchorPath: "input",
        },
        traceId: "trace-1",
      }),
    ).toBe("Span span-1 · Input");
    expect(
      annotationAnchorLabel({
        annotation: {
          anchorKind: "future-kind",
          anchorId: "span-1",
          anchorPath: "input",
        },
        traceId: "trace-1",
      }),
    ).toBeNull();
  });

  it("keeps suggestion export labels tied to their anchor", () => {
    expect(
      suggestionExportLine({
        annotation: {
          expectedOutput: "corrected",
          anchorKind: "field",
          anchorId: "span-1",
          anchorPath: "output",
        },
        traceId: "trace-1",
      }),
    ).toBe("Span span-1 · Output: corrected");
  });

  it("preserves queue identity, dates and occurrence hints", () => {
    const rows = queueItemsToRows([
      {
        id: "queue-1",
        traceId: "trace-1",
        createdAt: "2026-08-25T08:00:00.000Z",
        trace: {
          trace_id: "trace-1",
          timestamps: { started_at: "2026-08-25T07:00:00.000Z" },
        },
      },
    ]);

    expect(rows[0]).toMatchObject({
      id: "queue-1",
      queueItemId: "queue-1",
      traceId: "trace-1",
      occurredAtMs: Date.parse("2026-08-25T07:00:00.000Z"),
      date: new Date("2026-08-25T08:00:00.000Z"),
    });
  });

  it("dates grouped rows by their newest annotation", () => {
    const rows = groupedAnnotationsToRows([
      {
        traceId: "trace-1",
        annotations: [
          annotation({ id: "annotation-1", createdAt: "2026-08-24T08:00:00.000Z" }),
          annotation({ id: "annotation-2", createdAt: "2026-08-25T08:00:00.000Z" }),
        ],
      },
    ]);

    expect(rows[0]?.queueItemId).toBeNull();
    expect(rows[0]?.date).toEqual(new Date("2026-08-25T08:00:00.000Z"));
    expect(toOccurredAtMsHint("not-a-date")).toBe(void 0);
  });
});
