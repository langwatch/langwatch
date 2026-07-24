/**
 * ConfusionMatrixDrawer - full judge-vs-reviewer agreement view.
 *
 * Design choices are backed by competitive + academic research (see
 * specs/experiments/judge-annotation-confusion-matrix.feature and
 * project memory): raw counts + percentage together (not normalized-only —
 * a dominant cell can inflate accuracy and hide real error rates), domain
 * labels instead of ML jargon ("Judge: Pass/Fail" x "Reviewer: 👍/👎" — the
 * single highest-leverage, empirically validated change for non-expert
 * comprehension per CMU's CSCW 2020 study), semantic agree/disagree color
 * (neutral for correct cells, flagged for the two error cells) rather than
 * a magnitude heatmap, and every cell clickable through to its rows.
 *
 * Opened from ConfusionMatrixChart's expand affordance. Data (pairs, rows,
 * coverage) is passed via drawer complexProps rather than refetched — same
 * pattern as ComparisonLeaderboardDrawer.
 */
import { Box, Grid, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";

import {
  computeConfusionMatrix,
  kappaAgreementLabel,
  type ConfidenceInterval,
  type JudgeAnnotationPair,
} from "./batch-evaluation-results/computeConfusionMatrix";
import type { JudgeAnnotationCoverage } from "./batch-evaluation-results/buildJudgeAnnotationPairs";
import type { BatchResultRow } from "./batch-evaluation-results/types";
import { useDrawer } from "~/hooks/useDrawer";
import { formatTargetOutput } from "~/utils/formatTargetOutput";
import { Drawer } from "./ui/drawer";

export type ConfusionMatrixDrawerProps = {
  evaluatorId: string;
  evaluatorName: string;
  targetId: string;
  /** Names the target this view scores, for the header. */
  targetName?: string;
  coverage: JudgeAnnotationCoverage;
  rows: BatchResultRow[];
};

type Quadrant = "truePositive" | "falsePositive" | "falseNegative" | "trueNegative";

const QUADRANT_LABELS: Record<Quadrant, string> = {
  truePositive: "True Positive — judge said Pass, reviewer said 👍",
  falsePositive: "False Positive — judge said Pass, reviewer said 👎",
  falseNegative: "False Negative — judge said Fail, reviewer said 👍",
  trueNegative: "True Negative — judge said Fail, reviewer said 👎",
};

/**
 * Width of the 95% accuracy interval beyond which the sample cannot
 * separate a good judge from a bad one.
 *
 * Deliberately a property of the interval rather than a row count. A raw
 * "fewer than N rows" floor is both arbitrary and unreachable here — the
 * chart already refuses to mount below its own minimum — whereas the
 * interval answers the question actually being asked: is this enough
 * evidence to act on? Thirty points is roughly the span at which the
 * plausible range still covers both "clearly working" and "barely better
 * than chance".
 */
const UNINFORMATIVE_INTERVAL_WIDTH = 0.3;

// Module-level so the "no data" path hands the same array identity to every
// useMemo on every render — a fresh `[]` here cascades through the memo chain
// and re-renders the subtree for nothing.
const EMPTY_PAIRS: JudgeAnnotationPair[] = [];
const EMPTY_ROWS: BatchResultRow[] = [];

const formatPercent = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

export function ConfusionMatrixDrawer({
  evaluatorName,
  targetName,
  targetId,
  coverage,
  rows,
}: ConfusionMatrixDrawerProps) {
  const { closeDrawer } = useDrawer();
  const [selectedQuadrant, setSelectedQuadrant] = useState<Quadrant | null>(
    null,
  );

  // This drawer is URL-routed, so `?drawer.open=confusionMatrix&...` survives
  // a reload or a pasted link — but pairs/rows/coverage travel in
  // complexProps, a module-level store that does not. On that path the props
  // arrive undefined, so normalise here and explain the situation below
  // rather than throwing inside computeConfusionMatrix.
  const hasData =
    !!coverage && Array.isArray(coverage.pairs) && Array.isArray(rows);
  const safePairs = hasData ? coverage.pairs : EMPTY_PAIRS;
  const safeRows = hasData ? rows : EMPTY_ROWS;

  const metrics = useMemo(
    () => computeConfusionMatrix(safePairs),
    [safePairs],
  );
  const total = Math.max(1, metrics.total);

  const isUninformative =
    metrics.accuracyInterval !== null &&
    metrics.accuracyInterval.upper - metrics.accuracyInterval.lower >
      UNINFORMATIVE_INTERVAL_WIDTH;

  const rowsByIndex = useMemo(
    () => new Map(safeRows.map((row) => [row.index, row])),
    [safeRows],
  );

  const quadrantPairs = useMemo(() => {
    if (!selectedQuadrant) return EMPTY_PAIRS;
    return safePairs.filter((pair) => {
      if (selectedQuadrant === "truePositive") return pair.predicted && pair.actual;
      if (selectedQuadrant === "falsePositive") return pair.predicted && !pair.actual;
      if (selectedQuadrant === "falseNegative") return !pair.predicted && pair.actual;
      return !pair.predicted && !pair.actual;
    });
  }, [selectedQuadrant, safePairs]);

  return (
    <Drawer.Root open={true} placement="end" size="lg" onOpenChange={closeDrawer}>
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Text fontWeight="semibold" fontSize="lg">
            {evaluatorName ?? "Judge"} vs reviewers
            {targetName ? ` — ${targetName}` : ""}
          </Text>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        {!hasData ? (
          <Drawer.Body>
            <Box bg="bg.muted" borderRadius="md" padding={4}>
              <Text fontSize="sm" fontWeight="semibold" marginBottom={1}>
                Nothing to show yet
              </Text>
              <Text fontSize="xs" color="fg.muted">
                This view is built from the run currently loaded on the results
                page, so it cannot be restored from a link on its own. Open the
                agreement chart from the results page and expand it again.
              </Text>
            </Box>
          </Drawer.Body>
        ) : (
        <Drawer.Body>
          <VStack align="stretch" gap={5} paddingBottom={6}>
            <Box>
              <Text fontSize="sm" fontWeight="semibold">
                Confusion matrix
              </Text>
              <Text fontSize="xs" color="fg.muted">
                {coverage.annotatedRows} of {coverage.totalRows} rows annotated
                {coverage.conflictingRows > 0
                  ? `; ${coverage.conflictingRows} row${
                      coverage.conflictingRows === 1 ? "" : "s"
                    } excluded for conflicting reviewer annotations`
                  : ""}
              </Text>
              {/* The sharpest limitation of this chart, and the one no
                  confidence interval can fix. Reviewers annotate what catches
                  their eye, so the annotated set skews toward rows that
                  already looked wrong. Every figure below describes THAT set,
                  not the run — say so rather than letting the statistics imply
                  a rigour the sample doesn't have. */}
              <Text fontSize="xs" color="fg.muted" marginTop={1}>
                Figures describe the annotated rows only. If those were picked
                by browsing for problems rather than sampled at random, they
                will not reflect the full run.
              </Text>
            </Box>

            {isUninformative ? (
              <Box bg="orange.subtle" borderRadius="md" padding={3}>
                <Text fontSize="xs" color="orange.fg">
                  Not enough annotated rows to judge this yet — accuracy
                  could plausibly be anywhere from{" "}
                  {formatPercent(metrics.accuracyInterval!.lower)} to{" "}
                  {formatPercent(metrics.accuracyInterval!.upper)}. Annotate
                  more rows to narrow that range.
                </Text>
              </Box>
            ) : null}

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
              <Box
                padding={2}
                textAlign="center"
                fontSize="xs"
                fontWeight="semibold"
                bg="bg.muted"
              >
                Reviewer: 👍
              </Box>
              <Box
                padding={2}
                textAlign="center"
                fontSize="xs"
                fontWeight="semibold"
                bg="bg.muted"
              >
                Reviewer: 👎
              </Box>

              <Box
                padding={2}
                fontSize="xs"
                fontWeight="semibold"
                bg="bg.muted"
                display="flex"
                alignItems="center"
              >
                Judge: Pass
              </Box>
              <MatrixCell
                label="True Positive"
                value={metrics.truePositive}
                total={total}
                isError={false}
                selected={selectedQuadrant === "truePositive"}
                onClick={() => setSelectedQuadrant("truePositive")}
              />
              <MatrixCell
                label="False Positive"
                value={metrics.falsePositive}
                total={total}
                isError={true}
                selected={selectedQuadrant === "falsePositive"}
                onClick={() => setSelectedQuadrant("falsePositive")}
              />

              <Box
                padding={2}
                fontSize="xs"
                fontWeight="semibold"
                bg="bg.muted"
                display="flex"
                alignItems="center"
              >
                Judge: Fail
              </Box>
              <MatrixCell
                label="False Negative"
                value={metrics.falseNegative}
                total={total}
                isError={true}
                selected={selectedQuadrant === "falseNegative"}
                onClick={() => setSelectedQuadrant("falseNegative")}
              />
              <MatrixCell
                label="True Negative"
                value={metrics.trueNegative}
                total={total}
                isError={false}
                selected={selectedQuadrant === "trueNegative"}
                onClick={() => setSelectedQuadrant("trueNegative")}
              />
            </Grid>

            <HStack gap={10} align="start" flexWrap="wrap">
              <VStack gap={0} align="start">
                <Text fontSize="3xl" fontWeight="bold" lineHeight="1.1">
                  {formatPercent(metrics.accuracy)}
                </Text>
                <Text fontSize="xs" fontWeight="semibold">
                  Accuracy
                </Text>
                <Text fontSize="2xs" color="fg.muted">
                  {metrics.accuracyInterval
                    ? `95% CI ${formatPercent(
                        metrics.accuracyInterval.lower,
                      )}–${formatPercent(metrics.accuracyInterval.upper)}`
                    : "—"}
                </Text>
              </VStack>

              <VStack gap={0} align="start">
                <Text fontSize="3xl" fontWeight="bold" lineHeight="1.1">
                  {metrics.cohensKappa === null
                    ? "—"
                    : metrics.cohensKappa.toFixed(2)}
                </Text>
                <Text fontSize="xs" fontWeight="semibold">
                  Cohen&apos;s κ
                </Text>
                <Text fontSize="2xs" color="fg.muted">
                  {metrics.cohensKappa === null
                    ? "undefined — one label used throughout"
                    : `${kappaAgreementLabel(metrics.cohensKappa)} agreement`}
                </Text>
              </VStack>
            </HStack>

            <AgreementBar
              accuracy={metrics.accuracy}
              interval={metrics.accuracyInterval}
              chance={metrics.chanceAgreement}
            />

            <HStack gap={6} flexWrap="wrap">
              <Metric label="Precision" value={formatPercent(metrics.precision)} />
              <Metric label="Recall" value={formatPercent(metrics.recall)} />
              <Metric label="F1" value={formatPercent(metrics.f1)} />
              <Metric
                label="False Positive Rate"
                value={formatPercent(metrics.falsePositiveRate)}
              />
              <Metric
                label="Reviewer pass rate"
                value={formatPercent(metrics.prevalence)}
              />
            </HStack>

            {selectedQuadrant ? (
              <Box
                borderWidth="1px"
                borderColor="border.muted"
                borderRadius="md"
                padding={3}
              >
                <Text fontWeight="semibold" fontSize="sm" marginBottom={2}>
                  {QUADRANT_LABELS[selectedQuadrant]} ({quadrantPairs.length}{" "}
                  row{quadrantPairs.length === 1 ? "" : "s"})
                </Text>
                {quadrantPairs.length === 0 ? (
                  <Text fontSize="xs" color="fg.muted">
                    No rows in this cell.
                  </Text>
                ) : (
                  <VStack align="stretch" gap={2}>
                    {quadrantPairs.map(({ rowIndex, comment }) => {
                      const row = rowsByIndex.get(rowIndex);
                      const target = row?.targets[targetId];
                      // Same formatter the results table uses, so a row reads
                      // identically here and there — it unwraps the common
                      // single-"output"-key envelope instead of dumping raw
                      // JSON with escaped newlines at the reader.
                      const outputText =
                        formatTargetOutput(target?.output) || "(no output)";
                      return (
                        <Box key={rowIndex}>
                          <Text fontSize="xs" color="fg.muted">
                            Row {rowIndex + 1}
                          </Text>
                          <Text fontSize="sm" lineClamp={3}>
                            {outputText}
                          </Text>
                          {/* On a disagreement cell this is the whole point of
                              drilling in — the reviewer already wrote down why
                              the judge was wrong. */}
                          {comment ? (
                            <Text
                              fontSize="xs"
                              color="fg.muted"
                              marginTop={1}
                              borderInlineStartWidth="2px"
                              borderColor="border.emphasized"
                              paddingInlineStart={2}
                            >
                              Reviewer: {comment}
                            </Text>
                          ) : null}
                        </Box>
                      );
                    })}
                  </VStack>
                )}
              </Box>
            ) : null}
          </VStack>
        </Drawer.Body>
        )}
      </Drawer.Content>
    </Drawer.Root>
  );
}

/**
 * Plots accuracy against the agreement chance alone would have produced.
 *
 * This is the visual form of the kappa argument. A judge scoring 90% on a
 * set that is 90% passes has done nothing, and a bare "90%" hides that
 * completely — here the shaded floor swallows the marker and the point is
 * immediate. The confidence band is drawn at the same scale so a thin
 * sample reads as a wide, hesitant smear rather than a crisp number.
 */
function AgreementBar({
  accuracy,
  interval,
  chance,
}: {
  accuracy: number;
  interval: ConfidenceInterval | null;
  chance: number | null;
}) {
  const asWidth = (value: number) => `${Math.min(100, value * 100)}%`;
  const clearsChance = chance !== null && accuracy > chance;

  return (
    <Box>
      <HStack justify="space-between" marginBottom={1.5}>
        <Text fontSize="xs" fontWeight="semibold">
          Is this better than chance?
        </Text>
        {chance !== null ? (
          <Text
            fontSize="2xs"
            fontWeight="semibold"
            color={clearsChance ? "green.fg" : "orange.fg"}
          >
            {clearsChance
              ? `+${Math.round((accuracy - chance) * 100)} pts over chance`
              : "at or below chance"}
          </Text>
        ) : null}
      </HStack>

      <Box
        position="relative"
        height="30px"
        bg="bg.muted"
        borderRadius="sm"
        borderWidth="1px"
        borderColor="border"
        overflow="hidden"
      >
        {/* Everything left of this line is free — a judge gets it for
            nothing by matching the base rate. */}
        {chance !== null ? (
          <Box
            position="absolute"
            insetStart={0}
            top={0}
            bottom={0}
            width={asWidth(chance)}
            bg="bg.emphasized"
          />
        ) : null}

        {/* Plausible range for the true accuracy, not just the point estimate. */}
        {interval ? (
          <Box
            position="absolute"
            top="7px"
            bottom="7px"
            insetStart={asWidth(interval.lower)}
            width={asWidth(interval.upper - interval.lower)}
            bg="blue.muted"
            borderRadius="sm"
          />
        ) : null}

        {chance !== null ? (
          <Box
            position="absolute"
            top={0}
            bottom={0}
            insetStart={asWidth(chance)}
            width="2px"
            bg="border.emphasized"
          />
        ) : null}

        <Box
          position="absolute"
          top={0}
          bottom={0}
          insetStart={asWidth(accuracy)}
          width="3px"
          bg="blue.solid"
        />
      </Box>

      <HStack justify="space-between" marginTop={1}>
        <Text fontSize="2xs" color="fg.muted">
          0%
        </Text>
        <Text fontSize="2xs" color="fg.muted">
          chance {formatPercent(chance)} · observed {formatPercent(accuracy)}
        </Text>
        <Text fontSize="2xs" color="fg.muted">
          100%
        </Text>
      </HStack>
    </Box>
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
    <Box
      as="button"
      onClick={onClick}
      padding={3}
      textAlign="center"
      bg={isError ? "red.subtle" : "bg"}
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
    </Box>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <VStack gap={0} align="start">
      <Text fontSize="lg" fontWeight="bold">
        {value}
      </Text>
      <Text fontSize="2xs" color="fg.muted">
        {label}
      </Text>
    </VStack>
  );
}
