import chalk from "chalk";

/**
 * Parses a grid placement flag (gridColumn/gridRow/colSpan/rowSpan) from its
 * raw CLI string into a non-negative integer, exiting with a message when the
 * value is not a whole number. Shared by the `charts place` and
 * `dashboard-widget place` commands so the two stay identical.
 */
export const parseGridFlag = (
  name: string,
  raw: string | undefined,
): number | undefined => {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    console.error(chalk.red(`Error: ${name} must be a whole number`));
    process.exit(1);
  }
  return value;
};
