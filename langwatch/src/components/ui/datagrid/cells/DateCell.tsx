import { Text } from "@chakra-ui/react";
import { formatDistanceToNow, format } from "date-fns";
import type { CellContext } from "@tanstack/react-table";

interface DateCellProps<T> {
  info: CellContext<T, unknown>;
  /** Display format: 'relative' shows "2 hours ago", 'absolute' shows full date */
  displayFormat?: "relative" | "absolute";
  /** Date format string for absolute display (date-fns format) */
  dateFormat?: string;
}

/**
 * Cell renderer that displays a formatted date/timestamp
 */
export function DateCell<T>({
  info,
  displayFormat = "relative",
  dateFormat = "MMM d, yyyy HH:mm",
}: DateCellProps<T>) {
  const value = info.getValue();

  if (value === null || value === undefined) {
    return <Text color="gray.500">-</Text>;
  }

  const timestamp =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Date.parse(value)
        : null;

  if (timestamp === null || Number.isNaN(timestamp)) {
    return <Text color="gray.500">Invalid date</Text>;
  }

  const date = new Date(timestamp);

  if (displayFormat === "relative") {
    return (
      <Text title={format(date, dateFormat)}>
        {formatDistanceToNow(date, { addSuffix: true })}
      </Text>
    );
  }

  return <Text>{format(date, dateFormat)}</Text>;
}
