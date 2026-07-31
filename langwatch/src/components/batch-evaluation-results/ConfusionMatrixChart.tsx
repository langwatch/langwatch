/**
 * ConfusionMatrixChart - compact judge-vs-reviewer agreement card.
 *
 * Sibling of WinRateChart in the same metrics row. Unlike WinRateChart
 * (which compares candidates against each other), this compares a single
 * pass/fail evaluator's own verdict against an independent ground truth —
 * a human reviewer's annotation on the same target output — so the card
 * answers "is this judge trustworthy", not "which variant is best".
 *
 * The compact card can't show the full matrix + derived metrics + row
 * drill-down — the expand button opens the full view in a drawer
 * (specs/experiments/judge-annotation-confusion-matrix.feature).
 */
import { Box, Grid, HStack, IconButton, Text, VStack } from "@chakra-ui/react";
import { LuMaximize2 } from "react-icons/lu";

import { useDrawer } from "~/hooks/useDrawer";
import type { JudgeAnnotationCoverage } from "./buildJudgeAnnotationPairs";
import {
  computeConfusionMatrix,
  kappaAgreementLabel,
} from "./computeConfusionMatrix";
import { ERROR_CELL_BG } from "./confusionMatrixDisplay";
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
  const pairs = coverage.pairs;
  const metrics = computeConfusionMatrix(pairs);
  const total = Math.max(1, metrics.total);

  /** Below this, agreement is barely distinguishable from guessing. */
  const isNearChance =
    metrics.cohensKappa !== null && metrics.cohensKappa < 0.2;

  const cells = [
    { key: "tp", label: "TP", value: metrics.truePositive, isError: false },
    { key: "fp", label: "FP", value: metrics.falsePositive, isError: true },
    { key: "fn", label: "FN", value: metrics.falseNegative, isError: true },
    { key: "tn", label: "TN", value: metrics.trueNegative, isError: false },
  ];

  const onExpand = () => {
    // Passed straight through openDrawer's own props (not a preceding
    // setComplexProps call) — see feedback_drawer_complexprops_ordering:
    // openDrawer's updateDrawerUrl recomputes complexProps from whatever
    // props it receives and would clobber a prior setComplexProps call.
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
        <Text
          fontSize="xs"
          fontWeight="medium"
          lineClamp={1}
          title={`${evaluatorName} — agreement with reviewers`}
        >
          {evaluatorName} — agreement with reviewers
        </Text>
        {/* Always visible, just quiet. Revealing this only on hover made the
            one route into the full matrix invisible until you happened to
            mouse over the card — and unreachable altogether by keyboard or on
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
        <HStack justify="space-between" align="baseline">
          <HStack gap={2} align="baseline">
            <Text fontSize="2xl" fontWeight="bold" lineHeight="1">
              {Math.round(metrics.accuracy * 100)}%
            </Text>
            {/* Carried on the card, not buried in the drawer: accuracy alone
                cannot distinguish a judge that agrees from one that just
                matches the base rate, so a near-chance kappa is flagged
                right where the accuracy is read. */}
            <Text
              fontSize="xs"
              fontWeight="semibold"
              color={isNearChance ? "orange.fg" : "fg.muted"}
              title={
                metrics.cohensKappa === null
                  ? "Cohen's kappa is undefined here — one label was used throughout"
                  : `Cohen's kappa ${metrics.cohensKappa.toFixed(
                      2,
                    )} — ${kappaAgreementLabel(
                      metrics.cohensKappa,
                    )} agreement once chance is subtracted`
              }
            >
              κ{" "}
              {metrics.cohensKappa === null
                ? "—"
                : metrics.cohensKappa.toFixed(2)}
            </Text>
          </HStack>
          <Text fontSize="2xs" color="fg.muted">
            accuracy · {pairs.length} of {coverage.totalRows} rows
          </Text>
        </HStack>
        <Grid
          templateColumns="1fr 1fr"
          gap={1}
          height={`${Math.max(chartHeight - 46, 60)}px`}
        >
          {cells.map((c) => (
            <Box
              key={c.key}
              borderRadius="sm"
              display="flex"
              flexDirection="column"
              justifyContent="center"
              alignItems="center"
              bg={c.isError ? ERROR_CELL_BG : "bg.muted"}
            >
              <Text fontSize="md" fontWeight="bold">
                {c.value}
              </Text>
              <Text fontSize="2xs" color="fg.muted">
                {c.label} · {Math.round((c.value / total) * 100)}%
              </Text>
            </Box>
          ))}
        </Grid>
      </VStack>
    </Box>
  );
}
