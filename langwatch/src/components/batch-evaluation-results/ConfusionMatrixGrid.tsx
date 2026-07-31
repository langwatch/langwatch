/**
 * ConfusionMatrixGrid - the labeled 2x2 table itself.
 *
 * Domain labels instead of ML jargon ("Judge: Pass/Fail" x "Reviewer: 👍/👎")
 * are the single highest-leverage, empirically validated change for
 * non-expert comprehension (CMU, CSCW 2020). Raw counts and percentage sit
 * together rather than normalized-only, because a dominant cell can inflate
 * accuracy and hide the real error rates. Every cell is a button through to
 * its own rows.
 */
import { Box, chakra, Grid, Text } from "@chakra-ui/react";

import type { ConfusionMatrixCounts } from "./computeConfusionMatrix";
import { ERROR_CELL_BG } from "./confusionMatrixDisplay";

export type Quadrant = keyof ConfusionMatrixCounts;

export const QUADRANT_LABELS: Record<Quadrant, string> = {
  truePositive: "True Positive — judge said Pass, reviewer said 👍",
  falsePositive: "False Positive — judge said Pass, reviewer said 👎",
  falseNegative: "False Negative — judge said Fail, reviewer said 👍",
  trueNegative: "True Negative — judge said Fail, reviewer said 👎",
};

const CELLS: { quadrant: Quadrant; label: string; isError: boolean }[] = [
  { quadrant: "truePositive", label: "True Positive", isError: false },
  { quadrant: "falsePositive", label: "False Positive", isError: true },
  { quadrant: "falseNegative", label: "False Negative", isError: true },
  { quadrant: "trueNegative", label: "True Negative", isError: false },
];

const AxisLabel = ({ children }: { children: React.ReactNode }) => (
  <Box
    padding={2}
    textAlign="center"
    fontSize="xs"
    fontWeight="semibold"
    bg="bg.muted"
  >
    {children}
  </Box>
);

const RowLabel = ({ children }: { children: React.ReactNode }) => (
  <Box
    padding={2}
    fontSize="xs"
    fontWeight="semibold"
    bg="bg.muted"
    display="flex"
    alignItems="center"
  >
    {children}
  </Box>
);

export function ConfusionMatrixGrid({
  counts,
  total,
  selectedQuadrant,
  onSelectQuadrant,
}: {
  counts: ConfusionMatrixCounts;
  /** Denominator for the per-cell share. Always positive — callers render an
   * empty state rather than a matrix when there are no rows at all. */
  total: number;
  selectedQuadrant: Quadrant | null;
  onSelectQuadrant: (quadrant: Quadrant) => void;
}) {
  const cellFor = (quadrant: Quadrant) => {
    const cell = CELLS.find((candidate) => candidate.quadrant === quadrant)!;
    return (
      <MatrixCell
        label={cell.label}
        value={counts[quadrant]}
        total={total}
        isError={cell.isError}
        selected={selectedQuadrant === quadrant}
        onClick={() => onSelectQuadrant(quadrant)}
      />
    );
  };

  return (
    <Grid
      templateColumns="auto 1fr 1fr"
      gap="1px"
      bg="border"
      borderWidth="1px"
      borderColor="border"
      borderRadius="md"
      overflow="hidden"
    >
      <Box bg="bg" />
      <AxisLabel>Reviewer: 👍</AxisLabel>
      <AxisLabel>Reviewer: 👎</AxisLabel>

      <RowLabel>Judge: Pass</RowLabel>
      {cellFor("truePositive")}
      {cellFor("falsePositive")}

      <RowLabel>Judge: Fail</RowLabel>
      {cellFor("falseNegative")}
      {cellFor("trueNegative")}
    </Grid>
  );
}

function MatrixCell({
  label,
  value,
  total,
  isError,
  selected,
  onClick,
}: {
  label: string;
  value: number;
  total: number;
  isError: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <chakra.button
      type="button"
      onClick={onClick}
      padding={3}
      textAlign="center"
      bg={isError ? ERROR_CELL_BG : "bg"}
      cursor="pointer"
      outline={selected ? "2px solid" : "none"}
      outlineColor="border.emphasized"
      outlineOffset="-2px"
    >
      <Text fontSize="xl" fontWeight="bold">
        {value}
      </Text>
      <Text fontSize="2xs" color="fg.muted">
        {label} · {Math.round((value / total) * 100)}%
      </Text>
    </chakra.button>
  );
}
