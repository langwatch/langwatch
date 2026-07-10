import { Text } from "@chakra-ui/react";
import { Tooltip } from "~/components/ui/tooltip";
import type { TargetConfig } from "../../types";
import type { ComparisonAggregate } from "../../utils/computeAggregates";
import { labelNamesVariant } from "../../utils/normalizeComparison";

type ComparisonScoreboardProps = {
  aggregate: ComparisonAggregate;
  /** Variant targets in config order; undefined where a target was removed. */
  variantTargets: (TargetConfig | undefined)[];
  /** Raw resolved names, in variant order, as stored verdict labels spell them. */
  variantNames: string[];
  /** Same names with same-name variants numbered, for display only. */
  variantDisplayNames: string[];
};

/** Keeps a long prompt handle from pushing the header's other chips off. */
const shorten = (name: string) =>
  name.length > 18 ? `${name.slice(0, 17)}…` : name;

/**
 * Wins this variant holds. A single run can label the same variant by its
 * prompt handle on one row and its target id on another (the orchestrator
 * falls back when a prompt fails to load), so sum across every identifier
 * that names it rather than reading one key.
 */
const winsForVariant = ({
  winsByLabel,
  target,
  resolvedName,
}: {
  winsByLabel: Record<string, number>;
  target: TargetConfig | undefined;
  resolvedName: string;
}): number => {
  if (!target) return 0;
  return Object.entries(winsByLabel)
    .filter(([label]) => labelNamesVariant({ label, target, resolvedName }))
    .reduce((sum, [, count]) => sum + count, 0);
};

/**
 * The comparison column's header summary: who won overall, for any number of
 * variants.
 *
 * Shows only the qualitative outcome ("<winner> wins" / "Tied"). The exact
 * per-variant counts live in the hover tooltip so numerically-curious users
 * get details while the header itself stays uncluttered (dogfood: "structured-
 * demo-a wins 3 — random number, not useful in the header"). The full
 * per-variant breakdown is on the results page, as a win-rate chart.
 */
export function ComparisonScoreboard({
  aggregate,
  variantTargets,
  variantNames,
  variantDisplayNames,
}: ComparisonScoreboardProps) {
  if (aggregate.decidedRows === 0) return null;

  const { topLabel, winsByLabel, ties } = aggregate;

  // `topLabel` is unset when two or more variants share the lead, and when
  // every row tied. Both read as "Tied" in the header.
  const winnerIndex = topLabel
    ? variantTargets.findIndex(
        (target, index) =>
          !!target &&
          labelNamesVariant({
            label: topLabel,
            target,
            resolvedName: variantNames[index] ?? "",
          }),
      )
    : -1;

  // A winning label that matches no variant means the run recorded an
  // identifier this workbench can't resolve (variant removed since the run).
  // Name it raw rather than claiming a tie that didn't happen.
  const summary = !topLabel
    ? "Tied"
    : `${shorten(
        (winnerIndex >= 0 ? variantDisplayNames[winnerIndex] : topLabel) ??
          topLabel,
      )} wins`;

  const tally = variantTargets.map(
    (target, index) =>
      `${variantDisplayNames[index] ?? `Variant ${index + 1}`}: ${winsForVariant(
        { winsByLabel, target, resolvedName: variantNames[index] ?? "" },
      )} wins`,
  );
  if (ties > 0) tally.push(`${ties} ${ties === 1 ? "tie" : "ties"}`);

  return (
    <Tooltip
      content={tally.join(" · ")}
      positioning={{ placement: "top" }}
      openDelay={200}
    >
      <Text
        fontSize="11px"
        color="fg.muted"
        whiteSpace="nowrap"
        cursor="help"
        data-testid="comparison-scoreboard"
      >
        {summary}
      </Text>
    </Tooltip>
  );
}
