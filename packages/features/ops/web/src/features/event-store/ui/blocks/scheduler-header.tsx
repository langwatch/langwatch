import { Badge, HStack, Text } from "@chakra-ui/react";
import { formatTimeAgo } from "../../../../model/ops-formatters";
import type { SchedulerHeaderCounts } from "../../model/scheduler-presentation";

/**
 * What needs attention, and whether the calendar loop itself is the problem.
 *
 * A stalled loop is a property of the SCHEDULER, not of any row, so it belongs
 * here rather than being inferred by reading every timestamp on the page.
 */
export function SchedulerHeader({
  counts,
  loopHealthy,
  lastFiredAt,
}: {
  counts: SchedulerHeaderCounts;
  loopHealthy: boolean;
  lastFiredAt: number | null;
}) {
  return (
    <HStack gap={4} paddingBottom={3} data-testid="scheduler-header">
      {!loopHealthy && (
        <Badge colorPalette="red" variant="solid">
          Scheduler behind
        </Badge>
      )}
      {counts.overdue > 0 && (
        <Badge colorPalette="red" variant="subtle">
          {counts.overdue} overdue
        </Badge>
      )}
      {counts.failing > 0 && (
        <Badge colorPalette="orange" variant="subtle">
          {counts.failing} failing
        </Badge>
      )}
      {counts.overdue === 0 && counts.failing === 0 && loopHealthy && (
        <Badge colorPalette="green" variant="subtle">
          On schedule
        </Badge>
      )}
      <Text textStyle="xs" color="fg.muted">
        {counts.dueWithinHour} due in the next hour · {counts.active} active · {counts.paused}{" "}
        paused
      </Text>
      <Text textStyle="xs" color="fg.muted">
        {lastFiredAt === null
          ? "nothing has fired yet"
          : `last fired ${formatTimeAgo(lastFiredAt)}`}
      </Text>
    </HStack>
  );
}
