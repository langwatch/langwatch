/**
 * ConfusionMatrixDrawer - full judge-vs-reviewer agreement view.
 *
 * Design choices are backed by competitive + academic research (see
 * specs/experiments/judge-annotation-confusion-matrix.feature and
 * project memory): raw counts + percentage together (not normalized-only —
 * a dominant cell can inflate accuracy and hide real error rates), domain
 * labels instead of ML jargon, semantic agree/disagree color rather than a
 * magnitude heatmap, and every cell clickable through to its rows. The
 * matrix itself and the statistics beside it live in ConfusionMatrixGrid
 * and ConfusionMatrixStats; this file is the layout that arranges them.
 *
 * Opened from ConfusionMatrixChart's expand affordance. Data (pairs, rows,
 * coverage) is passed via drawer complexProps rather than refetched — same
 * pattern as ComparisonLeaderboardDrawer.
 */
import { Box, HStack, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import { formatTargetOutput } from "~/utils/formatTargetOutput";
import type { JudgeAnnotationCoverage } from "./batch-evaluation-results/buildJudgeAnnotationPairs";
import {
  ConfusionMatrixGrid,
  QUADRANT_LABELS,
  type Quadrant,
} from "./batch-evaluation-results/ConfusionMatrixGrid";
import {
  AgreementBar,
  Metric,
} from "./batch-evaluation-results/ConfusionMatrixStats";
import {
  computeConfusionMatrix,
  type JudgeAnnotationPair,
  kappaAgreementLabel,
} from "./batch-evaluation-results/computeConfusionMatrix";
import { formatPercent } from "./batch-evaluation-results/confusionMatrixDisplay";
import type { BatchResultRow } from "./batch-evaluation-results/types";
import { Drawer } from "./ui/drawer";

export type ConfusionMatrixDrawerProps = {
  evaluatorId: string;
  evaluatorName: string;
  targetId: string;
  /** Names the target this view scores, for the header. */
  targetName?: string;
  /**
   * Optional because this drawer is URL-routed: `?drawer.open=confusionMatrix`
   * survives a reload or a pasted link, while complexProps — a module-level
   * store — does not. On that path these arrive undefined, so the type has to
   * say so rather than letting consumers assume data is present.
   */
  coverage?: JudgeAnnotationCoverage;
  rows?: BatchResultRow[];
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

  const hasData =
    !!coverage && Array.isArray(coverage.pairs) && Array.isArray(rows);
  const safePairs = hasData ? coverage.pairs : EMPTY_PAIRS;
  const safeRows = hasData ? rows! : EMPTY_ROWS;

  const metrics = useMemo(() => computeConfusionMatrix(safePairs), [safePairs]);

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
      if (selectedQuadrant === "truePositive")
        return pair.predicted && pair.actual;
      if (selectedQuadrant === "falsePositive")
        return pair.predicted && !pair.actual;
      if (selectedQuadrant === "falseNegative")
        return !pair.predicted && pair.actual;
      return !pair.predicted && !pair.actual;
    });
  }, [selectedQuadrant, safePairs]);

  // Two ways to end up with nothing to draw, and they need different
  // explanations: complexProps did not survive a reload, or the run genuinely
  // has no resolved judge/reviewer pair. Rendering a 2x2 of "0 · 0%" for
  // either would present the absence of a measurement as a measurement.
  const emptyExplanation = !hasData
    ? "This view is built from the run currently loaded on the results page, so it cannot be restored from a link on its own. Open the agreement chart from the results page and expand it again."
    : metrics.total === 0
      ? "No row has both a resolved judge verdict and an agreed reviewer annotation, so there is nothing to compare yet. Annotate a few rows this evaluator scored and reopen this view."
      : null;

  return (
    <Drawer.Root
      open={true}
      placement="end"
      size="lg"
      onOpenChange={closeDrawer}
    >
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Text fontWeight="semibold" fontSize="lg">
            {evaluatorName ?? "Judge"} vs reviewers
            {targetName ? ` — ${targetName}` : ""}
          </Text>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          {emptyExplanation ? (
            <Box bg="bg.muted" borderRadius="md" padding={4}>
              <Text fontSize="sm" fontWeight="semibold" marginBottom={1}>
                Nothing to show yet
              </Text>
              <Text fontSize="xs" color="fg.muted">
                {emptyExplanation}
              </Text>
            </Box>
          ) : (
            <VStack align="stretch" gap={5} paddingBottom={6}>
              <Box>
                <Text fontSize="sm" fontWeight="semibold">
                  Confusion matrix
                </Text>
                <Text fontSize="xs" color="fg.muted">
                  {/* When the lookup was capped, `totalRows` is the slice that
                      was checked rather than the whole run — say "of the rows
                      checked" so the numerator keeps meaning "annotated". */}
                  {coverage!.annotatedRows} of{" "}
                  {coverage!.truncated
                    ? `the ${coverage!.totalRows} rows checked are annotated`
                    : `${coverage!.totalRows} rows annotated`}
                  {coverage!.conflictingRows > 0
                    ? `; ${coverage!.conflictingRows} row${
                        coverage!.conflictingRows === 1 ? "" : "s"
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
                    Not enough annotated rows to judge this yet — accuracy could
                    plausibly be anywhere from{" "}
                    {formatPercent(metrics.accuracyInterval!.lower)} to{" "}
                    {formatPercent(metrics.accuracyInterval!.upper)}. Annotate
                    more rows to narrow that range.
                  </Text>
                </Box>
              ) : null}

              <ConfusionMatrixGrid
                counts={metrics}
                total={metrics.total}
                selectedQuadrant={selectedQuadrant}
                onSelectQuadrant={setSelectedQuadrant}
              />

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
                <Metric
                  label="Precision"
                  value={formatPercent(metrics.precision)}
                />
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
          )}
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
