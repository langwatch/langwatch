import { Badge, HStack, Text } from "@chakra-ui/react";
import { formatDurationMs } from "~/components/ops/shared/formatters";
import type { SchedulerJobStatus } from "./schedulerStatus";

const PRESENTATION: Record<
  SchedulerJobStatus,
  { label: string; palette: string }
> = {
  overdue: { label: "Overdue", palette: "red" },
  retrying: { label: "Retrying", palette: "orange" },
  running: { label: "Running", palette: "blue" },
  scheduled: { label: "Scheduled", palette: "gray" },
  paused: { label: "Paused", palette: "gray" },
};

/**
 * One column for what were three (In progress, Retries, Last error).
 *
 * Those three were mostly em-dashes, and the one case that mattered — a
 * schedule failing and retrying — was split across two of them. The lateness
 * and the failure detail ride along here, where the state already is.
 */
export function SchedulerStatusBadge({
  status,
  latenessMs,
  attempts,
  lastError,
}: {
  status: SchedulerJobStatus;
  latenessMs: number;
  attempts: number;
  lastError: string | null;
}) {
  const { label, palette } = PRESENTATION[status];

  return (
    <HStack gap={2}>
      <Badge
        colorPalette={palette}
        variant={status === "overdue" ? "solid" : "subtle"}
        data-testid="scheduler-status-badge"
      >
        {label}
      </Badge>
      {status === "overdue" && (
        <Text textStyle="xs" color="red.500">
          {formatDurationMs(latenessMs)} late
        </Text>
      )}
      {attempts > 0 && (
        <Text
          textStyle="xs"
          color="fg.muted"
          title={lastError ?? undefined}
          truncate
          maxWidth="220px"
        >
          {attempts} {attempts === 1 ? "attempt" : "attempts"}
          {lastError ? ` · ${lastError}` : ""}
        </Text>
      )}
    </HStack>
  );
}
