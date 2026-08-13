import { describe, expect, it } from "vitest";
import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import { buildJudgeAnnotationPairs } from "../buildJudgeAnnotationPairs";
import type { BatchResultRow } from "../types";

const TARGET_ID = "target-1";
const EVALUATOR_ID = "eval-1";

const makeRow = ({
  index,
  traceId,
  passed,
}: {
  index: number;
  traceId: string | null;
  passed?: boolean | null;
}): BatchResultRow => ({
  index,
  datasetEntry: {},
  targets: {
    [TARGET_ID]: {
      targetId: TARGET_ID,
      output: { output: "some output" },
      cost: 0.001,
      duration: 100,
      error: null,
      traceId,
      evaluatorResults:
        passed === undefined
          ? []
          : [
              {
                evaluatorId: EVALUATOR_ID,
                evaluatorName: "Exact Match",
                status: "processed",
                passed,
              },
            ],
    },
  },
});

const makeAnnotation = ({
  traceId,
  isThumbsUp,
  comment,
}: {
  traceId: string;
  isThumbsUp: boolean | null;
  comment?: string | null;
}): AnnotationByTrace =>
  ({
    id: `annotation-${traceId}-${Math.random()}`,
    traceId,
    isThumbsUp,
    comment: comment ?? null,
  }) as AnnotationByTrace;

const toMap = (
  annotations: AnnotationByTrace[],
): Map<string, AnnotationByTrace[]> => {
  const map = new Map<string, AnnotationByTrace[]>();
  for (const annotation of annotations) {
    const existing = map.get(annotation.traceId) ?? [];
    existing.push(annotation);
    map.set(annotation.traceId, existing);
  }
  return map;
};

