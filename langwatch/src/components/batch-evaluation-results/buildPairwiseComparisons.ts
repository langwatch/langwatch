/**
 * Adapts a Comparison column's per-row verdicts into the input shape
 * `computeBTLeaderboard` expects (#5103). Pure, no I/O.
 */
import type { PairwiseComparison } from "./computeBTLeaderboard";
import type { BatchComparisonColumn } from "./types";

export function buildPairwiseComparisons(
  column: BatchComparisonColumn,
): PairwiseComparison[] {
  return Object.values(column.verdictsByRow).map((verdict) => {
    // An unresolved label is no evidence at all (excluded via winner: null);
    // a genuine tie is real 0.5/0.5 evidence. Both leave winnerId === null on
    // the verdict itself, so the distinction has to be read off
    // `isUnresolved`, not re-derived from winnerId.
    const winner: string | "tie" | null = verdict.isUnresolved
      ? null
      : verdict.winnerId === null
        ? "tie"
        : verdict.winnerId;

    return {
      // Rows predating candidate-id capture (very old runs) have none
      // recorded — computeBTLeaderboard's own `candidates.length < 2` guard
      // safely no-ops these rather than fabricating a matchup.
      candidates: verdict.candidateIds ?? [],
      winner,
    };
  });
}
