import type { Tokens } from "@chakra-ui/react";
import {
  SPAN_TYPE_COLORS as portableSpanTypeColors,
  STATUS_COLORS as portableStatusColors,
  formatAbsoluteTime,
  formatBytes,
  formatCost,
  formatDayOfWeek,
  formatDuration,
  formatISOTimestamp,
  formatLocalWithZone,
  formatRelativeTime,
  formatRelativeTimeAgo,
  formatTokens,
  formatVerboseRelative,
  formatWallClock,
  hashColor as portableHashColor,
  resolveViewerTimeZone,
  truncateId,
} from "@langwatch/trace-web";

export {
  formatAbsoluteTime,
  formatBytes,
  formatCost,
  formatDayOfWeek,
  formatDuration,
  formatISOTimestamp,
  formatLocalWithZone,
  formatRelativeTime,
  formatRelativeTimeAgo,
  formatTokens,
  formatVerboseRelative,
  formatWallClock,
  resolveViewerTimeZone,
  truncateId,
};

export const SPAN_TYPE_COLORS: Readonly<Record<string, Tokens["colors"]>> =
  portableSpanTypeColors;
export const STATUS_COLORS: Readonly<Record<string, Tokens["colors"]>> =
  portableStatusColors;
export const hashColor: (value: string) => Tokens["colors"] = portableHashColor;
