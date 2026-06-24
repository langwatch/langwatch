import {
  Box,
  Button,
  HStack,
  Icon,
  Spacer,
  Text,
} from "@chakra-ui/react";
import { LuCheck, LuDownload, LuRocket } from "react-icons/lu";

/**
 * Aggregate header bar for a pairwise evaluator run (#5100).
 *
 * Renders above the EvaluationsV3 table when at least one row has a
 * pairwise verdict. Shows the running tally, the bias-corrected
 * indicator, total judge cost, filter chips for the visible row
 * subset, and the export / promote handoff buttons (see step F).
 */

export type PairwiseFilter = "all" | "a" | "b" | "losses";

export type AggregateHeaderBarProps = {
  /** Counts across all rows with a verdict. */
  counts: { a: number; b: number; tie: number };
  /** Human-readable variant names for the tally labels. */
  variantAName: string;
  variantBName: string;
  /** Total judge cost (sum of all per-row pairwise costs), in USD. */
  totalCost: number;
  /** Currently active filter chip. */
  activeFilter: PairwiseFilter;
  onFilterChange: (next: PairwiseFilter) => void;
  /** Step F handoffs — see issue #5100. */
  onExport: () => void;
  onPromoteA: () => void;
  onPromoteB: () => void;
  /** Set true when swap_and_confirm produced these results. */
  biasCorrected?: boolean;
};

const FILTER_LABELS: Record<PairwiseFilter, (a: string, b: string) => string> = {
  all: () => "All",
  a: (a) => a,
  b: (_a, b) => b,
  losses: () => "Losses (regressions)",
};

export function AggregateHeaderBar({
  counts,
  variantAName,
  variantBName,
  totalCost,
  activeFilter,
  onFilterChange,
  onExport,
  onPromoteA,
  onPromoteB,
  biasCorrected = true,
}: AggregateHeaderBarProps) {
  return (
    <HStack
      paddingX={3}
      paddingY={2}
      borderBottom="1px solid"
      borderColor="border.muted"
      bg="bg.subtle"
      fontSize="sm"
      gap={3}
      flexWrap="wrap"
    >
      <Text fontWeight="medium">
        {variantAName} wins {counts.a} · {variantBName} wins {counts.b} · Ties{" "}
        {counts.tie}
      </Text>

      {biasCorrected ? (
        <HStack gap={1} color="green.fg" fontSize="xs">
          <Icon as={LuCheck} boxSize="14px" />
          <Text>Bias-corrected</Text>
        </HStack>
      ) : null}

      <Text fontSize="xs" color="fg.muted">
        Judge cost: ${totalCost.toFixed(4)}
      </Text>

      <Spacer />

      <HStack gap={1}>
        {(["all", "a", "b", "losses"] as const).map((key) => (
          <Button
            key={key}
            size="xs"
            variant={activeFilter === key ? "solid" : "outline"}
            onClick={() => onFilterChange(key)}
          >
            {FILTER_LABELS[key](variantAName, variantBName)}
          </Button>
        ))}
      </HStack>

      <Box width="1px" height="20px" bg="border.muted" />

      <HStack gap={1}>
        <Button size="xs" variant="ghost" onClick={onExport}>
          <Icon as={LuDownload} boxSize="14px" />
          Export
        </Button>
        <Button size="xs" variant="ghost" onClick={onPromoteA}>
          <Icon as={LuRocket} boxSize="14px" />
          Promote {variantAName}
        </Button>
        <Button size="xs" variant="ghost" onClick={onPromoteB}>
          <Icon as={LuRocket} boxSize="14px" />
          Promote {variantBName}
        </Button>
      </HStack>
    </HStack>
  );
}
