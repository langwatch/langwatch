import { Text } from "@chakra-ui/react";
import type { CellContext } from "@tanstack/react-table";
import { Tooltip } from "~/components/ui/tooltip";
import type { ScenarioRunRow } from "../types";

/**
 * Formats a timestamp to a relative time string (e.g., "2 hours ago")
 */
function formatRelativeTime(timestamp: number): string {
  if (!timestamp) return "-";

  const now = Date.now();
  const diff = now - timestamp;

  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  if (days > 0) {
    return days === 1 ? "1 day ago" : `${days} days ago`;
  }
  if (hours > 0) {
    return hours === 1 ? "1 hour ago" : `${hours} hours ago`;
  }
  if (minutes > 0) {
    return minutes === 1 ? "1 minute ago" : `${minutes} minutes ago`;
  }
  return "Just now";
}

/**
 * Formats a timestamp to a full date string for tooltip
 */
function formatFullDate(timestamp: number): string {
  if (!timestamp) return "-";

  return new Intl.DateTimeFormat("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

export function TimestampCell({
  getValue,
}: CellContext<ScenarioRunRow, unknown>) {
  const timestamp = getValue() as number;

  return (
    <Tooltip content={formatFullDate(timestamp)}>
      <Text fontSize="sm" cursor="help">
        {formatRelativeTime(timestamp)}
      </Text>
    </Tooltip>
  );
}
