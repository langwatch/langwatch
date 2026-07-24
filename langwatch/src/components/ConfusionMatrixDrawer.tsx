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
  type JudgeAnnotationPair,
} from "./batch-evaluation-results/computeConfusionMatrix";
import type { BatchResultRow } from "./batch-evaluation-results/types";
import { useDrawer } from "~/hooks/useDrawer";
import { Drawer } from "./ui/drawer";

export type ConfusionMatrixDrawerProps = {
  evaluatorId: string;
  evaluatorName: string;
  targetId: string;
  pairs: JudgeAnnotationPair[];
  coverage: {
    totalRows: number;
    annotatedRows: number;
    conflictingRows: number;
  };
  rows: BatchResultRow[];
};

type Quadrant = "truePositive" | "falsePositive" | "falseNegative" | "trueNegative";

const QUADRANT_LABELS: Record<Quadrant, string> = {
  truePositive: "True Positive — judge said Pass, reviewer said 👍",
  falsePositive: "False Positive — judge said Pass, reviewer said 👎",
  falseNegative: "False Negative — judge said Fail, reviewer said 👍",
  trueNegative: "True Negative — judge said Fail, reviewer said 👎",
};

/** Sample-size floor below which a 2x2 table is two anecdotes, not a matrix. */
const LOW_SAMPLE_FLOOR = 5;

const formatPercent = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value * 100)}%`;

export function ConfusionMatrixDrawer({
  evaluatorName,
  targetId,
  pairs,
  coverage,
  rows,
}: ConfusionMatrixDrawerProps) {
  const { closeDrawer } = useDrawer();
  const [selectedQuadrant, setSelectedQuadrant] = useState<Quadrant | null>(
    null,
  );

  const metrics = useMemo(() => computeConfusionMatrix(pairs), [pairs]);
  const total = Math.max(1, metrics.total);

  const rowsByIndex = useMemo(
    () => new Map(rows.map((row) => [row.index, row])),
    [rows],
  );

  const quadrantPairs = useMemo(() => {
    if (!selectedQuadrant) return [];
    return pairs.filter((pair) => {
      if (selectedQuadrant === "truePositive") return pair.predicted && pair.actual;
      if (selectedQuadrant === "falsePositive") return pair.predicted && !pair.actual;
      if (selectedQuadrant === "falseNegative") return !pair.predicted && pair.actual;
      return !pair.predicted && !pair.actual;
    });
  }, [selectedQuadrant, pairs]);

  return (
    <Drawer.Root open={true} placement="end" size="lg" onOpenChange={closeDrawer}>
      <Drawer.Content bg="bg">
        <Drawer.Header>
          <Text fontWeight="semibold" fontSize="lg">
            {evaluatorName} — agreement with reviewers
          </Text>
          <Drawer.CloseTrigger />
        </Drawer.Header>
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
            </Box>

            {metrics.total < LOW_SAMPLE_FLOOR ? (
              <Box bg="orange.subtle" borderRadius="md" padding={3}>
                <Text fontSize="xs" color="orange.fg">
                  Sample size low — fewer than {LOW_SAMPLE_FLOOR} annotated
                  rows. Agreement may not be representative.
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

            <HStack gap={6} flexWrap="wrap">
              <Metric label="Accuracy" value={formatPercent(metrics.accuracy)} />
              <Metric label="Precision" value={formatPercent(metrics.precision)} />
              <Metric label="Recall" value={formatPercent(metrics.recall)} />
              <Metric label="F1" value={formatPercent(metrics.f1)} />
              <Metric
                label="False Positive Rate"
                value={formatPercent(metrics.falsePositiveRate)}
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
                    {quadrantPairs.map(({ rowIndex }) => {
                      const row = rowsByIndex.get(rowIndex);
                      const target = row?.targets[targetId];
                      const output = target?.output;
                      const outputText =
                        typeof output === "string"
                          ? output
                          : output
                            ? JSON.stringify(output)
                            : "(no output)";
                      return (
                        <Box key={rowIndex}>
                          <Text fontSize="xs" color="fg.muted">
                            Row {rowIndex + 1}
                          </Text>
                          <Text fontSize="sm" lineClamp={3}>
                            {outputText}
                          </Text>
                        </Box>
                      );
                    })}
                  </VStack>
                )}
              </Box>
            ) : null}
          </VStack>
        </Drawer.Body>
      </Drawer.Content>
    </Drawer.Root>
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
      bg={isError ? "rgba(239, 68, 68, 0.14)" : "bg"}
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
