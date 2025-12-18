import { Badge } from "@chakra-ui/react";
import type { CellContext } from "@tanstack/react-table";

type StatusColorScheme = "green" | "red" | "yellow" | "gray" | "blue";

interface StatusConfig {
  colorScheme: StatusColorScheme;
  label?: string;
}

const DEFAULT_STATUS_MAP: Record<string, StatusConfig> = {
  SUCCESS: { colorScheme: "green", label: "Success" },
  PASSED: { colorScheme: "green", label: "Passed" },
  PASS: { colorScheme: "green", label: "Pass" },
  FAILED: { colorScheme: "red", label: "Failed" },
  FAIL: { colorScheme: "red", label: "Fail" },
  ERROR: { colorScheme: "red", label: "Error" },
  PENDING: { colorScheme: "yellow", label: "Pending" },
  RUNNING: { colorScheme: "blue", label: "Running" },
  SKIPPED: { colorScheme: "gray", label: "Skipped" },
  UNKNOWN: { colorScheme: "gray", label: "Unknown" },
};

interface StatusBadgeCellProps<T> {
  info: CellContext<T, unknown>;
  statusMap?: Record<string, StatusConfig>;
}

/**
 * Cell renderer that displays a colored badge based on status value
 */
export function StatusBadgeCell<T>({
  info,
  statusMap = DEFAULT_STATUS_MAP,
}: StatusBadgeCellProps<T>) {
  const value = info.getValue();
  const status = typeof value === "string" ? value.toUpperCase() : "UNKNOWN";
  const config = statusMap[status] ?? { colorScheme: "gray" as const };

  return (
    <Badge colorPalette={config.colorScheme} variant="subtle">
      {config.label ?? status}
    </Badge>
  );
}
