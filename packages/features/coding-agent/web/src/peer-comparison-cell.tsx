import { Box, Text, VStack } from "@chakra-ui/react";
import type React from "react";

import { Tooltip } from "@langwatch/design-system/tooltip";

/**
 * A number with a thin bar underneath saying how it compares to the other rows
 * on the page, in the same voice as the trace list's latency columns.
 *
 * The bar carries ONE signal, and only one: where this row sits among its
 * visible peers. It scales to the p95 of the column's own values, fills
 * completely and turns red at or past that mark, and is drawn in blue below
 * it. The value above it is a number like any other in its column, in the
 * column's own color; anything more a value has to say is said on hover.
 *
 * Spec: specs/coding-agent/pull-request-linkage.feature.
 */

const BAR_WIDTH = "48px";
const BAR_HEIGHT = "3px";

function ComparisonBar({
  value,
  p95,
  hasStats,
}: {
  value: number;
  p95: number;
  hasStats: boolean;
}) {
  if (!hasStats || value <= 0) {
    return (
      <Box
        width={BAR_WIDTH}
        height={BAR_HEIGHT}
        bg="border.subtle"
        borderRadius="full"
      />
    );
  }
  const ratio = value / p95;
  const isOverP95 = ratio >= 1;
  return (
    <Box
      width={BAR_WIDTH}
      height={BAR_HEIGHT}
      bg="border.subtle"
      borderRadius="full"
      display="flex"
      justifyContent="flex-end"
    >
      {/* Right-anchored fill: the numeric columns are right-aligned, so the
          bar connects to the value above it instead of floating left. */}
      <Box
        height="full"
        width={`${Math.min(ratio, 1) * 100}%`}
        bg={isOverP95 ? "red.fg" : "blue.fg"}
        borderRadius="full"
        data-over-p95={isOverP95 ? "true" : undefined}
      />
    </Box>
  );
}

/**
 * The sentence the bar's tooltip carries. Phrased as a percentage of the p95
 * because "30% of the page's p95" reads more naturally than "0.3x p95".
 * Returns null when there is nothing to compare against.
 */
export function peerComparisonSentence({
  value,
  p95,
  hasStats,
  formatValue,
  metricPhrase,
}: {
  value: number;
  p95: number;
  hasStats: boolean;
  formatValue: (value: number) => string;
  metricPhrase: string;
}): string | null {
  if (!hasStats || value <= 0) return null;
  const pct = (value / p95) * 100;
  const pctText = pct >= 100 ? pct.toFixed(0) : pct.toFixed(1);
  return `${formatValue(value)} ${metricPhrase} · that's ${pctText}% of the p95 of the visible pull requests on this page (${formatValue(p95)})`;
}

export interface PeerComparisonCellProps {
  value: number;
  p95: number;
  hasStats: boolean;
  formatValue: (value: number) => string;
  /** Phrase placed right after the value in the tooltip, e.g. "total tokens". */
  metricPhrase: string;
  /** Replaces the plain sentence when the value has more to explain. */
  tooltipContent?: React.ReactNode;
}

export const PeerComparisonCell: React.FC<PeerComparisonCellProps> = ({
  value,
  p95,
  hasStats,
  formatValue,
  metricPhrase,
  tooltipContent,
}) => {
  const sentence = peerComparisonSentence({
    value,
    p95,
    hasStats,
    formatValue,
    metricPhrase,
  });
  const content = tooltipContent ?? sentence;

  const body = (
    <VStack
      gap={1}
      align="end"
      width="full"
      cursor={content ? "help" : "auto"}
      // A tab stop only where there is something behind it: the comparison is
      // the only place this row's standing against its peers is written down,
      // so it cannot be reachable by pointer alone. The tooltip opens on focus
      // as well as hover and points its trigger at the content it opened.
      tabIndex={content ? 0 : undefined}
    >
      <Text fontSize="sm">{formatValue(value)}</Text>
      <ComparisonBar value={value} p95={p95} hasStats={hasStats} />
    </VStack>
  );

  if (!content) return body;
  return (
    <Tooltip content={content} positioning={{ placement: "left" }}>
      {body}
    </Tooltip>
  );
};
