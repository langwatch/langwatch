/**
 * BatchSummaryFooter - Footer showing aggregate statistics and progress
 *
 * Adapted from BatchEvaluationV2EvaluationSummary with cleaner styling.
 */

import {
  Box,
  Button,
  HStack,
  Progress,
  Separator,
  Spacer,
  Text,
  VStack,
} from "@chakra-ui/react";
import numeral from "numeral";
import { useEffect, useMemo, useState } from "react";
import { formatCost, formatLatency } from "~/components/shared/formatters";
import { Tooltip } from "~/components/ui/tooltip";
import type { BatchRunSummary } from "./BatchRunsSidebar";

type BatchSummaryFooterProps = {
  /** Run summary data */
  run: BatchRunSummary;
  /** Whether to show progress bar */
  showProgress?: boolean;
  /** Callback when stop button is clicked */
  onStop?: () => void;
};

/**
 * Check if a run is finished
 */
const getFinishedAt = (
  timestamps: BatchRunSummary["timestamps"],
  currentTimestamp: number,
): number | undefined => {
  if (timestamps.finished_at) {
    return timestamps.finished_at;
  }
  // Consider finished if no updates for 2 minutes
  // (We don't have updated_at in our type, so just check finished_at/stopped_at)
  if (timestamps.stopped_at) {
    return timestamps.stopped_at;
  }
  return undefined;
};

/**
 * Format evaluation summary for display
 */
const formatEvalSummary = (evaluation: {
  averageScore?: number | null;
  averagePassed?: number | null;
}): string => {
  if (
    evaluation.averagePassed !== undefined &&
    evaluation.averagePassed !== null
  ) {
    const pct = numeral(evaluation.averagePassed).format("0.[0]%");
    const scoreNote =
      evaluation.averageScore !== undefined &&
      evaluation.averageScore !== null &&
      evaluation.averageScore !== evaluation.averagePassed
        ? ` (${numeral(evaluation.averageScore).format("0.0[0]")} avg)`
        : "";
    return `${pct} pass${scoreNote}`;
  }
  if (
    evaluation.averageScore !== undefined &&
    evaluation.averageScore !== null
  ) {
    return numeral(evaluation.averageScore).format("0.[00]");
  }
  return "-";
};

export function BatchSummaryFooter({
  run,
  showProgress = false,
  onStop,
}: BatchSummaryFooterProps) {
  const [currentTimestamp, setCurrentTimestamp] = useState(Date.now());

  const finishedAt = useMemo(
    () => getFinishedAt(run.timestamps, currentTimestamp),
    [run.timestamps, currentTimestamp],
  );

  const runtime = Math.max(
    run.timestamps.created_at
      ? (finishedAt ?? currentTimestamp) - run.timestamps.created_at
      : 0,
    0,
  );

  // Update timestamp every second while running
  useEffect(() => {
    if (finishedAt) return;

    const interval = setInterval(() => {
      setCurrentTimestamp(Date.now());
    }, 1000);

    return () => clearInterval(interval);
  }, [finishedAt]);

  const totalCost =
    (run.summary.datasetCost ?? 0) + (run.summary.evaluationsCost ?? 0);
  const progress = run.progress ?? 0;
  const total = run.total ?? 0;
  const progressPct = total > 0 ? (progress / total) * 100 : 0;

  return (
    <VStack
      width="full"
      background="white"
      gap={0}
      position="sticky"
      left={0}
      bottom={0}
      borderTop="1px solid"
      borderColor="gray.200"
      overflowX="auto"
      overflowY="hidden"
      flexShrink={0}
    >
      <HStack width="100%" paddingY={4} paddingX={6} gap={5}>
        {/* Evaluation summaries */}
        {Object.entries(run.summary.evaluations).map(([id, evaluation]) => (
          <HStack key={id} gap={5}>
            <VStack align="start" gap={1}>
              <Text fontWeight="500" fontSize="14px" lineClamp={2}>
                {evaluation.name}
              </Text>
              <Text fontSize="14px">{formatEvalSummary(evaluation)}</Text>
            </VStack>
            <Separator orientation="vertical" height="48px" />
          </HStack>
        ))}

        {/* Total Cost */}
        <VStack align="start" gap={1}>
          <Text fontWeight="500" fontSize="14px">
            Total Cost
          </Text>
          <Tooltip
            content={
              <VStack align="start" gap={0}>
                <Text fontSize="12px">
                  Target cost: {formatCost(run.summary.datasetCost ?? null)}
                </Text>
                <Text fontSize="12px">
                  Evaluation cost:{" "}
                  {formatCost(run.summary.evaluationsCost ?? null)}
                </Text>
              </VStack>
            }
            positioning={{ placement: "top" }}
          >
            <Text fontSize="14px">{formatCost(totalCost)}</Text>
          </Tooltip>
        </VStack>
        <Separator orientation="vertical" height="48px" />

        {/* Runtime */}
        <VStack align="start" gap={1}>
          <Text fontWeight="500" fontSize="14px">
            Runtime
          </Text>
          <Text fontSize="14px">
            {numeral(runtime / 1000).format("00:00:00")}
          </Text>
        </VStack>

        {/* Stopped indicator */}
        {run.timestamps.stopped_at && (
          <>
            <Spacer />
            <HStack>
              <Box
                width="12px"
                height="12px"
                background="red.500"
                borderRadius="full"
              />
              <Text>Stopped</Text>
            </HStack>
          </>
        )}
      </HStack>

      {/* Progress bar */}
      {showProgress && !finishedAt && (
        <HStack
          width="full"
          padding={3}
          borderTop="1px solid"
          borderColor="gray.200"
          gap={2}
        >
          <Text whiteSpace="nowrap" marginTop="-1px" paddingX={2}>
            Running
          </Text>
          <Box flex={1}>
            <Progress.Root value={progressPct} size="sm" colorPalette="blue">
              <Progress.Track>
                <Progress.Range />
              </Progress.Track>
            </Progress.Root>
          </Box>
          <Text fontSize="12px" color="gray.500" whiteSpace="nowrap">
            {progress}/{total}
          </Text>
          {onStop && (
            <Button
              colorPalette="red"
              size="sm"
              onClick={onStop}
              marginLeft={2}
            >
              Stop
            </Button>
          )}
        </HStack>
      )}
    </VStack>
  );
}
