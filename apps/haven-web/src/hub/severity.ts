import type { LogLevel } from "@langwatch/design-system-internal";

import type { CapturedLine } from "../shared/contract.ts";

/** Worst first, so the chip reached for in an incident is nearest the start of the row. */
const SEVERITY_ORDER = ["fatal", "error", "warn", "info", "debug", "trace"];

const KIT_LEVELS: Record<string, LogLevel> = {
  fatal: "error",
  error: "error",
  warn: "warn",
  warning: "warn",
  info: "info",
  debug: "debug",
  trace: "debug",
};

export const severityOf = ({ line }: { line: CapturedLine }) =>
  line.level === "" ? "other" : line.level;

export const kitLevelOf = ({ line }: { line: CapturedLine }): LogLevel | undefined =>
  KIT_LEVELS[line.level];

const rankOf = ({ severity }: { severity: string }) => {
  const known = SEVERITY_ORDER.indexOf(severity);
  return known === -1 ? SEVERITY_ORDER.length : known;
};

/** Counts over everything loaded, not what is shown: a hidden severity still says how many. */
export const severityCounts = ({ lines }: { lines: CapturedLine[] }) => {
  const counts = new Map<string, number>();
  for (const line of lines) {
    const severity = severityOf({ line });
    counts.set(severity, (counts.get(severity) ?? 0) + 1);
  }
  return [...counts].toSorted(
    ([a], [b]) => rankOf({ severity: a }) - rankOf({ severity: b }) || a.localeCompare(b),
  );
};
