import { EmptyValue } from "@langwatch/design-system/empty-value";
import { MeterBar } from "@langwatch/design-system/meter-bar";
import { Box, HStack, Spinner, Text, VStack } from "@langwatch/design-system/primitives";

import type { CellProgress } from "../../../model/experiments/experiment-list-metrics.ts";
import {
  RUN_STATUS_LABELS,
  type RunStatus,
} from "../../../model/experiments/experiment-list-row.ts";

const DOT = { completed: "green.solid", stopped: "orange.solid" } as const;

/**
 * The latest run's state: a coloured dot and Finished or Stopped, a spinner and Running. A running
 * run says how many cells are done when the runs say so.
 */
export function ExperimentRunStatus({
  status,
  progress,
}: {
  status: RunStatus;
  progress?: CellProgress;
}) {
  if (status === "none") return <EmptyValue label="Never run" />;
  return (
    <VStack align="start" gap={1} minWidth={0}>
      <HStack gap={1.5}>
        {status === "running" ? (
          <Spinner size="xs" color="blue.fg" />
        ) : (
          <Box boxSize="8px" borderRadius="full" bg={DOT[status]} flexShrink={0} aria-hidden />
        )}
        <Text textStyle="bodySm" fontWeight="medium">
          {RUN_STATUS_LABELS[status]}
        </Text>
      </HStack>
      {progress && (
        <>
          <Text textStyle="caption" color="fg.muted" fontVariantNumeric="tabular-nums">
            {progress.done.toLocaleString("en-US")} of {progress.total.toLocaleString("en-US")}{" "}
            cells
          </Text>
          {status === "running" && (
            <MeterBar
              fillRatio={progress.done / progress.total}
              width="120px"
              height="4px"
              fillColor="blue.solid"
            />
          )}
        </>
      )}
    </VStack>
  );
}
