/**
 * The words the apply prompt and the not-now note use for stored data past a new period: every
 * category the apply rewrites, and how many projects it covers.
 */
import {
  retentionCategories,
  type RetentionCategory,
  type StoredApplyStatus,
  type StoredPastRetention,
} from "@langwatch/data-retention-contract";

import { formatDays } from "./retention-format.ts";

const count = new Intl.NumberFormat("en-GB");

const NOUN: Record<RetentionCategory, [one: string, many: string]> = {
  traces: ["trace", "traces"],
  scenarios: ["scenario run", "scenario runs"],
  experiments: ["experiment run", "experiment runs"],
};

function itemsOf({ category, rows }: { category: RetentionCategory; rows: number }): string {
  const [one, many] = NOUN[category];
  return `${count.format(rows)} ${rows === 1 ? one : many}`;
}

function listed(parts: readonly string[]): string {
  if (parts.length <= 1) return parts.join("");
  return `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

/** Every category's stored items past retention, summed; zero means nothing to apply. */
export function storedPastRetentionTotal(counted: StoredPastRetention): number {
  return retentionCategories.reduce((sum, category) => sum + counted[category].rows, 0);
}

/**
 * "1,234 traces older than 90 days and 3 experiment runs older than 90 days will be deleted
 * within a day, across 2 projects." A category with nothing to delete is left out.
 */
export function storedRetentionPrompt({
  counted,
}: {
  counted: StoredPastRetention | null;
}): string {
  if (counted === null) {
    return "We couldn't count the stored data. Traces, scenario runs and experiment runs older than their new period will be deleted within a day.";
  }
  const parts = retentionCategories
    .filter((category) => counted[category].rows > 0)
    .map((category) => {
      const { rows, retentionDays } = counted[category];
      // A preset is stored a week long (91 for 90 days); the prompt names the preset.
      const age = retentionDays === null ? "their new period" : formatDays(retentionDays);
      return `${itemsOf({ category, rows })} older than ${age}`;
    });
  const projects = `${count.format(counted.projectCount)} ${counted.projectCount === 1 ? "project" : "projects"}`;
  return `${listed(parts)} will be deleted within a day, across ${projects}.`;
}

/** "1,234 traces and 3 experiment runs still use the old period" */
export function storedRetentionNote({ counted }: { counted: StoredPastRetention }): string {
  const parts = retentionCategories
    .filter((category) => counted[category].rows > 0)
    .map((category) => itemsOf({ category, rows: counted[category].rows }));
  const total = storedPastRetentionTotal(counted);
  return `${listed(parts)} still use${total === 1 ? "s" : ""} the old period`;
}

const appliedDate = new Intl.DateTimeFormat("en-GB", {
  day: "numeric",
  month: "short",
  year: "numeric",
  timeZone: "UTC",
});

/** "Applied on 22 Nov 2026", or the note a change not applied yet gets. */
export function storedApplyLabel({ status, at }: Pick<StoredApplyStatus, "status" | "at">): string {
  return status === "applied"
    ? `Applied on ${appliedDate.format(at)}`
    : "Not applied to stored data yet";
}
