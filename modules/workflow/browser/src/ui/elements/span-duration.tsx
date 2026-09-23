import { HStack, Text } from "@chakra-ui/react";
import { formatMilliseconds } from "@langwatch/design-system/format-milliseconds";
import { Tooltip } from "@langwatch/design-system/tooltip";
import { Temporal, toDate } from "@langwatch/time";
import { Clock } from "react-feather";

const RED_AFTER_MS = 30 * 1000;
const YELLOW_AFTER_MS = 10 * 1000;

function durationColor(duration: number): string {
  if (duration > RED_AFTER_MS) return "red";
  if (duration > YELLOW_AFTER_MS) return "yellow.600";
  return "green";
}

/** How long an execution ran, coloured as the trace explorer colours a span. */
export const SpanDuration = ({
  span,
}: {
  span: {
    error?: unknown;
    timestamps: { started_at: number; finished_at: number };
  };
}) => {
  const startedAt = span.timestamps.started_at;
  const finishedAt = span.timestamps.finished_at;
  const duration = finishedAt - startedAt;

  return (
    <Tooltip
      content={
        <>
          Started at: {toDate(Temporal.Instant.fromEpochMilliseconds(startedAt)).toLocaleString()}
          <br />
          Finished at: {toDate(Temporal.Instant.fromEpochMilliseconds(finishedAt)).toLocaleString()}
        </>
      }
    >
      <HStack gap={"6px"} color={span.error ? "red" : durationColor(duration)}>
        <Clock width={12} />
        <Text>{formatMilliseconds(duration)}</Text>
      </HStack>
    </Tooltip>
  );
};
