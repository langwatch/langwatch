import { Text } from "@chakra-ui/react";
import type { CellContext } from "@tanstack/react-table";
import type { ScenarioRunRow } from "../types";

/**
 * Formats duration in milliseconds to a human-readable string
 */
function formatDuration(ms: number): string {
  if (ms === 0) return "-";

  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(1)}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) {
    return `${minutes}m ${remainingSeconds.toFixed(0)}s`;
  }

  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m`;
}

export function DurationCell({
  getValue,
}: CellContext<ScenarioRunRow, unknown>) {
  const durationMs = getValue() as number;

  return (
    <Text fontSize="xs" fontFamily="mono">
      {formatDuration(durationMs)}
    </Text>
  );
}
