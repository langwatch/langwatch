/**
 * buildJudgeAnnotationPairs - joins a pass/fail evaluator's per-row verdict
 * against human reviewer annotations on the SAME target output, keyed by the
 * target's trace id (every experiments-v3 target execution gets a real,
 * dereferenceable trace id — see orchestrator.ts's generateOtelTraceId()).
 *
 * A row only becomes a matrix data point when it has BOTH a resolved judge
 * verdict AND at least one reviewer annotation. Unannotated rows are not a
 * "no opinion" vote — they carry no ground truth and must not silently
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
  /** Subset of annotatedRows where reviewers disagreed — excluded from pairs. */
  conflictingRows: number;
  /**
   * True when annotation lookup was capped, so `totalRows` is the slice that
   * was checked rather than the whole run. Surfaced in the drawer: a silent
   * truncation reads as "we measured everything", which is the one thing this
   * chart must never imply.
   */
  truncated?: boolean;
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
    const target = row.targets[targetId];
    if (!target?.traceId) continue;

    const evaluatorResult = target.evaluatorResults.find(
      (result) => result.evaluatorId === evaluatorId,
    );
    if (
      !evaluatorResult ||
      evaluatorResult.passed === null ||
      evaluatorResult.passed === undefined
    ) {
      continue;
    }

    const annotations = annotationsByTraceId.get(target.traceId) ?? [];
    // Only annotations that carry a verdict count as ground truth — and only
    // they may explain it. A comment-only annotation ("checking this later")
    // is not the reviewer's rationale for the thumbs up/down being scored,
    // so it must not become the drill-down's stated reason.
    const reviewerVerdicts = annotations.filter(
      (annotation): annotation is AnnotationByTrace & { isThumbsUp: boolean } =>
        annotation.isThumbsUp !== null && annotation.isThumbsUp !== undefined,
    );
    if (reviewerVerdicts.length === 0) continue;

    annotatedRows++;

    const distinctVerdicts = new Set(
      reviewerVerdicts.map((annotation) => annotation.isThumbsUp),
    );
    if (distinctVerdicts.size > 1) {
      conflictingRows++;
      continue;
    }

    // First non-empty comment among the (now known to agree) reviewers.
    const comment = reviewerVerdicts
      .map((annotation) => annotation.comment?.trim())
      .find((value): value is string => !!value);

    pairs.push({
      rowIndex: row.index,
      predicted: evaluatorResult.passed,
      actual: reviewerVerdicts[0]!.isThumbsUp,
      ...(comment ? { comment } : {}),
    });
  }

  return {
    pairs,
    totalRows: rows.length,
    annotatedRows,
    conflictingRows,
  };
};
