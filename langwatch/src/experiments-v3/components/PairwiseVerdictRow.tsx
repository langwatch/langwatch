/**
 * Per-row pairwise verdict wrapper (#5100, #5101).
 *
 * Resolves variant target ids to display names via `useTargetName` and
 * translates the raw "A"/"B"/"tie" slot label (pairwise mode from
 * #5100) into the mode-agnostic { winnerName, isTie } prop pair that
 * the post-#5101 RowVerdictStrip accepts. Lives as a child component
 * so the name-resolution hooks aren't called inside parent loops.
 *
 * Used by TargetCell: when this cell's target is the first variant of
 * a pairwise evaluator AND a verdict exists for this row, render the
 * strip exactly once per row.
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

  const isTie = label === "tie";
  const winnerName = isTie
    ? "Tie"
    : label === "A"
      ? variantAName
      : variantBName;

  return (
    <RowVerdictStrip
      winnerName={winnerName}
      isTie={isTie}
      reasoning={reasoning}
    />
  );
}
