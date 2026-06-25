/**
 * Per-row pairwise verdict wrapper (#5100).
 *
 * Resolves variant target ids to display names via `useTargetName` and
 * delegates rendering to RowVerdictStrip. Lives as a child component so
 * the name-resolution hooks aren't called inside parent loops.
 *
 * Used by TargetCell: when this cell's target is the variantA of a
 * pairwise evaluator AND a verdict exists for this row, render the
 * strip exactly once per row (next to variantA's output column).
 */

import type { TargetConfig } from "../types";
import { useTargetName } from "../hooks/useTargetName";
import { RowVerdictStrip } from "./RowVerdictStrip";

export type PairwiseVerdictRowProps = {
  variantA: TargetConfig;
  variantB: TargetConfig;
  label: "A" | "B" | "tie";
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

  return (
    <RowVerdictStrip
      label={label}
      variantAName={variantAName}
      variantBName={variantBName}
      reasoning={reasoning}
    />
  );
}
