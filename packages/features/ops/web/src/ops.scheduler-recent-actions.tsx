import { Box, HStack, Text } from "@chakra-ui/react";
import type { SchedulerAuditEntryView } from "@langwatch/ops-contract";
import { formatTimeAgo } from "./formatters";

const ACTION_LABELS: Record<string, string> = {
  "ops.scheduler.pause": "paused",
  "ops.scheduler.resume": "resumed",
  "ops.scheduler.clear_slot": "cleared a stuck slot on",
  "ops.scheduler.run_now": "ran",
};

/**
 * What operators have done here recently.
 *
 * These controls are cross-tenant and can send a customer-facing artifact out
 * of band, so "why did this run at 03:14" needs an answer on the screen that
 * caused it — not only in a log search somebody has to know to run.
 */
export function SchedulerRecentActions({
  entries,
  now = Date.now(),
}: {
  entries: SchedulerAuditEntryView[];
  now?: number;
}) {
  if (entries.length === 0) return null;

  return (
    <Box paddingTop={5} data-testid="scheduler-recent-actions">
      <Text textStyle="xs" fontWeight="medium" color="fg.muted" paddingBottom={2}>
        Recent operator actions
      </Text>
      {entries.map((entry) => (
        <HStack key={entry.id} gap={2} paddingY={0.5}>
          <Text textStyle="xs" color="fg.muted" minWidth="60px">
            {formatTimeAgo(new Date(entry.at).getTime(), now)}
          </Text>
          <Text textStyle="xs">
            {entry.actor ?? "An operator"} {ACTION_LABELS[entry.action] ?? entry.action}{" "}
            <Text as="span" fontFamily="mono">
              {entry.scheduleId}
            </Text>
          </Text>
        </HStack>
      ))}
    </Box>
  );
}
