/**
 * ConfusionMatrixChart - compact judge-vs-reviewer agreement card.
 *
 * Sibling of WinRateChart in the same metrics row. Unlike WinRateChart
 * (which compares candidates against each other), this compares a single
 * pass/fail evaluator's own verdict against an independent ground truth (a
 * human reviewer's annotation on the same target output), so the card answers
 * "is this judge trustworthy", not "which variant is best".
 *
 * The compact card can't show the full matrix + derived metrics + row
 * drill-down, so the expand button opens the full view in a drawer
 * (specs/experiments/judge-annotation-confusion-matrix.feature).
 */
import { Box, Grid, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { useMemo } from "react";
import { LuMaximize2 } from "react-icons/lu";

import { useDrawer } from "~/hooks/useDrawer";
import type { JudgeAnnotationCoverage } from "./buildJudgeAnnotationPairs";
import {
  QUADRANT_LABELS,
  QUADRANT_SHORT_LABELS,
  type Quadrant,
} from "./ConfusionMatrixGrid";
import {
  type ConfusionMatrixMetrics,
  computeConfusionMatrix,
  kappaAgreementLabel,
} from "./computeConfusionMatrix";
import { ERROR_CELL_BG, formatCellShare } from "./confusionMatrixDisplay";
import type { BatchResultRow } from "./types";

export type ConfusionMatrixChartProps = {
  evaluatorId: string;
  evaluatorName: string;
  targetId: string;
  /** Names the target this card scores, so sibling cards are tellable apart. */
  targetName: string;
  coverage: JudgeAnnotationCoverage;
  rows: BatchResultRow[];
  /** Matched to the sibling cost/latency/win-rate charts in ComparisonCharts. */
  chartHeight: number;
};

/**
 * Accuracy with kappa alongside it.
 *
 * Carried on the card, not buried in the drawer: accuracy alone cannot
 * distinguish a judge that agrees from one that just matches the base rate,
 * so a near-chance kappa is flagged right where the accuracy is read.
 */
function AccuracyHeadline({
  metrics,
  scoredRows,
  totalRows,
  runRows,
  truncated,
}: {
  metrics: ConfusionMatrixMetrics;
  /**
   * Rows the accuracy above rests on. Deliberately not `coverage.annotatedRows`,
   * which also counts the rows reviewers conflicted on: those are annotated but
   * unscoreable, so they belong in the drawer's coverage line and not in the
   * denominator of a figure computed without them.
   */
  scoredRows: number;
  totalRows: number;
  runRows: number;
  truncated?: boolean;
}) {
  const { cohensKappa } = metrics;
  /** Below this, agreement is barely distinguishable from guessing. */
  const isNearChance = cohensKappa !== null && cohensKappa < 0.2;

  return (
    <HStack justify="space-between" align="baseline">
      <HStack gap={2} align="baseline">
        <Text fontSize="2xl" fontWeight="bold" lineHeight="1">
          {Math.round(metrics.accuracy * 100)}%
        </Text>
        <Text
          fontSize="xs"
          fontWeight="semibold"
          color={isNearChance ? "orange.fg" : "fg.muted"}
          title={
            cohensKappa === null
              ? "Cohen's kappa is undefined here: one label was used throughout"
              : `Cohen's kappa ${cohensKappa.toFixed(2)}, ${kappaAgreementLabel(
                  cohensKappa,
                )} agreement once chance is subtracted`
          }
        >
          κ {cohensKappa === null ? "—" : cohensKappa.toFixed(2)}
        </Text>
      </HStack>
      {/* When the lookup was capped, `totalRows` is the slice that was
          checked, not the whole run, so the card says "checked" and the
          tooltip carries the run's own size. The card can only fit one
          figure, so it shows the strictest one and the drawer expands it. */}
      <Text
        fontSize="2xs"
        color="fg.muted"
        title={
          truncated
            ? `${scoredRows} scored of the ${totalRows} rows checked, out of ${runRows} in the run`
            : `${scoredRows} scored of ${totalRows} rows`
        }
      >
        accuracy · {scoredRows} of {totalRows} rows
        {truncated ? " checked" : ""}
      </Text>
    </HStack>
  );
}

/**
 * The four counts, each named in the reader's own terms.
 *
 * The compact card has no axis labels to read a quadrant's meaning off, so
 * every cell says what it is. Spelled out rather than initialled: "FP" saves a
 * few pixels and costs a guess, and the guess is usually wrong for anyone who
 * does not already think in confusion matrices. The share sits on its own line
 * so the name has the full cell width, and the tooltip carries the formal name
 * for readers who do want it.
 */
function MiniMatrix({
  metrics,
  height,
}: {
  metrics: ConfusionMatrixMetrics;
  height: number;
}) {
  const cells: { quadrant: Quadrant; isError: boolean }[] = [
    { quadrant: "truePositive", isError: false },
    { quadrant: "falsePositive", isError: true },
    { quadrant: "falseNegative", isError: true },
    { quadrant: "trueNegative", isError: false },
  ];

  return (
    <Grid templateColumns="1fr 1fr" gap={1} height={`${height}px`}>
      {cells.map((cell) => {
        const value = metrics[cell.quadrant];
        return (
          <Box
            key={cell.quadrant}
            borderRadius="sm"
            display="flex"
            flexDirection="column"
            justifyContent="center"
            alignItems="center"
            textAlign="center"
            paddingX={1}
            bg={cell.isError ? ERROR_CELL_BG : "bg.muted"}
            title={QUADRANT_LABELS[cell.quadrant]}
          >
            <Text fontSize="md" fontWeight="bold" lineHeight="1.1">
              {value}
            </Text>
            <Text fontSize="2xs" color="fg.muted" lineHeight="1.2">
              {QUADRANT_SHORT_LABELS[cell.quadrant]}
            </Text>
            <Text fontSize="2xs" color="fg.muted" lineHeight="1.2">
              {formatCellShare({ value, total: metrics.total })}
            </Text>
          </Box>
        );
      })}
    </Grid>
  );
}

export function ConfusionMatrixChart({
  evaluatorId,
  evaluatorName,
  targetId,
  targetName,
  coverage,
  rows,
  chartHeight,
}: ConfusionMatrixChartProps) {
  const { openDrawer } = useDrawer();
  // Memoised to match the drawer: several of these cards share one metrics
  // row that re-renders on unrelated chart state.
  const metrics = useMemo(
    () => computeConfusionMatrix(coverage.pairs),
    [coverage.pairs],
  );

  const onExpand = () => {
    // Passed straight through openDrawer's own props (not a preceding
    // setComplexProps call): openDrawer's updateDrawerUrl recomputes
    // complexProps from whatever props it receives and would clobber a
    // prior setComplexProps call.
    openDrawer("confusionMatrix", {
      evaluatorId,
      evaluatorName,
      targetId,
      targetName,
      coverage,
      rows,
    });
  };

  return (
    <Box
      minWidth="280px"
      width="280px"
      flexShrink={0}
      bg="bg.subtle"
      border="1px solid"
      borderColor="border"
      borderRadius="md"
      padding={3}
      paddingBottom={2}
      data-testid={`chart-confusion-${evaluatorId}`}
      role="group"
    >
      <HStack justify="space-between" marginBottom={2}>
        {/* Carries the target name, matching this card's entry in the
            metrics menu: the same judge scores every target, so a card
            titled by the evaluator alone is indistinguishable from its
            siblings. */}
        <Text
          fontSize="xs"
          fontWeight="medium"
          lineClamp={1}
          title={`${evaluatorName} vs reviewers on ${targetName}`}
        >
          {evaluatorName} vs reviewers on {targetName}
        </Text>
        {/* Always visible, just quiet. Revealing this only on hover made the
            one route into the full matrix invisible until you happened to
            mouse over the card, and unreachable altogether by keyboard or on
            a touch screen, where there is no hover at all. Subdued by default,
            full strength on hover or keyboard focus. */}
        <IconButton
          aria-label="Expand confusion matrix"
          size="2xs"
          variant="ghost"
          opacity={0.55}
          _groupHover={{ opacity: 1 }}
          _focusVisible={{ opacity: 1 }}
          transition="opacity 0.15s"
          onClick={onExpand}
        >
          <LuMaximize2 size={12} />
        </IconButton>
      </HStack>
      <VStack align="stretch" gap={2}>
        <AccuracyHeadline
          metrics={metrics}
          scoredRows={coverage.pairs.length}
          totalRows={coverage.totalRows}
          runRows={coverage.runRows}
          truncated={coverage.truncated}
        />
        <MiniMatrix metrics={metrics} height={Math.max(chartHeight - 46, 60)} />
      </VStack>
    </Box>
  );
}
