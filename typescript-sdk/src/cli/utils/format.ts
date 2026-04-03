import chalk from "chalk";

// Helper to strip ANSI codes for length calculation
export const stripAnsi = (str: string): string => {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\u001b\[[0-9;]*m/g, "");
};

// Simple table formatting helper
export const formatTable = (
  data: Array<Record<string, string>>,
  headers: string[],
  colorMap?: Record<string, (s: string) => string>,
): void => {
  if (data.length === 0) {
    return;
  }

  // Calculate column widths (strip ANSI codes for accurate length calculation)
  const colWidths: Record<string, number> = {};
  headers.forEach((header) => {
    colWidths[header] = Math.max(
      header.length,
      ...data.map((row) => stripAnsi(row[header] ?? "").length),
    );
  });

  // Print header
  const headerRow = headers
    .map((header) => chalk.bold(header.padEnd(colWidths[header]!)))
    .join("  ");
  console.log(headerRow);

  // Print separator
  const separator = headers
    .map((header) => "─".repeat(colWidths[header]!))
    .join("  ");
  console.log(chalk.gray(separator));

  // Print data rows
  data.forEach((row) => {
    const dataRow = headers
      .map((header) => {
        const value = row[header] ?? "";
        const strippedLength = stripAnsi(value).length;
        const paddingNeeded = colWidths[header]! - strippedLength;
        const paddedValue = value + " ".repeat(Math.max(0, paddingNeeded));

        const colorFn = colorMap?.[header];
        return colorFn ? colorFn(paddedValue) : chalk.gray(paddedValue);
      })
      .join("  ");
    console.log(dataRow);
  });
};

export const formatRelativeTime = (dateString: string): string => {
  const date = new Date(dateString);
  if (Number.isNaN(date.getTime())) return "N/A";

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
  return `${seconds}s ago`;
};
