/**
 * ConfusionMatrixDrawer - full judge-vs-reviewer agreement view.
 *
 * Design choices are backed by competitive + academic research (see
 * specs/experiments/judge-annotation-confusion-matrix.feature and
 * project memory): raw counts + percentage together (not normalized-only,
 * since a dominant cell can inflate accuracy and hide real error rates),
 * domain labels instead of ML jargon, semantic agree/disagree color rather
 * than a magnitude heatmap, and every cell clickable through to its rows. The
 * matrix itself and the statistics beside it live in ConfusionMatrixGrid
 * and ConfusionMatrixStats; this file is the layout that arranges them.
 *
 * Opened from ConfusionMatrixChart's expand affordance. Data (pairs, rows,
 * coverage) is passed via drawer complexProps rather than refetched, the same
 * pattern as ComparisonLeaderboardDrawer.
 */
import { Box, Text, VStack } from "@chakra-ui/react";
import { useMemo, useState } from "react";
import { useDrawer } from "~/hooks/useDrawer";
import type { JudgeAnnotationCoverage } from "./batch-evaluation-results/buildJudgeAnnotationPairs";
import { ConfusionMatrixDrillDown } from "./batch-evaluation-results/ConfusionMatrixDrillDown";
import {
  ConfusionMatrixGrid,
  type Quadrant,
} from "./batch-evaluation-results/ConfusionMatrixGrid";
import {
  AgreementBar,
  CoverageNote,
  HeadlineMetrics,
  SecondaryMetrics,
} from "./batch-evaluation-results/ConfusionMatrixStats";
import {
  type ConfidenceInterval,
  computeConfusionMatrix,
  type JudgeAnnotationPair,
  quadrantOf,
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
   * survives a reload or a pasted link, while complexProps (a module-level
   * store) does not. On that path these arrive undefined, so the type has to
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
 * "fewer than N rows" floor is both arbitrary and unreachable here, since the
 * chart already refuses to mount below its own minimum, whereas the interval
 * answers the question actually being asked: is this enough evidence to act
 * on? Thirty points is roughly the span at which the plausible range still
 * covers both "clearly working" and "barely better than chance".
 */
const UNINFORMATIVE_INTERVAL_WIDTH = 0.3;

// Module-level so the "no data" path hands the same array identity to every
// useMemo on every render. A fresh `[]` here cascades through the memo chain
// and re-renders the subtree for nothing.
const EMPTY_PAIRS: JudgeAnnotationPair[] = [];
const EMPTY_ROWS: BatchResultRow[] = [];

/**
 * Two ways to end up with nothing to draw, and they need different
 * explanations: complexProps did not survive a reload, or the run genuinely
 * has no resolved judge/reviewer pair. Rendering a 2x2 of "0 · 0%" for either
 * would present the absence of a measurement as a measurement.
 */
const RESTORED_WITHOUT_DATA =
  "This view is built from the run currently loaded on the results page, so it cannot be restored from a link on its own. Open the agreement chart from the results page and expand it again.";
const NOTHING_COMPARABLE =
  "No row has both a resolved judge verdict and an agreed reviewer annotation, so there is nothing to compare yet. Annotate a few rows this evaluator scored and reopen this view.";

function NothingToShow({ explanation }: { explanation: string }) {
  return (
    <Box bg="bg.muted" borderRadius="md" padding={4}>
      <Text fontSize="sm" fontWeight="semibold" marginBottom={1}>
        Nothing to show yet
      </Text>
      <Text fontSize="xs" color="fg.muted">
        {explanation}
      </Text>
    </Box>
  );
}

/**
 * Fires on the WIDTH of the interval, not a row count: the chart already
 * refuses to mount below its own row floor, so a count-based warning could
 * never fire.
 */
function UninformativeSampleWarning({
  interval,
}: {
  interval: ConfidenceInterval | null;
}) {
  if (!interval) return null;
  if (interval.upper - interval.lower <= UNINFORMATIVE_INTERVAL_WIDTH) {
    return null;
  }

  return (
    <Box bg="orange.subtle" borderRadius="md" padding={3}>
      <Text fontSize="xs" color="orange.fg">
        Not enough annotated rows to judge this yet. Accuracy could plausibly be
        anywhere from {formatPercent(interval.lower)} to{" "}
        {formatPercent(interval.upper)}. Annotate more rows to narrow that
        range.
      </Text>
    </Box>
  );
}

/**
 * The report itself. Split from the drawer shell so the shell stays a frame
 * and this stays the thing being framed.
 */
function AgreementReport({
  coverage,
  rows,
  targetId,
}: {
  coverage?: JudgeAnnotationCoverage;
  rows?: BatchResultRow[];
  targetId: string;
}) {
  const [selectedQuadrant, setSelectedQuadrant] = useState<Quadrant | null>(
    null,
  );

  const hasData = !!coverage && Array.isArray(coverage.pairs) && !!rows;
  const pairs = hasData ? coverage.pairs : EMPTY_PAIRS;
  const resultRows = hasData ? rows : EMPTY_ROWS;

  const metrics = useMemo(() => computeConfusionMatrix(pairs), [pairs]);

  const rowsByIndex = useMemo(
    () => new Map(resultRows.map((row) => [row.index, row])),
    [resultRows],
  );

  const quadrantPairs = useMemo(
    () => pairs.filter((pair) => quadrantOf(pair) === selectedQuadrant),
    [selectedQuadrant, pairs],
  );

  if (!hasData) return <NothingToShow explanation={RESTORED_WITHOUT_DATA} />;
  if (metrics.total === 0) {
    return <NothingToShow explanation={NOTHING_COMPARABLE} />;
  }

  return (
    <VStack align="stretch" gap={5} paddingBottom={6}>
      <CoverageNote coverage={coverage} />

      <UninformativeSampleWarning interval={metrics.accuracyInterval} />

      <ConfusionMatrixGrid
        counts={metrics}
        total={metrics.total}
        selectedQuadrant={selectedQuadrant}
        onSelectQuadrant={setSelectedQuadrant}
      />

      <HeadlineMetrics metrics={metrics} />

      <AgreementBar
        accuracy={metrics.accuracy}
        interval={metrics.accuracyInterval}
        chance={metrics.chanceAgreement}
      />

      <SecondaryMetrics metrics={metrics} />

      {selectedQuadrant ? (
        <ConfusionMatrixDrillDown
          quadrant={selectedQuadrant}
          pairs={quadrantPairs}
          rowsByIndex={rowsByIndex}
          targetId={targetId}
        />
      ) : null}
    </VStack>
  );
}

export function ConfusionMatrixDrawer({
  evaluatorName,
  targetName,
  targetId,
  coverage,
  rows,
}: ConfusionMatrixDrawerProps) {
  const { closeDrawer } = useDrawer();

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
            {targetName ? ` on ${targetName}` : ""}
          </Text>
          <Drawer.CloseTrigger />
        </Drawer.Header>
        <Drawer.Body>
          <AgreementReport
            coverage={coverage}
            rows={rows}
            targetId={targetId}
          />
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
  );
}