describe("buildJudgeAnnotationPairs", () => {
  describe("when a row has both a judge verdict and a single reviewer annotation", () => {
    it("produces a resolved pair with the judge's and reviewer's verdicts", () => {
      const rows = [makeRow({ index: 0, traceId: "trace-a", passed: true })];
      const annotations = toMap([
        makeAnnotation({ traceId: "trace-a", isThumbsUp: true }),
      ]);

      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: annotations,
      });

      expect(result.pairs).toEqual([
        { rowIndex: 0, predicted: true, actual: true },
      ]);
      expect(result.annotatedRows).toBe(1);
      expect(result.conflictingRows).toBe(0);
    });

    it("still resolves when judge and reviewer disagree", () => {
      const rows = [makeRow({ index: 0, traceId: "trace-a", passed: true })];
      const annotations = toMap([
        makeAnnotation({ traceId: "trace-a", isThumbsUp: false }),
      ]);

      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: annotations,
      });

      expect(result.pairs).toEqual([
        { rowIndex: 0, predicted: true, actual: false },
      ]);
    });
  });

  describe("when a row has no trace id", () => {
    it("is excluded from pairs and does not count as annotated", () => {
      const rows = [makeRow({ index: 0, traceId: null, passed: true })];
      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: toMap([]),
      });

      expect(result.pairs).toHaveLength(0);
      expect(result.annotatedRows).toBe(0);
      expect(result.totalRows).toBe(1);
    });
  });

  describe("when a row has a trace id but no annotation", () => {
    /** @scenario Unannotated rows are excluded, not treated as a verdict */
    it("is excluded from pairs, not treated as a negative verdict", () => {
      const rows = [makeRow({ index: 0, traceId: "trace-a", passed: false })];
      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: toMap([]),
      });

      expect(result.pairs).toHaveLength(0);
      expect(result.annotatedRows).toBe(0);
    });
  });

  describe("when a row's evaluator did not resolve (no evaluatorResults entry, or passed is null)", () => {
    it("excludes rows with no matching evaluator result", () => {
      const rows = [makeRow({ index: 0, traceId: "trace-a" })]; // passed: undefined -> no evaluatorResults
      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: toMap([
          makeAnnotation({ traceId: "trace-a", isThumbsUp: true }),
        ]),
      });

      expect(result.pairs).toHaveLength(0);
    });

    it("excludes rows where passed is explicitly null", () => {
      const rows = [makeRow({ index: 0, traceId: "trace-a", passed: null })];
      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: toMap([
          makeAnnotation({ traceId: "trace-a", isThumbsUp: true }),
        ]),
      });

      expect(result.pairs).toHaveLength(0);
    });
  });

  describe("when a trace has multiple reviewers who disagree", () => {
    /** @scenario A trace with conflicting annotations from multiple reviewers is excluded */
    it("excludes the row from pairs and counts it as conflicting", () => {
      const rows = [makeRow({ index: 0, traceId: "trace-a", passed: true })];
      const annotations = toMap([
        makeAnnotation({ traceId: "trace-a", isThumbsUp: true }),
        makeAnnotation({ traceId: "trace-a", isThumbsUp: false }),
      ]);

      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: annotations,
      });

      expect(result.pairs).toHaveLength(0);
      expect(result.annotatedRows).toBe(1);
      expect(result.conflictingRows).toBe(1);
    });
  });

  describe("when a trace has multiple reviewers who agree", () => {
    it("resolves the row using the shared verdict", () => {
      const rows = [makeRow({ index: 0, traceId: "trace-a", passed: true })];
      const annotations = toMap([
        makeAnnotation({ traceId: "trace-a", isThumbsUp: true }),
        makeAnnotation({ traceId: "trace-a", isThumbsUp: true }),
      ]);

      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: annotations,
      });

      expect(result.pairs).toEqual([
        { rowIndex: 0, predicted: true, actual: true },
      ]);
      expect(result.conflictingRows).toBe(0);
    });
  });

  describe("given a batch mixing resolved, unannotated, trace-less, and conflicting rows", () => {
    it("reports accurate coverage counts alongside the resolved pairs", () => {
      const rows = [
        makeRow({ index: 0, traceId: "trace-a", passed: true }), // annotated, resolved
        makeRow({ index: 1, traceId: "trace-b", passed: false }), // annotated, resolved
        makeRow({ index: 2, traceId: "trace-c", passed: true }), // no annotation
        makeRow({ index: 3, traceId: null, passed: true }), // no trace id
        makeRow({ index: 4, traceId: "trace-d", passed: false }), // conflicting
      ];
      const annotations = toMap([
        makeAnnotation({ traceId: "trace-a", isThumbsUp: true }),
        makeAnnotation({ traceId: "trace-b", isThumbsUp: false }),
        makeAnnotation({ traceId: "trace-d", isThumbsUp: true }),
        makeAnnotation({ traceId: "trace-d", isThumbsUp: false }),
      ]);

      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: annotations,
      });

      expect(result.totalRows).toBe(5);
      expect(result.annotatedRows).toBe(3);
      expect(result.conflictingRows).toBe(1);
      expect(result.pairs).toHaveLength(2);
    });
  });

  describe("given a reviewer comment", () => {
    // On a disagreement cell the reviewer's own words are the explanation of
    // why the judge was wrong, so the pair has to carry them through to the
    // drill-down.
    it("carries the comment onto the pair", () => {
      const rows = [makeRow({ index: 0, traceId: "trace-a", passed: true })];
      const annotations = toMap([
        makeAnnotation({
          traceId: "trace-a",
          isThumbsUp: false,
          comment: "Cancelled the wrong subscription.",
        }),
      ]);

      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: annotations,
      });

      expect(result.pairs[0]?.comment).toBe(
        "Cancelled the wrong subscription.",
      );
    });

    it("omits the comment entirely when the reviewer left none", () => {
      const rows = [makeRow({ index: 0, traceId: "trace-a", passed: true })];
      const annotations = toMap([
        makeAnnotation({ traceId: "trace-a", isThumbsUp: true }),
      ]);

      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: annotations,
      });

      expect(result.pairs[0]).not.toHaveProperty("comment");
    });

    it("ignores a whitespace-only comment", () => {
      const rows = [makeRow({ index: 0, traceId: "trace-a", passed: true })];
      const annotations = toMap([
        makeAnnotation({
          traceId: "trace-a",
          isThumbsUp: true,
          comment: "   ",
        }),
      ]);

      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: annotations,
      });

      expect(result.pairs[0]).not.toHaveProperty("comment");
    });

    it("takes the first non-empty comment when several reviewers agreed", () => {
      const rows = [makeRow({ index: 0, traceId: "trace-a", passed: true })];
      const annotations = toMap([
        makeAnnotation({ traceId: "trace-a", isThumbsUp: true, comment: "" }),
        makeAnnotation({
          traceId: "trace-a",
          isThumbsUp: true,
          comment: "Matches the expected refund flow.",
        }),
      ]);

      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: annotations,
      });

      expect(result.pairs[0]?.comment).toBe(
        "Matches the expected refund flow.",
      );
    });

    /** @scenario A note left without a verdict is not shown as the reviewer's reasoning */
    it("ignores a comment from an annotation that carries no verdict", () => {
      const rows = [makeRow({ index: 0, traceId: "trace-a", passed: true })];
      const annotations = toMap([
        makeAnnotation({
          traceId: "trace-a",
          isThumbsUp: null,
          comment: "Parking this one, will look again tomorrow.",
        }),
        makeAnnotation({
          traceId: "trace-a",
          isThumbsUp: true,
          comment: "Refund amount is right.",
        }),
      ]);

      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: annotations,
      });

      // The verdict-less note is not this reviewer's rationale for the
      // thumbs-up being scored, so it must not become the drill-down's
      // stated reason.
      expect(result.pairs[0]?.comment).toBe("Refund amount is right.");
    });

    /** @scenario A note left without a verdict is not shown as the reviewer's reasoning */
    it("omits the comment when only verdict-less annotations carry one", () => {
      const rows = [makeRow({ index: 0, traceId: "trace-a", passed: true })];
      const annotations = toMap([
        makeAnnotation({
          traceId: "trace-a",
          isThumbsUp: null,
          comment: "Parking this one, will look again tomorrow.",
        }),
        makeAnnotation({ traceId: "trace-a", isThumbsUp: true }),
      ]);

      const result = buildJudgeAnnotationPairs({
        rows,
        targetId: TARGET_ID,
        evaluatorId: EVALUATOR_ID,
        annotationsByTraceId: annotations,
      });

      expect(result.pairs[0]).not.toHaveProperty("comment");
    });
  });
});
