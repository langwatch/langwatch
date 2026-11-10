/** The words the apply prompt and the not-now note use for stored data past a new period. */
import { formatDays } from "./retention-format.ts";

const count = new Intl.NumberFormat("en-GB");

function tracesLabel(rows: number): string {
  return rows === 1 ? "trace" : "traces";
}

/** "1,234 traces older than 90 days will be deleted within a day." */
export function storedRetentionPrompt({
  rows,
  retentionDays,
}: {
  rows: number | null;
  retentionDays: number | null;
}): string {
  // A preset is stored a week long (91 for 90 days); the prompt names the preset.
  const age = retentionDays === null ? "their new period" : formatDays(retentionDays);
  if (rows === null) {
    return `We couldn't count the stored traces. Any older than ${age} will be deleted within a day.`;
  }
  return `${count.format(rows)} ${tracesLabel(rows)} older than ${age} will be deleted within a day.`;
}

/** "1,234 traces still use the old period" */
export function storedRetentionNote({ rows }: { rows: number }): string {
  return `${count.format(rows)} ${tracesLabel(rows)} still use${rows === 1 ? "s" : ""} the old period`;
}
