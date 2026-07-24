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
};

export const buildJudgeAnnotationPairs = (
  rows: BatchResultRow[],
  targetId: string,
  evaluatorId: string,
  annotationsByTraceId: Map<string, AnnotationByTrace[]>,
): JudgeAnnotationCoverage => {
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
    const verdicts = annotations
      .map((annotation) => annotation.isThumbsUp)
      .filter((value): value is boolean => value !== null && value !== undefined);
    if (verdicts.length === 0) continue;

    annotatedRows++;

    const distinctVerdicts = new Set(verdicts);
    if (distinctVerdicts.size > 1) {
      conflictingRows++;
      continue;
    }

    // First non-empty comment among the (now known to agree) reviewers.
    const comment = annotations
      .map((annotation) => annotation.comment?.trim())
      .find((value): value is string => !!value);

    pairs.push({
      rowIndex: row.index,
      predicted: evaluatorResult.passed,
      actual: verdicts[0]!,
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
