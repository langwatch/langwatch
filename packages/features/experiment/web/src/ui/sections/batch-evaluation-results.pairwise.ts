/**
 * Adapts a Comparison column's per-row verdicts into the input shape
 * `computeBTLeaderboard` expects (#5103). Pure, no I/O.
 */
import type { PairwiseComparison } from "../../model/batch-evaluation-results.bt-leaderboard";
import type { BatchComparisonColumn } from "./batch-evaluation-results.types";

export function buildPairwiseComparisons(
  column: BatchComparisonColumn,
): PairwiseComparison[] {
  return Object.values(column.verdictsByRow).map((verdict) => {
    // Three different things leave winnerId === null, and only one of them is
    // evidence. A genuine tie is real 0.5/0.5 evidence; an unresolved label
    // and a row the judge never settled are no evidence at all and are
    // excluded via winner: null. The distinction cannot be re-derived from
    // winnerId, so it is read off the two flags.
    const winner: string | "tie" | null =
      verdict.isUnresolved || verdict.isUnsettled
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
