import chalk from "chalk";

/**
 * Strips ANSI escape codes from a string for accurate length calculation.
 */
export const stripAnsi = (str: string): string => {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, "");
};

export type ColumnColorMap = Record<string, (value: string) => string>;

/**
 * Prints a formatted table to stdout with column-aligned headers, separator,
 * and optional per-column color functions.
 *
 * Columns not in the colorMap default to chalk.gray.
 */
export const formatTable = ({
  data,
  headers,
  colorMap = {},
  emptyMessage = "No data found",
}: {
  data: Array<Record<string, string>>;
  headers: string[];
  colorMap?: ColumnColorMap;
  emptyMessage?: string;
}): void => {
  if (data.length === 0) {
    console.log(chalk.gray(emptyMessage));
    return;
  }

  const colWidths: Record<string, number> = {};
  headers.forEach((header) => {
    colWidths[header] = Math.max(
      header.length,
      ...data.map((row) => stripAnsi(row[header] ?? "").length),
    );
  });

  const headerRow = headers
    .map((header) => chalk.bold(header.padEnd(colWidths[header]!)))
    .join("  ");
  console.log(headerRow);

  const separator = headers
    .map((header) => "─".repeat(colWidths[header]!))
    .join("  ");
  console.log(chalk.gray(separator));

  data.forEach((row) => {
    const dataRow = headers
      .map((header) => {
        const value = row[header] ?? "";
        const strippedLength = stripAnsi(value).length;
        const paddingNeeded = colWidths[header]! - strippedLength;
        const paddedValue = value + " ".repeat(Math.max(0, paddingNeeded));

        const colorFn = colorMap[header] ?? chalk.gray;
        return colorFn(paddedValue);
      })
      .join("  ");
    console.log(dataRow);
  });
};

/**
 * Formats a date string as a human-readable relative time (e.g. "3d ago").
 *
 * Returns "—" for invalid dates. Clamps future dates to "just now".
 */
export const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "—";

  const now = new Date();
  const diffMs = Math.max(0, now.getTime() - date.getTime());

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  const months = Math.floor(days / 30);
  const years = Math.floor(days / 365);

  if (years > 0) return `${years}y ago`;
  if (months > 0) return `${months}mo ago`;
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return seconds === 0 ? "just now" : `${seconds}s ago`;
};
