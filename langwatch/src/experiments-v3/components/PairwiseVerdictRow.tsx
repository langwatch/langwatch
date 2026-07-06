/**
 * Per-row pairwise verdict wrapper (#5100).
 *
 * Resolves variant target ids to display names via `useTargetName` and
 * normalizes the stored label (which under the new winner-by-id contract
 * is the candidate id — for prompt targets, the prompt HANDLE) into a
 * slot letter before delegating to RowVerdictStrip. Both hooks-driven
 * concerns live here so the parent loop in TargetCell stays hooks-free.
 *
 * Used by TargetCell: when this cell's target is the variantA of a
 * pairwise evaluator AND a processed verdict exists for this row, render
 * the strip exactly once per row (next to variantA's output column).
 */

import { useTargetName } from "../hooks/useTargetName";
import type { TargetConfig } from "../types";
import { normalizePairwiseLabel } from "../utils/computeAggregates";
import { RowVerdictStrip } from "./RowVerdictStrip";

export type PairwiseVerdictRowProps = {
  variantA: TargetConfig;
  variantB: TargetConfig;
  /**
   * Raw verdict label from the pairwise evaluator. May be a slot letter
   * ("A" / "B" / "tie") from legacy runs OR the winning candidate's
   * identifier (target id or prompt handle) from current runs. The
   * component normalizes both shapes; returns null if neither matches.
   */
  label: string;
  reasoning?: string;
};

export function PairwiseVerdictRow({
  variantA,
  variantB,
  label,
  reasoning,
}: PairwiseVerdictRowProps) {
  const variantAName = useTargetName(variantA);
  const variantBName = useTargetName(variantB);

  const normalized = normalizePairwiseLabel(
    label,
    variantA.id,
    variantB.id,
    variantAName || undefined,
    variantBName || undefined,
  );
  if (!normalized) return null;

  return (
    <RowVerdictStrip
      label={normalized}
      variantAName={variantAName}
      variantBName={variantBName}
      reasoning={reasoning}
    />
  );
}
