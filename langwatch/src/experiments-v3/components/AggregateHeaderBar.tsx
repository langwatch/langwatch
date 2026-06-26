import { Box, Button, HStack, Icon, Spacer, Text } from "@chakra-ui/react";
import { Download, Equal, Trophy } from "lucide-react";

import { Tooltip } from "~/components/ui/tooltip";

/**
 * Aggregate header bar for a pairwise evaluator run (#5100).
 *
 * Renders above the EvaluationsV3 table when at least one row has a
 * pairwise verdict. Compact scoreboard: leader + score + ties + filter
 * + Download CSV.
 */

export type PairwiseFilter = "all" | "a" | "b" | "losses";

export type AggregateHeaderBarProps = {
  /** Counts across all rows with a verdict. */
  counts: { a: number; b: number; tie: number };
  /** Human-readable variant names. */
  variantAName: string;
  variantBName: string;
  /** Total judge cost (sum of all per-row pairwise costs), in USD. */
  totalCost: number;
  /** Currently active filter chip. */
  activeFilter: PairwiseFilter;
  onFilterChange: (next: PairwiseFilter) => void;
  /** Download per-row verdicts as CSV. */
  onExport: () => void;
};

const FILTER_LABELS: Record<PairwiseFilter, (a: string, b: string) => string> = {
  all: () => "All",
  a: (a) => `${a}`,
  b: (_a, b) => `${b}`,
  losses: () => "Losses",
};

export function AggregateHeaderBar({
  counts,
  variantAName,
  variantBName,
  totalCost,
  activeFilter,
  onFilterChange,
  onExport,
}: AggregateHeaderBarProps) {
  const total = counts.a + counts.b + counts.tie;
  const leader =
    counts.a > counts.b ? "a" : counts.b > counts.a ? "b" : "tie";
  const leaderName = leader === "a" ? variantAName : variantBName;
  const otherName = leader === "a" ? variantBName : variantAName;
  const leaderWins = leader === "a" ? counts.a : counts.b;
  const otherWins = leader === "a" ? counts.b : counts.a;

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
      {leader === "tie" ? (
        <HStack gap={2}>
          <Icon as={Equal} color="fg.muted" boxSize="14px" />
          <Text fontWeight="medium">
            Even{" "}
            <Text as="span" color="fg.muted" fontWeight="normal">
              · {variantAName} {counts.a} – {variantBName} {counts.b}
              {counts.tie ? ` · ${counts.tie} ties` : ""}
            </Text>
          </Text>
        </HStack>
      ) : (
        <HStack gap={2}>
          <Icon as={Trophy} color="yellow.fg" boxSize="14px" />
          <Text>
            <Text as="span" fontWeight="semibold" color="green.fg">
              {leaderName}
            </Text>{" "}
            <Text as="span" fontWeight="medium">
              {leaderWins}
            </Text>
            <Text as="span" color="fg.muted">
              {" "}
              – {otherWins} {otherName}
              {counts.tie ? ` · ${counts.tie} ties` : ""} · {total} verdicts
            </Text>
          </Text>
        </HStack>
      )}

      <Text fontSize="xs" color="fg.muted">
        ${totalCost.toFixed(4)}
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

      <Tooltip content="Download per-row verdicts as CSV">
        <Button size="xs" variant="ghost" onClick={onExport}>
          <Icon as={Download} boxSize="14px" />
          CSV
        </Button>
      </Tooltip>
    </HStack>
  );
}
