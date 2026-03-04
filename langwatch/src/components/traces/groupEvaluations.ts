import type { ElasticSearchEvaluation } from "../../server/tracer/types";

export interface EvaluationGroup {
  /** The evaluator_id shared by all runs in this group, or null for ungrouped entries. */
  evaluatorId: string | null;
  /** All runs sorted from most recent to oldest. */
  runs: ElasticSearchEvaluation[];
  /** The most recent run (same as runs[0]). */
  latest: ElasticSearchEvaluation;
  /** Whether there are previous runs beyond the latest. */
  hasPreviousRuns: boolean;
  /** Number of runs before the latest (runs.length - 1). */
  previousRunCount: number;
}

/**
 * Returns the effective timestamp for sorting, using fallback chain:
 * finished_at -> started_at -> inserted_at -> 0
 */
function getEffectiveTimestamp(evaluation: ElasticSearchEvaluation): number {
  return (
    evaluation.timestamps.finished_at ??
    evaluation.timestamps.started_at ??
    evaluation.timestamps.inserted_at ??
    0
  );
}

/**
 * Groups evaluations by evaluator_id and sorts runs within each group
 * by timestamp (most recent first).
 *
 * Evaluations without an evaluator_id (null/undefined) are treated as
 * individual ungrouped entries, each in their own group.
 */
export function groupEvaluationsByEvaluator(
  evaluations: ElasticSearchEvaluation[] | undefined,
): EvaluationGroup[] {
  if (!evaluations || evaluations.length === 0) {
    return [];
  }

  const grouped = new Map<string, ElasticSearchEvaluation[]>();
  const ungrouped: ElasticSearchEvaluation[] = [];

  for (const evaluation of evaluations) {
    const evaluatorId = evaluation.evaluator_id;

    if (!evaluatorId) {
      ungrouped.push(evaluation);
      continue;
    }

    const existing = grouped.get(evaluatorId);
    if (existing) {
      existing.push(evaluation);
    } else {
      grouped.set(evaluatorId, [evaluation]);
    }
  }

  const sortByTimestampDesc = (
    a: ElasticSearchEvaluation,
    b: ElasticSearchEvaluation,
  ) => getEffectiveTimestamp(b) - getEffectiveTimestamp(a);

  const groupedEntries: EvaluationGroup[] = [];

  for (const [evaluatorId, runs] of grouped) {
    const sortedRuns = [...runs].sort(sortByTimestampDesc);
    groupedEntries.push({
      evaluatorId,
      runs: sortedRuns,
      latest: sortedRuns[0]!,
      hasPreviousRuns: sortedRuns.length > 1,
      previousRunCount: sortedRuns.length - 1,
    });
  }

  groupedEntries.sort(
    (a, b) => getEffectiveTimestamp(b.latest) - getEffectiveTimestamp(a.latest),
  );

  // Ungrouped entries (those without an evaluator_id) appear after all grouped
  // entries, sorted by timestamp descending. This keeps evaluator groups prominent
  // at the top while individual evaluations follow.
  const ungroupedEntries: EvaluationGroup[] = ungrouped
    .sort(sortByTimestampDesc)
    .map((evaluation) => ({
      evaluatorId: null,
      runs: [evaluation],
      latest: evaluation,
      hasPreviousRuns: false,
      previousRunCount: 0,
    }));

  return [...groupedEntries, ...ungroupedEntries];
}
