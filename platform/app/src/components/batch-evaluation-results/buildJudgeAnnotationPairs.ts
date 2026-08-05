/**
 * buildJudgeAnnotationPairs - joins a pass/fail evaluator's per-row verdict
 * against human reviewer annotations on the SAME target output, keyed by the
 * target's trace id (every experiments-v3 target execution gets a real,
 * dereferenceable trace id, see orchestrator.ts's generateOtelTraceId()).
 *
 * A row only becomes a matrix data point when it has BOTH a resolved judge
 * verdict AND at least one reviewer annotation. Unannotated rows are not a
 * "no opinion" vote: they carry no ground truth and must not silently
 * become a trueNegative/falseNegative. A trace annotated by more than one
 * reviewer who disagree (isThumbsUp true vs false) has no single ground
 * truth either, so it is excluded and reported separately rather than
 * picked arbitrarily (e.g. "first" or "latest").
 */

import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import type { JudgeAnnotationPair } from "./computeConfusionMatrix";
import type { BatchResultRow } from "./types";

export type JudgeAnnotationCoverage = {
  pairs: JudgeAnnotationPair[];
  totalRows: number;
  /** Rows with at least one reviewer annotation, resolved or conflicting. */
  annotatedRows: number;
  /** Subset of annotatedRows where reviewers disagreed, excluded from pairs. */
  conflictingRows: number;
  /**
   * True when annotation lookup was capped, so `totalRows` is the slice that
   * was checked rather than the whole run. Surfaced in the drawer: a silent
   * truncation reads as "we measured everything", which is the one thing this
   * chart must never imply.
   */
  truncated?: boolean;
};

/**
 * The judge's own verdict for one row, or null when there is nothing to
 * score: no trace id to join reviewers on, or an evaluator that never
 * resolved to a pass/fail.
 */
const judgeVerdictFor = ({
  row,
  targetId,
  evaluatorId,
}: {
  row: BatchResultRow;
  targetId: string;
  evaluatorId: string;
}): { traceId: string; passed: boolean } | null => {
  const target = row.targets[targetId];
  if (!target?.traceId) return null;

  const passed = target.evaluatorResults.find(
    (result) => result.evaluatorId === evaluatorId,
  )?.passed;
  if (passed === null || passed === undefined) return null;

  return { traceId: target.traceId, passed };
};

/**
 * The reviewers' ground truth for one row. Three outcomes, because they are
 * counted differently: no verdict at all is not an annotated row, whereas
 * reviewers who disagree is an annotated row with no usable truth.
 */
type ReviewerGroundTruth =
  | { status: "none" }
  | { status: "conflicting" }
  | { status: "resolved"; verdict: { actual: boolean; comment?: string } };

const reviewerGroundTruthFor = (
  annotations: AnnotationByTrace[],
): ReviewerGroundTruth => {
  // Only annotations that carry a verdict count as ground truth, and only
  // they may explain it. A comment-only annotation ("checking this later")
  // is not the reviewer's rationale for the thumbs up/down being scored,
  // so it must not become the drill-down's stated reason.
  const verdicts = annotations.filter(
    (annotation): annotation is AnnotationByTrace & { isThumbsUp: boolean } =>
      annotation.isThumbsUp !== null && annotation.isThumbsUp !== undefined,
  );
  if (verdicts.length === 0) return { status: "none" };

  const distinct = new Set(verdicts.map((annotation) => annotation.isThumbsUp));
  if (distinct.size > 1) return { status: "conflicting" };

  // First non-empty comment among the (now known to agree) reviewers.
  const comment = verdicts
    .map((annotation) => annotation.comment?.trim())
    .find((value): value is string => !!value);

  return {
    status: "resolved",
    verdict: {
      actual: verdicts[0]!.isThumbsUp,
      ...(comment ? { comment } : {}),
    },
  };
};

export const buildJudgeAnnotationPairs = ({
  rows,
  targetId,
  evaluatorId,
  annotationsByTraceId,
}: {
  rows: BatchResultRow[];
  targetId: string;
  evaluatorId: string;
  annotationsByTraceId: Map<string, AnnotationByTrace[]>;
}): JudgeAnnotationCoverage => {
  const pairs: JudgeAnnotationPair[] = [];
  let annotatedRows = 0;
  let conflictingRows = 0;

  for (const row of rows) {
    const judged = judgeVerdictFor({ row, targetId, evaluatorId });
    if (!judged) continue;

    const reviewed = reviewerGroundTruthFor(
      annotationsByTraceId.get(judged.traceId) ?? [],
    );
    if (reviewed.status === "none") continue;

    annotatedRows++;
    if (reviewed.status === "conflicting") {
      conflictingRows++;
      continue;
    }

    pairs.push({
      rowIndex: row.index,
      predicted: judged.passed,
      ...reviewed.verdict,
    });
  }

  return {
    pairs,
    totalRows: rows.length,
    annotatedRows,
    conflictingRows,
  };
};
